import { mkdtemp, cp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { SandboxClient, type Sandbox } from "langsmith/sandbox";

/**
 * Default LangSmith microVM images ship with `/bin/sh` only.
 * The SDK defaults to `/bin/bash`, which fails with:
 * `fork/exec /bin/bash: no such file or directory`.
 */
const LANGSMITH_SHELL = "/bin/sh";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  signal?: string;
  duration: number;
}

export interface IsolatedSandbox {
  name: string;
  /** Local temp root, or a remote sandbox path prefix. */
  root: string;
  readText(rel: string): Promise<string>;
  writeText(rel: string, contents: string): Promise<void>;
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
}

export interface ExecOptions {
  timeout?: number; // milliseconds
  cwd?: string; // relative path within sandbox
  env?: Record<string, string>;
  input?: string;
}

const MAX_OUTPUT_SIZE = 64 * 1024; // 64 KB

export function langSmithSandboxConfigured(): boolean {
  return Boolean(process.env.LANGSMITH_API_KEY);
}

/**
 * Create a raw local sandbox without context manager wrapper.
 * Caller is responsible for cleanup via rm().
 */
export async function createRawLocalSandbox(
  name: string,
): Promise<{ sandbox: IsolatedSandbox; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), `sa-eval-${name}-`));
  const sandbox: IsolatedSandbox = {
    name,
    root,
    readText: (rel) => readFile(path.join(root, rel), "utf8"),
    writeText: (rel, contents) =>
      writeFile(path.join(root, rel), contents, "utf8"),
    exec: (command, opts) => execLocal(root, command, opts),
  };
  return { sandbox, root };
}

/**
 * Create a raw LangSmith sandbox without context manager wrapper.
 * Caller is responsible for cleanup via remote.delete().
 */
export async function createRawLangSmithSandbox(
  name: string,
): Promise<{ sandbox: IsolatedSandbox; remote: Sandbox }> {
  const client = new SandboxClient();
  const remote = await client.createSandbox({ name: `sa-eval-${name}` });
  const root = `/tmp/sa-eval-${name}`;
  await ensureLangSmithRoot(remote, root);

  const sandbox: IsolatedSandbox = {
    name,
    root,
    readText: async (rel) => {
      const bytes = await remote.read(`${root}/${rel}`);
      return new TextDecoder().decode(bytes);
    },
    writeText: (rel, contents) => remote.write(`${root}/${rel}`, contents),
    exec: (command, opts) => execLangSmith(remote, root, command, opts),
  };

  return { sandbox, remote };
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
      exec: (command, opts) => execLocal(root, command, opts),
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
    await ensureLangSmithRoot(remote, root);
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
        exec: (command, opts) => execLangSmith(remote, root, command, opts),
      },
      remote,
    );
  } finally {
    await remote.delete();
  }
}

/**
 * Ensure the sandbox working root exists before file I/O or exec.
 */
async function ensureLangSmithRoot(
  remote: Sandbox,
  root: string,
): Promise<void> {
  await remote.run(`mkdir -p ${shellSingleQuote(root)}`, {
    shell: LANGSMITH_SHELL,
    wait: true,
  });
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Execute a command in a local sandbox.
 */
export async function execLocal(
  root: string,
  command: string,
  options?: ExecOptions,
): Promise<ExecResult> {
  const timeout = Math.min(options?.timeout ?? 30000, 120000);
  const cwd = options?.cwd ? path.join(root, options.cwd) : root;

  // Validate cwd to prevent traversal
  if (!cwd.startsWith(root)) {
    throw new Error("Invalid working directory: path traversal detected");
  }

  const startTime = Date.now();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let signal: string | undefined;

  return Promise.race([
    new Promise<ExecResult>((resolve, reject) => {
      const child = spawn(command, {
        shell: true,
        cwd,
        timeout,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ...(options?.env ?? {}),
        },
      });

      if (options?.input) {
        child.stdin?.write(options.input);
        child.stdin?.end();
      }

      child.stdout?.on("data", (data) => {
        const str = data.toString("utf8");
        if (stdout.length < MAX_OUTPUT_SIZE) {
          const remaining = MAX_OUTPUT_SIZE - stdout.length;
          stdout += str.slice(0, remaining);
        }
      });

      child.stderr?.on("data", (data) => {
        const str = data.toString("utf8");
        if (stderr.length < MAX_OUTPUT_SIZE) {
          const remaining = MAX_OUTPUT_SIZE - stderr.length;
          stderr += str.slice(0, remaining);
        }
      });

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, timeout + 1000); // Give process time to cleanup

      child.on("close", (code, sig) => {
        clearTimeout(timer);
        exitCode = code ?? 1;
        signal = sig ?? undefined;
        const duration = Date.now() - startTime;

        // Append truncation notice if output was capped
        if (stdout.length === MAX_OUTPUT_SIZE) {
          stdout += "\n... [stdout truncated]";
        }
        if (stderr.length === MAX_OUTPUT_SIZE) {
          stderr += "\n... [stderr truncated]";
        }

        resolve({ exitCode, stdout, stderr, signal, duration });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    }),
    new Promise<ExecResult>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Command execution timeout after ${timeout + 5000}ms (hard safety limit)`
            )
          ),
        timeout + 5000
      )
    ),
  ]);
}

/**
 * Execute a command in a LangSmith cloud sandbox.
 *
 * LangSmith `RunOptions.timeout` is in seconds (not ms).
 * Output chunks are `{ stream, data }` (not `{ stdout, stderr }` byte arrays).
 */
export async function execLangSmith(
  remote: Sandbox,
  root: string,
  command: string,
  options?: ExecOptions,
): Promise<ExecResult> {
  const timeoutMs = Math.min(options?.timeout ?? 30000, 120000);
  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  const cwd = options?.cwd ? `${root}/${options.cwd}` : root;

  // Validate cwd to prevent traversal
  if (!cwd.startsWith(root)) {
    throw new Error("Invalid working directory: path traversal detected");
  }

  const startTime = Date.now();
  let stdout = "";
  let stderr = "";

  try {
    const handle = await remote.run(command, {
      timeout: timeoutSec,
      cwd,
      shell: LANGSMITH_SHELL,
      wait: false,
      env: options?.env,
    });

    if (options?.input) {
      handle.sendInput(options.input);
    }

    for await (const chunk of handle) {
      if (chunk.stream === "stdout") {
        if (stdout.length < MAX_OUTPUT_SIZE) {
          const remaining = MAX_OUTPUT_SIZE - stdout.length;
          stdout += chunk.data.slice(0, remaining);
        }
      } else if (chunk.stream === "stderr") {
        if (stderr.length < MAX_OUTPUT_SIZE) {
          const remaining = MAX_OUTPUT_SIZE - stderr.length;
          stderr += chunk.data.slice(0, remaining);
        }
      }
    }

    const result = await handle.result;
    const duration = Date.now() - startTime;

    if (stdout.length === MAX_OUTPUT_SIZE) {
      stdout += "\n... [stdout truncated]";
    }
    if (stderr.length === MAX_OUTPUT_SIZE) {
      stderr += "\n... [stderr truncated]";
    }

    return {
      exitCode: result.exit_code,
      stdout,
      stderr,
      duration,
    };
  } catch (err) {
    throw new Error(
      `Failed to execute command in LangSmith sandbox: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
