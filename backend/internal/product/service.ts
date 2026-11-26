import { z } from "zod";
import { connectionSourcesSchema, type Connection } from "../../contract/connection";
import {
  docsProfileSchema,
  ENV_REF,
  indexProfileSchema,
  MODEL_PHASES,
  PRODUCT_SLUG,
  type ModelPhase,
  type ProductProfile,
} from "../../contract/product";
import { collectionCounts } from "../../database/chroma";
import { closeProductPools, readOnlyQuery } from "../../database/postgres";
import { getSupabase } from "../../database/supabase";
import { docsProviderFor } from "../../agents/docs";
import {
  defaultJiraTarget,
  jiraTarget,
  testJira,
} from "../../agents/resources/mcp/jira-api";
import { HttpError, throwIfError } from "../httpError";
import { assertWorkspaceRoot } from "../workspace/paths";
import { listWorkspaces } from "../workspace/service";
import { databaseTarget } from "../../scripts/doctor";
import { capabilitiesOf } from "./capabilities";
import { resolveConnection, scrubSecrets, withConnections } from "./connections";
import { defaultProduct, isDefaultId } from "./default";
import { findProductFile, loadProductFile, repoRootOf } from "./profile-file";
import { withProduct } from "./runtime";
import {
  DEFAULT_PRODUCT_ID,
  type ConnectorStatus,
  type ProductRepo,
  type ProductResponse,
  type ProductRow,
  type ResolvedDocs,
  type ResolvedProduct,
} from "./types";

const TABLE = "products";
const TEST_TIMEOUT_MS = 5_000;

