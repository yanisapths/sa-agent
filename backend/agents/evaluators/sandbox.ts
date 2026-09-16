import { realpathSync } from "node:fs";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SandboxClient, type Sandbox } from "langsmith/sandbox";
import {
  formatTree,
  grepWorkspace,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "../../internal/workspace/fs";
import { WorkspacePathError } from "../../internal/workspace/paths";

export interface IsolatedSandbox {
  name: string;
  /** Local temp root, or a remote sandbox path prefix. */
  root: string;
  readText(rel: string): Promise<string>;
  writeText(rel: string, contents: string): Promise<string>;
  ls(rel: string, depth: number): Promise<string>;
  grep(pattern: string, rel: string): Promise<string>;
}

function toolError(error: unknown): string {
  if (error instanceof WorkspacePathError) return error.message;
  throw error;
}

function confinedLocal(root: string): Pick<
  IsolatedSandbox,
  "readText" | "writeText" | "ls" | "grep"
> {
  return {
    readText: async (rel) => {
      try {
        return readWorkspaceFile(root, rel).toString("utf-8");
      } catch (error) {
        return toolError(error);
      }
    },
    writeText: async (rel, contents) => {
      try {
        const written = writeWorkspaceFile(root, rel, contents);
        return `Wrote ${written.bytes} bytes to ${written.path}`;
      } catch (error) {
        return toolError(error);
      }
    },
    ls: async (rel, depth) => {
      try {
        return formatTree(root, rel || ".", depth);
      } catch (error) {
        return toolError(error);
      }
    },
    grep: async (pattern, rel) => {
      try {
        const hits = grepWorkspace(root, pattern, rel || ".");
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
      } catch (error) {
        return toolError(error);
      }
    },
  };
}

export function langSmithSandboxConfigured(): boolean {
  return Boolean(process.env.LANGSMITH_API_KEY);
}

/**
 * Isolated local workspace. Each call gets its own temp dir so parallel
 * trials cannot share files (Harbor-style: no cross-contamination).
 */
export async function withIsolatedSandbox<T>(
  options: { name: string; fixtureDir?: string },
  run: (sandbox: IsolatedSandbox) => Promise<T>,
): Promise<T> {
  const created = await mkdtemp(path.join(tmpdir(), `sa-eval-${options.name}-`));
  const root = realpathSync(created);
  try {
    if (options.fixtureDir) {
      await cp(options.fixtureDir, root, { recursive: true });
    }
    return await run({
      name: options.name,
      root,
      ...confinedLocal(root),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Isolated LangSmith Cloud MicroVM. Harbor `--env langsmith` uses the same
 * isolation model: one sandbox per trial, deleted when the trial finishes.
 */
export async function withLangSmithSandbox<T>(
  options: { name: string; files?: Record<string, string> },
  run: (sandbox: IsolatedSandbox, remote: Sandbox) => Promise<T>,
): Promise<T> {
  const client = new SandboxClient();
  const remote = await client.createSandbox({ name: `sa-eval-${options.name}` });
  const root = `/tmp/sa-eval-${options.name}`;
  try {
    for (const [rel, contents] of Object.entries(options.files ?? {})) {
      await remote.write(`${root}/${rel}`, contents);
    }
    return await run(
      {
        name: options.name,
        root,
        readText: async (rel) => {
          const bytes = await remote.read(`${root}/${rel}`);
          return new TextDecoder().decode(bytes);
        },
        writeText: async (rel, contents) => {
          await remote.write(`${root}/${rel}`, contents);
          return `Wrote ${contents.length} bytes to ${rel}`;
        },
        ls: async () => "ls is not supported on the remote eval sandbox",
        grep: async (pattern) =>
          `grep is not supported on the remote eval sandbox (${pattern})`,
      },
      remote,
    );
  } finally {
    await remote.delete();
  }
}
