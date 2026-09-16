import { tool } from "@langchain/core/tools";
import { createAgent } from "langchain";
import { z } from "zod";
import type { AgentModel } from "../builder";
import type { IsolatedSandbox } from "./sandbox";

/**
 * Slim execute-style coder for local evals. Same workspace tool names as
 * execute, bound to the trial sandbox so writes do not depend on LangGraph
 * passing `configurable.workspaceRoot` through.
 */
export const SLIM_EXECUTE_PROMPT = `You are the Execute specialist for a local coding eval.

A project folder is attached. Inspect with workspace_ls, workspace_read, and workspace_grep.
Implement by overwriting files with workspace_write. Paths are relative to the project root
(never host paths like /Users/…).

Follow the user task and stay inside the files it names. Do not invent tables, endpoints,
or extra files. Do not call run_sql, build_system_model, or record_decision.

When done, reply with a short summary of files touched.`;

export function createCodingEvalAgent(
  model: AgentModel,
  sandbox: IsolatedSandbox,
) {
  const workspaceLs = tool(
    async ({ path: rel, depth }: { path: string; depth: number }) =>
      sandbox.ls(rel, depth),
    {
      name: "workspace_ls",
      description:
        "List files in the attached project. Path is relative to the project root.",
      schema: z.object({
        path: z.string().default("."),
        depth: z.number().int().min(1).max(4).default(2),
      }),
    },
  );
  const workspaceRead = tool(
    async ({ path: rel }: { path: string }) => sandbox.readText(rel),
    {
      name: "workspace_read",
      description: "Read a text file from the attached project.",
      schema: z.object({ path: z.string().min(1) }),
    },
  );
  const workspaceGrep = tool(
    async ({ pattern, path: rel }: { pattern: string; path: string }) =>
      sandbox.grep(pattern, rel),
    {
      name: "workspace_grep",
      description: "Search file names and text in the attached project.",
      schema: z.object({
        pattern: z.string().min(1),
        path: z.string().default("."),
      }),
    },
  );
  const workspaceWrite = tool(
    async ({ path: rel, content }: { path: string; content: string }) =>
      sandbox.writeText(rel, content),
    {
      name: "workspace_write",
      description: "Create or overwrite a file in the attached project.",
      schema: z.object({
        path: z.string().min(1),
        content: z.string(),
      }),
    },
  );

  return createAgent({
    name: "sa-eval-coder",
    model,
    tools: [workspaceLs, workspaceRead, workspaceGrep, workspaceWrite],
    systemPrompt: SLIM_EXECUTE_PROMPT,
  });
}
