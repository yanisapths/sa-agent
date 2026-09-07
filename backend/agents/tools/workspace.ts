import { tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";
import {
  grepInWorkspace,
  listWorkspace,
  readWorkspace,
  writeWorkspace,
} from "./core/workspace";

export const workspaceLs = tool(
  async ({ path, depth }, config: RunnableConfig) =>
    listWorkspace(path, depth, config),
  {
    name: "workspace_ls",
    description:
      "List files on the attached local disk project (the human's repo). " +
      "Path is relative to the project root (e.g. internal/handler/voting). " +
      "ls also sees this folder from / when a project is attached.",
    schema: z.object({
      path: z
        .string()
        .default(".")
        .describe("Directory relative to the project root, e.g. src/ or internal/handler/voting"),
      depth: z
        .number()
        .int()
        .min(1)
        .max(4)
        .default(2)
        .describe("How many directory levels to include"),
    }),
  },
);

export const workspaceRead = tool(
  async ({ path }, config: RunnableConfig) => readWorkspace(path, config),
  {
    name: "workspace_read",
    description:
      "Read a text file from the attached local disk project. " +
      "Path is relative to the project root. If the name is wrong, this returns the directory listing. " +
      "read_file also sees this folder (use /internal/handler/voting/foo.go).",
    schema: z.object({
      path: z
        .string()
        .min(1)
        .describe("Relative file path, e.g. README.md or internal/handler/voting/handler.go"),
    }),
  },
);

export const workspaceGrep = tool(
  async ({ pattern, path }, config: RunnableConfig) =>
    grepInWorkspace(pattern, path, config),
  {
    name: "workspace_grep",
    description:
      "Search file names and text contents in the attached local disk project. " +
      "Case-insensitive. grep also sees this folder from / when a project is attached.",
    schema: z.object({
      pattern: z.string().min(1).describe("Text to search for"),
      path: z
        .string()
        .default(".")
        .describe("Relative directory to search under"),
    }),
  },
);

export const workspaceWrite = tool(
  async ({ path, content }, config: RunnableConfig) =>
    writeWorkspace(path, content, config),
  {
    name: "workspace_write",
    description:
      "Create or overwrite a file inside the attached local project folder. " +
      "Path is relative to the folder root. Parent directories are created. " +
      "Do not write under .git. Do not use this for phase artifacts at /artifacts/*.md " +
      "(those still use write_file) or for human downloads (those still use write_files).",
    schema: z.object({
      path: z
        .string()
        .min(1)
        .describe("Relative file path to write, e.g. src/orders/service.ts"),
      content: z.string().describe("Full file contents"),
    }),
  },
);
