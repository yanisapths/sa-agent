import { mkdtemp, cp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SandboxClient, type Sandbox } from "langsmith/sandbox";

export interface IsolatedSandbox {
  name: string;
  /** Local temp root, or a remote sandbox path prefix. */
  root: string;
  readText(rel: string): Promise<string>;
  writeText(rel: string, contents: string): Promise<void>;
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
  const root = await mkdtemp(path.join(tmpdir(), `sa-eval-${options.name}-`));
  try {
    if (options.fixtureDir) {
      await cp(options.fixtureDir, root, { recursive: true });
    }
    return await run({
      name: options.name,
      root,
      readText: (rel) => readFile(path.join(root, rel), "utf8"),
      writeText: (rel, contents) =>
        writeFile(path.join(root, rel), contents, "utf8"),
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
        writeText: (rel, contents) => remote.write(`${root}/${rel}`, contents),
      },
      remote,
    );
  } finally {
    await remote.delete();
  }
}
