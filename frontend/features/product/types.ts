import { type ConnectionSources } from "@/lib/connection";

export const DEFAULT_PRODUCT_ID = "default";

export interface ProductCapabilities {
  db: boolean;
  docs: boolean;
  schemaIndex: boolean;
  repos: boolean;
}

export type CapabilityKey = keyof ProductCapabilities;

export type ConnectorOrigin = "browser" | "env" | "default";

/** Server metadata for one connector. Hostnames and env-var names only, never values. */
export interface ConnectorStatus {
  configured: boolean;
  source: ConnectorOrigin | null;
  host: string | null;
  envVar?: string;
}

export interface ProductRepo {
  id: string;
  name: string;
  path: string;
}

export interface Product {
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
  models: Record<string, string>;
  connectionSources: ConnectionSources;
  createdAt: string | null;
}

export type DocsInput =
  | { provider: "none" }
  | {
      provider: "confluence";
      spaceKey: string;
      baseUrl?: string;
      siteUrl?: string;
      usernameEnv?: string;
      tokenEnv?: string;
    };

/** Mirrors `productInputSchema` on the backend. Env names must start with `SA_PRODUCT_`. */
export interface ProductInput {
  name: string;
  slug?: string;
  /** Omitting `urlEnv` clears the env reference. */
  db?: { urlEnv?: string; schema?: string };
  docs?: DocsInput;
  index?: { apiSpecCollection?: string; ddlCollection?: string };
  connectionSources?: ConnectionSources;
  repo?: { name: string; path: string };
}

export type ProductPatch = Partial<Omit<ProductInput, "repo" | "slug">>;

export interface ProfileImport {
  path: string;
  found: boolean;
  profile?: {
    id: string;
    name: string;
    db?: { urlEnv: string; schema: string };
    docs: DocsInput;
    index: { apiSpecCollection?: string; ddlCollection?: string };
  };
}

/** `ok: null` means the check was skipped because nothing is configured. */
export interface TestRow {
  ok: boolean | null;
  detail: string;
}

export interface ConnectionTest {
  db: TestRow;
  docs: TestRow;
  jira: TestRow;
  index: TestRow & { counts: { name: string; count: number | null }[] };
  repos: TestRow;
}

type ProductOk<T> = { ok: true; data: T };
type ProductErr = { ok: false; error: string };
export type ProductApiResponse<T> = ProductOk<T> | ProductErr;
