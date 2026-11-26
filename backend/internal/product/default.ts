import { config } from "../../config";
import { isConfluenceMcpConfigured } from "../../agents/resources/mcp/mcp-client";
import { DEFAULT_PRODUCT_ID, type ResolvedProduct } from "./types";

/**
 * The virtual Default product, built from today's `.env`. Never stored: every
 * row with `product_id IS NULL` belongs to it, so an install that never
 * creates a product behaves exactly as before.
 */
export function defaultProduct(repos: ResolvedProduct["repos"] = []): ResolvedProduct {
  const docsOn = Boolean(config.confluence.baseUrl) || isConfluenceMcpConfigured();
  return {
    id: DEFAULT_PRODUCT_ID,
    slug: DEFAULT_PRODUCT_ID,
    name: "Default",
    isDefault: true,
    db: { urlEnv: "DATABASE_URL", schema: config.postgres.schema },
    docs: docsOn
      ? {
          provider: "confluence",
          spaceKey: config.confluence.spaceKey,
          ...(config.confluence.baseUrl ? { baseUrl: config.confluence.baseUrl } : {}),
          ...(config.confluence.siteUrl ? { siteUrl: config.confluence.siteUrl } : {}),
        }
      : { provider: "none" },
    index: {
      apiSpecCollection: config.chroma.apiSpecCollection,
      ddlCollection: config.chroma.ddlCollection,
    },
    models: {},
    repos,
    connectionSources: {},
  };
}

export function isDefaultId(id: string | undefined | null): boolean {
  return !id || id === DEFAULT_PRODUCT_ID;
}
