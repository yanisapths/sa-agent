import { config } from "../../config";
import type { Connection } from "../../contract/connection";
import { currentConnections, resolveConnection } from "../../internal/product/connections";
import type { ResolvedProduct } from "../../internal/product/types";
import {
  confluenceTarget,
  defaultConfluenceTarget,
  readConfluenceDocs,
  searchConfluenceDocs,
  testConfluence,
  type ConfluenceTarget,
} from "../resources/mcp/confluence-api";
import { isConfluenceMcpConfigured } from "../resources/mcp/mcp-client";
import { readConfluenceMcp, searchConfluenceMcp } from "../tools/core/confluence";
import type { DocsProvider } from "./types";

/**
 * Default keeps today's path: the Confluence MCP client built from `.env`.
 * Every other product calls the REST client directly with its own
 * connection, so its token is never placed in a child-process environment
 * and is only ever sent to the `baseUrl` it was entered with.
 */
function defaultProvider(): DocsProvider {
  return {
    name: "confluence",
    search: (query, limit) => searchConfluenceMcp(query, limit),
    fetch: (refs) => readConfluenceMcp(refs),
    async test() {
      if (config.confluence.baseUrl) return testConfluence(defaultConfluenceTarget());
      return isConfluenceMcpConfigured()
        ? "configured through CONFLUENCE_MCP_URL / CONFLUENCE_MCP_COMMAND"
        : "not configured";
    },
  };
}

function restProvider(target: ConfluenceTarget): DocsProvider {
  return {
    name: "confluence",
    search: (query, limit) => searchConfluenceDocs(target, query, limit),
    fetch: (refs) => readConfluenceDocs(target, refs),
    test: () => testConfluence(target),
  };
}

export function targetFor(
  product: ResolvedProduct,
  conns: readonly Connection[] = currentConnections(),
): ConfluenceTarget | undefined {
  const resolved = resolveConnection(product, "confluence", conns);
  if (!resolved?.connection.baseUrl || !resolved.connection.spaceKey) return undefined;
  return confluenceTarget(resolved.connection, resolved.source === "browser");
}

export function confluenceProvider(
  product: ResolvedProduct,
  conns: readonly Connection[] = currentConnections(),
): DocsProvider | undefined {
  const browser = conns.some((conn) => conn.kind === "confluence");
  if (product.isDefault && !browser) {
    return product.docs.provider === "confluence" ? defaultProvider() : undefined;
  }
  const target = targetFor(product, conns);
  return target ? restProvider(target) : undefined;
}
