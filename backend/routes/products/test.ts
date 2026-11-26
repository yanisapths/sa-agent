import type { NextFunction, Request, Response } from "express";
import {
  assertConnectionsAllowed,
  parseConnectionList,
} from "../../internal/product/connections";
import {
  parseProductInput,
  productFromRow,
  resolveProduct,
  slugify,
  testConnections,
} from "../../internal/product/service";
import type { ProductRow, ResolvedProduct } from "../../internal/product/types";

const DRAFT = "new";

/**
 * `POST /v1/products/new/test` tests a product that is not saved yet, from
 * `body.product`, so the add-product flow can check before it creates.
 */
function draftProduct(userId: string, body: Record<string, unknown>): ResolvedProduct {
  const input = parseProductInput(body.product);
  const now = new Date().toISOString();
  const row: ProductRow = {
    id: DRAFT,
    user_id: userId,
    slug: input.slug ?? slugify(input.name),
    name: input.name,
    db_url_env: input.db?.urlEnv ?? null,
    db_schema: input.db?.schema ?? "public",
    docs_provider: input.docs.provider,
    docs_config:
      input.docs.provider === "confluence"
        ? (({ provider: _p, ...rest }) => rest)(input.docs)
        : {},
    index_config: input.index,
    model_defaults: input.models ?? {},
    connection_sources: input.connectionSources,
    created_at: now,
    updated_at: now,
  };
  const repos = input.repo ? [{ id: "draft-repo", ...input.repo }] : [];
  return productFromRow(row, repos);
}

/** Connections come in the body, are used once, and are never stored. */
export const testProductHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const connections = parseConnectionList(body.connections ?? []);
    await assertConnectionsAllowed(connections);
    const productId = String(req.params.productId);
    const product =
      productId === DRAFT
        ? draftProduct(req.userId, body)
        : await resolveProduct(req.userId, productId);
    const data = await testConnections(product, connections);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
