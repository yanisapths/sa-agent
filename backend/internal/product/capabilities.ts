import type { Connection } from "../../contract/connection";
import { currentConnections, resolveConnection } from "./connections";
import type { ProductCapabilities, ResolvedProduct } from "./types";

export const CAPABILITY_TOOLS = {
  db: ["list_tables", "describe_tables", "inspect_relationships", "run_sql"],
  docs: ["search_docs", "get_doc_page"],
  schemaIndex: ["search_schema_docs"],
  repos: [
    "build_system_model",
    "query_system_model",
    "simulate_impact",
    "record_decision",
    "search_decisions",
    "workspace_ls",
    "workspace_read",
    "workspace_grep",
    "workspace_write",
  ],
} as const satisfies Record<keyof ProductCapabilities, readonly string[]>;

export const ALL_CAPABILITIES: ProductCapabilities = {
  db: true,
  docs: true,
  schemaIndex: true,
  repos: true,
};

export function capabilitiesOf(
  product: ResolvedProduct,
  opts: { attachedRoot?: string; connections?: readonly Connection[] } = {},
): ProductCapabilities {
  const conns = opts.connections ?? currentConnections();
  const docs = product.isDefault
    ? product.docs.provider === "confluence"
    : (() => {
        const resolved = resolveConnection(product, "confluence", conns);
        if (!resolved?.connection.baseUrl || !resolved.connection.spaceKey) return false;
        return resolved.source === "browser" || product.docs.provider === "confluence";
      })();

  return {
    db: resolveConnection(product, "postgres", conns) !== undefined,
    docs,
    schemaIndex: Boolean(product.index.ddlCollection),
    repos: Boolean(opts.attachedRoot) || product.repos.length > 0,
  };
}

/** Stable, short, secret-free: safe to use in an agent cache key. */
export function capabilitySignature(caps: ProductCapabilities): string {
  return `db${+caps.db}docs${+caps.docs}idx${+caps.schemaIndex}repo${+caps.repos}`;
}

const removedBy = (caps: ProductCapabilities): Set<string> => {
  const removed = new Set<string>();
  for (const [cap, tools] of Object.entries(CAPABILITY_TOOLS)) {
    if (!caps[cap as keyof ProductCapabilities]) {
      for (const tool of tools) removed.add(tool);
    }
  }
  return removed;
};

/** The phase lists are the ceiling; this removes what the product cannot back. */
export function grantedTools<T extends string>(
  tools: readonly T[],
  caps: ProductCapabilities,
): T[] {
  const removed = removedBy(caps);
  return tools.filter((tool) => !removed.has(tool));
}

const NOTES: Record<keyof ProductCapabilities, string> = {
  db:
    "This product has no database connected. Schema tools and run_sql are unavailable. " +
    "Do not guess tables or columns: say the database is not connected and ground the answer in the repo and docs instead.",
  docs:
    "This product has no Confluence docs connected. search_docs and get_doc_page are unavailable. " +
    "Do not invent API contracts: say the docs are not connected and ground the answer in the repo and schema instead.",
  schemaIndex:
    "This product has no schema index. search_schema_docs is unavailable; use the live schema tools if they are listed.",
  repos:
    "This product has no repo attached. System-model and workspace tools are unavailable. " +
    "Do not claim to have read code: say no repo is attached, and ask the human to attach one when the answer depends on code.",
};

/** Empty when nothing is missing, so a fully connected product's prompt is unchanged. */
export function capabilityNote(caps: ProductCapabilities): string {
  const missing = (Object.keys(NOTES) as (keyof ProductCapabilities)[]).filter(
    (cap) => !caps[cap],
  );
  if (missing.length === 0) return "";
  return `Product capabilities:\n${missing.map((cap) => `- ${NOTES[cap]}`).join("\n")}`;
}