function newId(): string {
  return `prd_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function isMissingTable(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = (error as { code?: string }).code;
  if (code === "PGRST205" || code === "42P01") return true;
  // Table exists but a products.sql / products-connections.sql column does not.
  return code === "PGRST204" || code === "42703";
}

export function throwIfMissingTable(error: unknown): void {
  if (isMissingTable(error)) {
    throw new HttpError(
      503,
      "Product tables are missing. Run backend/sql/products.sql and backend/sql/products-connections.sql in the Supabase SQL editor.",
    );
  }
  throwIfError(error);
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  if (!slug || slug === DEFAULT_PRODUCT_ID) return `product-${Date.now().toString(36)}`;
  return /^[a-z0-9]/.test(slug) ? slug : `p-${slug}`.slice(0, 40);
}

// --- rows <-> resolved -------------------------------------------------------

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function docsFromRow(row: ProductRow): ResolvedDocs {
  if (row.docs_provider !== "confluence") return { provider: "none" };
  const cfg = row.docs_config ?? {};
  return {
    provider: "confluence",
    spaceKey: str(cfg.spaceKey) ?? "",
    ...(str(cfg.baseUrl) ? { baseUrl: str(cfg.baseUrl) } : {}),
    ...(str(cfg.siteUrl) ? { siteUrl: str(cfg.siteUrl) } : {}),
    ...(str(cfg.usernameEnv) ? { usernameEnv: str(cfg.usernameEnv) } : {}),
    ...(str(cfg.tokenEnv) ? { tokenEnv: str(cfg.tokenEnv) } : {}),
  };
}

function modelsFromRow(row: ProductRow): Partial<Record<ModelPhase, string>> {
  const out: Partial<Record<ModelPhase, string>> = {};
  for (const phase of MODEL_PHASES) {
    const value = str(row.model_defaults?.[phase]);
    if (value) out[phase] = value;
  }
  return out;
}

export function productFromRow(row: ProductRow, repos: ProductRepo[] = []): ResolvedProduct {
  const sources = connectionSourcesSchema.safeParse(row.connection_sources ?? {});
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    isDefault: false,
    db: { urlEnv: row.db_url_env ?? undefined, schema: row.db_schema || "public" },
    docs: docsFromRow(row),
    index: {
      apiSpecCollection: str(row.index_config?.apiSpecCollection),
      ddlCollection: str(row.index_config?.ddlCollection),
    },
    models: modelsFromRow(row),
    repos,
    connectionSources: sources.success ? sources.data : {},
  };
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** Names and booleans only. A secret value never reaches this function's output. */
export function toResponse(product: ResolvedProduct, createdAt: string | null = null): ProductResponse {
  const capabilities = capabilitiesOf(product, { connections: [] });
  const dbConn = resolveConnection(product, "postgres", []);
  const docsConn = resolveConnection(product, "confluence", []);
  const jiraConn = resolveConnection(product, "jira", []);

  const status = (
    resolved: { source: ConnectorStatus["source"]; host: string | null } | undefined,
    envVar?: string,
  ): ConnectorStatus => ({
    configured: Boolean(resolved),
    source: resolved?.source ?? null,
    host: resolved?.host ?? null,
    ...(envVar ? { envVar } : {}),
  });

  const docs = product.docs;
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    isDefault: product.isDefault,
    capabilities,
    repos: product.repos,
    db: {
      ...status(
        dbConn
          ? {
              source: dbConn.source,
              host: databaseTarget(dbConn.connection.url).ok
                ? hostOf(dbConn.connection.url)
                : null,
            }
          : undefined,
        product.db.urlEnv,
      ),
      schema: product.db.schema,
    },
    docs: {
      ...status(
        docsConn
          ? { source: docsConn.source, host: hostOf(docsConn.connection.baseUrl) }
          : product.isDefault && docs.provider === "confluence"
            ? { source: "default", host: hostOf(docs.baseUrl) }
            : undefined,
      ),
      provider: docs.provider,
      spaceKey: docs.provider === "confluence" ? docs.spaceKey || null : null,
      siteUrl: docs.provider === "confluence" ? (docs.siteUrl ?? null) : null,
      ...(docs.provider === "confluence" && docs.tokenEnv ? { tokenEnv: docs.tokenEnv } : {}),
      ...(docs.provider === "confluence" && docs.usernameEnv
        ? { usernameEnv: docs.usernameEnv }
        : {}),
    },
    jira: status(
      jiraConn ? { source: jiraConn.source, host: hostOf(jiraConn.connection.baseUrl) } : undefined,
    ),
    index: {
      apiSpecCollection: product.index.apiSpecCollection ?? null,
      ddlCollection: product.index.ddlCollection ?? null,
    },
    models: product.models,
    connectionSources: product.connectionSources,
    createdAt,
  };
}

// --- reads -------------------------------------------------------------------

async function reposFor(userId: string, productId: string): Promise<ProductRepo[]> {
  const rows = await listWorkspaces(userId, productId);
  return rows.map((ws) => ({ id: ws.id, name: ws.name, path: ws.path }));
}

async function listRows(userId: string): Promise<ProductRow[]> {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (isMissingTable(error)) return [];
  throwIfMissingTable(error);
  return (data ?? []) as ProductRow[];
}

export async function getProductRow(userId: string, productId: string): Promise<ProductRow> {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("*")
    .eq("id", productId)
    .eq("user_id", userId)
    .maybeSingle();
  throwIfMissingTable(error);
  if (!data) throw new HttpError(404, "Product not found");
  return data as ProductRow;
}

/** Default first, then the user's products. Works before products.sql runs: Default only. */
export async function listProducts(userId: string): Promise<ProductResponse[]> {
  const [rows, defaultRepos] = await Promise.all([
    listRows(userId),
    reposFor(userId, DEFAULT_PRODUCT_ID),
  ]);
  const products = await Promise.all(
    rows.map(async (row) => toResponse(productFromRow(row, await reposFor(userId, row.id)), row.created_at)),
  );
  return [toResponse(defaultProduct(defaultRepos)), ...products];
}

/** 404 for a product the user does not own; Default always passes. */
export async function assertProductOwner(
  userId: string | undefined,
  productId: string | undefined,
): Promise<void> {
  if (isDefaultId(productId)) return;
  if (!userId) throw new HttpError(400, "Sign in to use a product.");
  await getProductRow(userId, productId as string);
}

/**
 * The product a request runs inside. Unknown or foreign ids are a 400, so a
 * request can never borrow another user's env references or repos.
 */
export async function resolveProduct(
  userId: string | undefined,
  productId: string | undefined,
): Promise<ResolvedProduct> {
  if (isDefaultId(productId)) {
    return defaultProduct(userId ? await reposFor(userId, DEFAULT_PRODUCT_ID).catch(() => []) : []);
  }
  if (!userId) throw new HttpError(400, "Sign in to use a product.");
  let row: ProductRow;
  try {
    row = await getProductRow(userId, productId as string);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw new HttpError(400, "Unknown product.");
    }
    throw err;
  }
  return productFromRow(row, await reposFor(userId, row.id));
}

// --- writes ------------------------------------------------------------------

const modelsSchema = z.partialRecord(z.enum(MODEL_PHASES), z.string().trim().min(1));

const dbInputSchema = z.object({
  urlEnv: ENV_REF.optional(),
  schema: z.string().trim().min(1).max(63).default("public"),
});

/** Non-secret metadata only. A token or URL with credentials has no field to land in. */
export const productInputSchema = z.object({
  slug: PRODUCT_SLUG.optional(),
  name: z.string().trim().min(1).max(80),
  db: dbInputSchema.optional(),
  docs: docsProfileSchema.default({ provider: "none" }),
  index: indexProfileSchema.default({}),
  models: modelsSchema.optional(),
  connectionSources: connectionSourcesSchema.default({}),
  repo: z
    .object({ name: z.string().trim().min(1).max(80), path: z.string().trim().min(1).max(1024) })
    .optional(),
});

export const productPatchSchema = productInputSchema
  .omit({ repo: true, slug: true })
  .partial();

export type ProductInput = z.infer<typeof productInputSchema>;
export type ProductPatch = z.infer<typeof productPatchSchema>;

function parseOr400<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || what} ${issue.message}`)
      .slice(0, 3)
      .join("; ");
    throw new HttpError(400, `Invalid ${what}: ${detail}`);
  }
  return parsed.data;
}

