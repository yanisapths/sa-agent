import { resolve } from "node:path";
import { collection } from "../../database/chroma";
import { getSupabase } from "../../database/supabase";
import { defaultProduct } from "../../internal/product/default";
import { resolveEnvRef } from "../../internal/product/env-ref";
import {
  loadProductFile,
  productFromProfile,
  repoRootOf,
} from "../../internal/product/profile-file";
import { productFromRow } from "../../internal/product/service";
import type { ProductRow, ResolvedProduct } from "../../internal/product/types";
import type { Chroma } from "@langchain/community/vectorstores/chroma";

function flag(name: string): string | undefined {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}`) return argv[i + 1];
    if (argv[i].startsWith(`--${name}=`)) return argv[i].slice(name.length + 3);
  }
  return undefined;
}

/** Positional arguments with `--flag value` pairs removed. */
export function positionalArgs(): string[] {
  const out: string[] = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      if (!arg.includes("=")) i++;
      continue;
    }
    out.push(arg);
  }
  return out;
}

/**
 * `--profile path/to/.sa/product.json` or `--product <slug>` (looked up in
 * Supabase). With neither, ingest into Default exactly as before.
 */
export async function ingestProduct(): Promise<ResolvedProduct> {
  const profilePath = flag("profile");
  if (profilePath) {
    const file = resolve(profilePath);
    return productFromProfile(loadProductFile(file), repoRootOf(file));
  }

  const slug = flag("product");
  if (!slug || slug === "default") return defaultProduct();

  const { data, error } = await getSupabase().from("products").select("*").eq("slug", slug);
  if (error) throw new Error(`Could not read products: ${error.message}`);
  const rows = (data ?? []) as ProductRow[];
  if (rows.length === 0) throw new Error(`No product with slug "${slug}".`);
  if (rows.length > 1) {
    throw new Error(
      `${rows.length} users have a product "${slug}". Use --profile path/to/.sa/product.json instead.`,
    );
  }
  return productFromRow(rows[0]);
}

export function requiredCollection(
  product: ResolvedProduct,
  which: "apiSpecCollection" | "ddlCollection",
): Chroma {
  const name = product.index[which];
  if (!name) {
    throw new Error(`Product "${product.slug}" has no index.${which}. Set it before ingesting.`);
  }
  return collection(name);
}

export type IngestConfluence = {
  baseUrl: string;
  spaceKey: string;
  username?: string;
  accessToken?: string;
  personalAccessToken?: string;
};

/**
 * Default reads `CONFLUENCE_*`. A product reads only its own env references;
 * an empty token means the space is ingested anonymously.
 */
export function ingestConfluenceSource(product: ResolvedProduct): IngestConfluence {
  if (product.isDefault) {
    const baseUrl = process.env.CONFLUENCE_BASE_URL;
    const spaceKey = process.env.CONFLUENCE_SPACE_KEY;
    if (!baseUrl || !spaceKey) {
      throw new Error("Missing CONFLUENCE_BASE_URL or CONFLUENCE_SPACE_KEY");
    }
    return {
      baseUrl,
      spaceKey,
      username: process.env.CONFLUENCE_USERNAME,
      accessToken: process.env.CONFLUENCE_ACCESS_TOKEN,
      personalAccessToken: process.env.CONFLUENCE_PAT,
    };
  }
  const docs = product.docs;
  if (docs.provider !== "confluence" || !docs.baseUrl || !docs.spaceKey) {
    throw new Error(`Product "${product.slug}" has no Confluence baseUrl and spaceKey.`);
  }
  const token = resolveEnvRef(docs.tokenEnv);
  const username = resolveEnvRef(docs.usernameEnv);
  return {
    baseUrl: docs.baseUrl,
    spaceKey: docs.spaceKey,
    ...(username && token ? { username, accessToken: token } : token ? { personalAccessToken: token } : {}),
  };
}
