import type { Connection } from "../../contract/connection";
import { currentConnections } from "../../internal/product/connections";
import type { ResolvedProduct } from "../../internal/product/types";
import { confluenceProvider } from "./confluence";
import type { DocsProvider } from "./types";

export type { DocsProvider } from "./types";

function notConnected(product: ResolvedProduct): DocsProvider {
  const fail = async (): Promise<never> => {
    throw new Error(`Product "${product.name}" has no Confluence docs connected.`);
  };
  return { name: "none", search: fail, fetch: fail, test: fail };
}

export function docsProviderFor(
  product: ResolvedProduct,
  conns: readonly Connection[] = currentConnections(),
): DocsProvider {
  return confluenceProvider(product, conns) ?? notConnected(product);
}
