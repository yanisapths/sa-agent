import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { productRoot } from "../agents/model/store";
import { catalogFor, type ToolSurface } from "../agents/tools/catalog";
import { capabilitiesOf, grantedTools } from "../internal/product/capabilities";
import { defaultProduct } from "../internal/product/default";
import {
  findProductFile,
  loadProductFile,
  productFromProfile,
  repoRootOf,
} from "../internal/product/profile-file";
import { withProduct } from "../internal/product/runtime";
import type { ResolvedProduct } from "../internal/product/types";
import { tracedMcpTool, tracingStatus } from "./trace";

function mcpInputSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  const { $schema: _schema, ...rest } = json;
  if (rest.type !== "object") {
    return { type: "object", properties: {} };
  }
  return rest;
}

/**
 * The MCP host has no browser, so the product comes from the repo it was
 * launched in: a committed `.sa/product.json`, else Default from `.env`.
 * A broken profile throws so the host shows the error instead of quietly
 * answering from another product's database.
 */
export function mcpProduct(): ResolvedProduct {
  const file = findProductFile();
  if (!file) return defaultProduct([{ id: "cwd", name: "repo", path: productRoot() }]);
  return productFromProfile(loadProductFile(file), repoRootOf(file));
}

export async function serveCatalog(opts: {
  name: string;
  surface: ToolSurface;
}): Promise<void> {
  const product = mcpProduct();
  const granted = new Set(
    grantedTools(
      catalogFor(opts.surface).map((entry) => entry.name),
      capabilitiesOf(product, { connections: [] }),
    ),
  );
  const tools = catalogFor(opts.surface).filter((entry) => granted.has(entry.name));
  const byMcpName = new Map(tools.map((entry) => [entry.mcpName, entry]));

  const server = new Server(
    { name: opts.name, version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((entry) => ({
      name: entry.mcpName,
      description: entry.description,
      inputSchema: mcpInputSchema(entry.schema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const name = request.params.name;
    const entry = byMcpName.get(name);

    try {
      if (!entry) throw new Error(`Unknown tool: ${name}`);
      const text = await tracedMcpTool(opts.name, name, args, () =>
        withProduct(product, () => entry.invoke(args, {})),
      );
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          { type: "text" as const, text: `${opts.name} MCP error: ${message}` },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `${opts.name} MCP server running on stdio for product ${product.slug} (${tracingStatus()})`,
  );
}
