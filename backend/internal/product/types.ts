import type { ConnectionSources } from "../../contract/connection";
import type { ModelPhase } from "../../contract/product";

export const DEFAULT_PRODUCT_ID = "default";

export type ProductRepo = { id: string; name: string; path: string };

export type ResolvedDocs =
  | {
      provider: "confluence";
      spaceKey: string;
      baseUrl?: string;
      siteUrl?: string;
      usernameEnv?: string;
      tokenEnv?: string;
    }
  | { provider: "none" };

/**
 * What a request runs inside. Holds env-var names and public metadata only;
 * secret values are read per call through `resolveConnection`.
 */
export type ResolvedProduct = {
  id: string;
  slug: string;
  name: string;
  isDefault: boolean;
  db: { urlEnv?: string; schema: string };
  docs: ResolvedDocs;
  index: { apiSpecCollection?: string; ddlCollection?: string };
  models: Partial<Record<ModelPhase, string>>;
  repos: ProductRepo[];
  connectionSources: ConnectionSources;
};

export type ProductRow = {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  db_url_env: string | null;
  db_schema: string;
  docs_provider: "confluence" | "none";
  docs_config: Record<string, unknown>;
  index_config: Record<string, unknown>;
  model_defaults: Record<string, unknown>;
  connection_sources?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type ProductCapabilities = {
  db: boolean;
  docs: boolean;
  schemaIndex: boolean;
  repos: boolean;
};

export type ConnectorStatus = {
  configured: boolean;
  source: "browser" | "env" | "default" | null;
  /** Hostname only, never a URL with credentials. */
  host: string | null;
  envVar?: string;
};

export type ProductResponse = {
  id: string;
  slug: string;
  name: string;
  isDefault: boolean;
  capabilities: ProductCapabilities;
  repos: ProductRepo[];
  db: ConnectorStatus & { schema: string };
  docs: ConnectorStatus & {
    provider: "confluence" | "none";
    spaceKey: string | null;
    siteUrl: string | null;
    tokenEnv?: string;
    usernameEnv?: string;
  };
  jira: ConnectorStatus;
  index: { apiSpecCollection: string | null; ddlCollection: string | null };
  models: Partial<Record<ModelPhase, string>>;
  connectionSources: ConnectionSources;
  createdAt: string | null;
};