export function parseProductInput(body: unknown): ProductInput {
  return parseOr400(productInputSchema, body, "product");
}

export function parseProductPatch(body: unknown): ProductPatch {
  return parseOr400(productPatchSchema, body, "product update");
}

function docsColumns(docs: ProductInput["docs"]): Pick<ProductRow, "docs_provider" | "docs_config"> {
  if (docs.provider !== "confluence") return { docs_provider: "none", docs_config: {} };
  const { provider: _provider, ...config } = docs;
  return { docs_provider: "confluence", docs_config: config };
}

function rowColumns(input: ProductPatch): Partial<ProductRow> {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.db !== undefined
      ? { db_url_env: input.db.urlEnv ?? null, db_schema: input.db.schema }
      : {}),
    ...(input.docs !== undefined ? docsColumns(input.docs) : {}),
    ...(input.index !== undefined ? { index_config: input.index } : {}),
    ...(input.models !== undefined ? { model_defaults: input.models } : {}),
    ...(input.connectionSources !== undefined
      ? { connection_sources: input.connectionSources }
      : {}),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

export async function createProduct(userId: string, input: ProductInput): Promise<ProductResponse> {
  const now = new Date().toISOString();
  const row = {
    id: newId(),
    user_id: userId,
    slug: input.slug ?? slugify(input.name),
    db_schema: "public",
    ...rowColumns(input),
    created_at: now,
    updated_at: now,
  };
  if (!row.name) throw new HttpError(400, "Invalid product: name is required");

  const { data, error } = await getSupabase().from(TABLE).insert(row).select("*").single();
  if (isUniqueViolation(error)) {
    throw new HttpError(409, "A product with that name or id already exists");
  }
  throwIfMissingTable(error);
  const created = data as ProductRow;

  if (input.repo) {
    const { createWorkspace } = await import("../workspace/service");
    await createWorkspace(userId, { ...input.repo, productId: created.id });
  }
  return toResponse(productFromRow(created, await reposFor(userId, created.id)), created.created_at);
}

export async function updateProduct(
  userId: string,
  productId: string,
  patch: ProductPatch,
): Promise<ProductResponse> {
  if (isDefaultId(productId)) {
    throw new HttpError(400, "The Default product comes from backend/.env and cannot be edited here.");
  }
  await getProductRow(userId, productId);
  const { data, error } = await getSupabase()
    .from(TABLE)
    .update({ ...rowColumns(patch), updated_at: new Date().toISOString() })
    .eq("id", productId)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (isUniqueViolation(error)) {
    throw new HttpError(409, "A product with that name already exists");
  }
  throwIfMissingTable(error);
  const row = data as ProductRow;
  await closeProductPools(productId);
  return toResponse(productFromRow(row, await reposFor(userId, row.id)), row.created_at);
}

