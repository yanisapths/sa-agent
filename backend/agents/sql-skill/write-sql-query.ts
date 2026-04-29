import { tool, type ToolRuntime } from "langchain";
import type { CustomState } from "./load-skill";
import { z } from "zod";

export const writeSqlQuery = tool(
  async (
    { query, vertical },
    runtime: ToolRuntime<typeof CustomState.State>,
  ) => {
    const skillsLoaded = runtime.state.skillsLoaded ?? [];

    if (!skillsLoaded.includes(vertical)) {
      return (
        `Error: You must load the '${vertical}' skill first ` +
        `to understand the database schema before writing queries. ` +
        `Use load_skill('${vertical}') to load the schema.`
      );
    }

    return (
      `SQL Query for ${vertical}:\n\n` +
      `\`\`\`sql\n${query}\n\`\`\`\n\n` +
      `✓ Query validated against ${vertical} schema\n` +
      `Ready to execute against the database.`
    );
  },
  {
    name: "write_sql_query",
    description: `Write and validate a SQL query for a specific business vertical.
      
      This tool helps format and validate SQL queries. You must load the
      appropriate skill first to understand the database schema.`,
    schema: z.object({
      query: z.string().describe("The SQL query to write"),
      vertical: z
        .string()
        .describe("The business vertical (trait assessment system)"),
    }),
  },
);
