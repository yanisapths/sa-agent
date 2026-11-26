import { isDefaultId } from "./default";

/** `product_id` does not exist until products.sql runs. */
export function isMissingColumn(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42703"
  );
}

type Filterable<Q> = {
  is(column: string, value: null): Q;
  eq(column: string, value: string): Q;
};

/** Default is `product_id IS NULL`; any other product is an exact match. */
export function scopeToProduct<Q extends Filterable<Q>>(query: Q, productId: string | undefined): Q {
  return isDefaultId(productId) ? query.is("product_id", null) : query.eq("product_id", productId as string);
}

/**
 * Runs a product-scoped query, and before the migration falls back to the
 * unscoped one for Default (every row is Default then) or nothing otherwise.
 */
export async function withProductScope<R extends { error: unknown; data: unknown }>(
  productId: string | undefined,
  scoped: () => PromiseLike<R>,
  unscoped: () => PromiseLike<R>,
): Promise<R | { error: null; data: [] }> {
  const result = await scoped();
  if (!isMissingColumn(result.error)) return result;
  if (isDefaultId(productId)) return unscoped();
  return { error: null, data: [] };
}

/** Only non-Default rows carry a `product_id`, so inserts work before the migration. */
export function productColumn(productId: string | undefined): { product_id?: string } {
  return isDefaultId(productId) ? {} : { product_id: productId as string };
}
