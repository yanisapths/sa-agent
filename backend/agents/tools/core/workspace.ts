/**
 * Runtime-agnostic workspace tools. Failures return text so a missing folder
 * does not abort the whole agent run.
 */
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  formatTree,
  grepWorkspace,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "../../../internal/workspace/fs";
import { WorkspacePathError } from "../../../internal/workspace/paths";
import { orToolError } from "../errors";

const SOURCE = "The project folder";

const NO_FOLDER =
  "No local folder is attached. Ask the human to pick a project with Work in a folder, " +
  "or mention @Projects/name.";

export function workspaceRootOf(config: RunnableConfig): string | undefined {
  const root = config.configurable?.workspaceRoot;
  return typeof root === "string" && root.trim() ? root.trim() : undefined;
}

function withRoot(
  config: RunnableConfig,
  run: (root: string) => string,
): Promise<string> {
  return orToolError(SOURCE, async () => {
    const root = workspaceRootOf(config);
    if (!root) return NO_FOLDER;
    try {
      return run(root);
    } catch (err) {
      if (err instanceof WorkspacePathError) return `${SOURCE}: ${err.message}`;
      throw err;
    }
  });
}

export async function listWorkspace(
  relative: string,
  depth: number,
  config: RunnableConfig,
): Promise<string> {
  return withRoot(config, (root) => {
    const tree = formatTree(root, relative || ".", depth);
    return `Project folder ${root}\n\n${tree}`;
  });
}

export async function readWorkspace(
  relative: string,
  config: RunnableConfig,
): Promise<string> {
  return withRoot(config, (root) => {
    const buffer = readWorkspaceFile(root, relative);
    return buffer.toString("utf-8");
  });
}

export async function grepInWorkspace(
  pattern: string,
  relative: string,
  config: RunnableConfig,
): Promise<string> {
  return withRoot(config, (root) => {
    const hits = grepWorkspace(root, pattern, relative || ".");
    if (hits.length === 0) {
      return `No matches for "${pattern}" in the project folder.`;
    }
    return hits
      .map((hit) =>
        hit.line === 0
          ? `${hit.path}: ${hit.text}`
          : `${hit.path}:${hit.line}: ${hit.text}`,
      )
      .join("\n");
  });
}

export async function writeWorkspace(
  relative: string,
  content: string,
  config: RunnableConfig,
): Promise<string> {
  return withRoot(config, (root) => {
    const written = writeWorkspaceFile(root, relative, content);
    return `Wrote ${written.bytes} bytes to ${written.path}`;
  });
}
