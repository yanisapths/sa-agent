import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { productProfileSchema, type ProductProfile } from "../../contract/product";
import type { ResolvedProduct } from "./types";

export const PRODUCT_FILE = join(".sa", "product.json");

/** Walks up from `start` the way `productRoot()` does. Undefined when no repo commits one. */
export function findProductFile(
  start: string = process.env.SA_PRODUCT_ROOT || process.cwd(),
): string | undefined {
  let dir = resolve(start);
  for (let i = 0; i < 40; i++) {
    const candidate = join(dir, PRODUCT_FILE);
    if (existsSync(candidate)) return candidate;
    if (existsSync(join(dir, ".git"))) return undefined;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export class ProductFileError extends Error {
  constructor(path: string, detail: string) {
    super(`${path} is not a valid product profile: ${detail}`);
    this.name = "ProductFileError";
  }
}

export function parseProductProfile(raw: unknown, path = PRODUCT_FILE): ProductProfile {
  const parsed = productProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
      .slice(0, 4)
      .join("; ");
    throw new ProductFileError(path, detail);
  }
  return parsed.data;
}

export function loadProductFile(path: string): ProductProfile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new ProductFileError(path, err instanceof Error ? err.message : String(err));
  }
  return parseProductProfile(raw, path);
}

/** Plugin products have no Supabase row: the slug is the id and the repo is where the file lives. */
export function productFromProfile(profile: ProductProfile, repoRoot?: string): ResolvedProduct {
  return {
    id: profile.id,
    slug: profile.id,
    name: profile.name,
    isDefault: false,
    db: { urlEnv: profile.db?.urlEnv, schema: profile.db?.schema ?? "public" },
    docs: profile.docs.provider === "confluence" ? { ...profile.docs } : { provider: "none" },
    index: { ...profile.index },
    models: { ...(profile.models ?? {}) },
    repos: repoRoot ? [{ id: profile.id, name: profile.name, path: repoRoot }] : [],
    connectionSources: {
      ...(profile.db ? { postgres: "env" as const } : {}),
      ...(profile.docs.provider === "confluence" ? { confluence: "env" as const } : {}),
    },
  };
}

/** The repo root that holds `<root>/.sa/product.json`. */
export function repoRootOf(productFile: string): string {
  return dirname(dirname(productFile));
}