export async function deleteProduct(userId: string, productId: string): Promise<{ id: string }> {
  if (isDefaultId(productId)) {
    throw new HttpError(400, "The Default product cannot be deleted.");
  }
  const existing = await getProductRow(userId, productId);
  const { error } = await getSupabase()
    .from(TABLE)
    .delete()
    .eq("id", existing.id)
    .eq("user_id", userId);
  throwIfMissingTable(error);
  await closeProductPools(existing.id);
  return { id: existing.id };
}

// --- import ------------------------------------------------------------------

export type ImportedProfile = {
  path: string;
  found: boolean;
  profile?: ProductProfile;
};

/** Prefill for the add-product flow: reads `<path>/.sa/product.json` if the repo commits one. */
export function importProfile(folder: string): ImportedProfile {
  let root: string;
  try {
    root = assertWorkspaceRoot(folder);
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : "Folder is not readable.");
  }
  const file = findProductFile(root);
  if (!file || repoRootOf(file) !== root) return { path: root, found: false };
  try {
    return { path: root, found: true, profile: loadProductFile(file) };
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : "Invalid .sa/product.json");
  }
}

// --- connection test -----------------------------------------------------------

export type TestRow = { ok: boolean | null; detail: string };
export type ConnectionTestResult = {
  db: TestRow;
  docs: TestRow;
  jira: TestRow;
  index: TestRow & { counts: { name: string; count: number | null }[] };
  repos: TestRow;
};

function withTimeout<T>(promise: Promise<T>, ms = TEST_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function row(conns: readonly Connection[], run: () => Promise<string>): Promise<TestRow> {
  try {
    return { ok: true, detail: scrubSecrets(await withTimeout(run()), conns) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: scrubSecrets(message, conns) };
  }
}

const skipped = (detail: string): TestRow => ({ ok: null, detail });

/**
 * Exercises each connector once with the connections in the request body, so
 * a connection can be tested before it is saved. Stores nothing; every
 * detail is scrubbed of secret values and URL userinfo.
 */
export async function testConnections(
  product: ResolvedProduct,
  conns: readonly Connection[],
): Promise<ConnectionTestResult> {
  return withProduct(product, () =>
    withConnections(conns, async () => {
      const caps = capabilitiesOf(product, { connections: conns });

      const db = caps.db
        ? await row(conns, async () => {
            await readOnlyQuery("select 1");
            const url = resolveConnection(product, "postgres", conns)?.connection.url;
            const target = databaseTarget(url);
            return `connected to ${target.ok ? target.detail : "the database"}, read-only`;
          })
        : skipped("no database connected");

      const docs = caps.docs
        ? await row(conns, () => docsProviderFor(product, conns).test())
        : skipped("no Confluence connected");

      const jiraConn = conns.find((conn) => conn.kind === "jira");
      const jiraTargetFor = jiraConn
        ? jiraTarget(jiraConn, true)
        : product.isDefault
          ? defaultJiraTarget()
          : undefined;
      const jira = jiraTargetFor
        ? await row(conns, () => testJira(jiraTargetFor))
        : skipped("no Jira connected");

      const counts = await withTimeout(collectionCounts(product.index)).catch(() => []);
      const index: ConnectionTestResult["index"] =
        counts.length === 0
          ? { ...skipped("no index collections configured"), counts: [] }
          : {
              ok: counts.every((entry) => entry.count !== null),
              detail: counts
                .map((entry) =>
                  entry.count === null
                    ? `${entry.name}: unreachable`
                    : `${entry.name}: ${entry.count} document(s)`,
                )
                .join("; "),
              counts: counts.map(({ name, count }) => ({ name, count })),
            };

      const repoErrors = product.repos.flatMap((repo) => {
        try {
          assertWorkspaceRoot(repo.path);
          return [];
        } catch (err) {
          return [`${repo.name}: ${err instanceof Error ? err.message : "not readable"}`];
        }
      });
      const repos: TestRow =
        product.repos.length === 0
          ? skipped("no repos attached")
          : repoErrors.length > 0
            ? { ok: false, detail: repoErrors.join("; ") }
            : { ok: true, detail: `${product.repos.length} repo(s) readable` };

      return { db, docs, jira, index, repos };
    }),
  );
}

export { DEFAULT_PRODUCT_ID };
