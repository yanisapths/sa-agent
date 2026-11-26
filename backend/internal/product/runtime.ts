import { AsyncLocalStorage } from "node:async_hooks";
import { defaultProduct } from "./default";
import type { ResolvedProduct } from "./types";

/**
 * The active product for this `/chat` invoke or MCP call. Agents and tools
 * are built once and reused, so they read the product from here per call.
 * Scripts and tests that never call `withProduct` get Default.
 */
const store = new AsyncLocalStorage<ResolvedProduct>();

export function currentProduct(): ResolvedProduct {
  return store.getStore() ?? defaultProduct();
}

export function withProduct<T>(
  product: ResolvedProduct | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!product) return fn();
  return store.run(product, fn);
}

/**
 * Root for system-model tools: the attached folder, else the product's
 * primary repo. Undefined means the tools are not granted, so `productRoot()`
 * never falls back to the backend's own checkout from the GUI.
 */
export function productRepoRoot(
  product: ResolvedProduct,
  attached?: string,
): string | undefined {
  return attached ?? product.repos[0]?.path;
}
