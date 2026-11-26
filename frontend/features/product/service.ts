import { AGENT_API, VAULT_TOKEN } from "@/lib/api";
import { type Connection } from "@/lib/connection";
import {
  type ConnectionTest,
  type Product,
  type ProductApiResponse,
  type ProductInput,
  type ProductPatch,
  type ProfileImport,
} from "./types";

/** Unsaved products are tested through this id, with the draft in the body. */
const DRAFT_ID = "new";

async function productRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (VAULT_TOKEN) {
    headers.set("Authorization", `Bearer ${VAULT_TOKEN}`);
  }

  const res = await fetch(`${AGENT_API}/v1/products${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  let json: ProductApiResponse<T>;
  try {
    json = (await res.json()) as ProductApiResponse<T>;
  } catch {
    throw new Error(`Product request failed (${res.status})`);
  }
  if (!json.ok) {
    throw new Error(json.error || `Product request failed (${res.status})`);
  }
  return json.data;
}

export const productService = {
  list: async (): Promise<Product[]> => {
    return productRequest<Product[]>("/");
  },

  create: async (input: ProductInput): Promise<Product> => {
    return productRequest<Product>("/", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  update: async (productId: string, patch: ProductPatch): Promise<Product> => {
    return productRequest<Product>(`/${encodeURIComponent(productId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  delete: async (productId: string): Promise<{ id: string }> => {
    return productRequest<{ id: string }>(`/${encodeURIComponent(productId)}`, {
      method: "DELETE",
    });
  },

  /**
   * Connections travel in the JSON body of this one call and are not stored
   * by the backend. Pass `draft` to test a product before it is created.
   */
  test: async (
    productId: string | null,
    connections: readonly Connection[],
    draft?: ProductInput,
  ): Promise<ConnectionTest> => {
    const id = productId ?? DRAFT_ID;
    return productRequest<ConnectionTest>(`/${encodeURIComponent(id)}/test`, {
      method: "POST",
      body: JSON.stringify({ connections, ...(draft ? { product: draft } : {}) }),
    });
  },

  import: async (path: string): Promise<ProfileImport> => {
    return productRequest<ProfileImport>("/import", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
  },
};
