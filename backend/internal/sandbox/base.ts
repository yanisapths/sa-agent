import { mkdtemp, cp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { SandboxClient, type Sandbox } from "langsmith/sandbox";

/**
 * Shape of the LangSmith SDK's CommandHandle.
 * Used to ensure type-safe execution of remote commands.
 */
interface LangSmithCommandHandle {
  [Symbol.asyncIterator](): AsyncIterator<{
    stdout?: Uint8Array;
    stderr?: Uint8Array;
  }>;
  result: Promise<{ exit_code: number }>;
  kill(signal?: string): void;
  sendInput(data: string): void;
}

/**
 * Shape of the LangSmith SDK's Sandbox.
 * Defines the .run() method for executing commands.
 */
interface LangSmithSandbox {
  run(
    command: string,
    options: { timeout: number; cwd: string; wait: boolean }
  ): Promise<LangSmithCommandHandle>;
}

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
 */
export async function execLangSmith(
  remote: Sandbox,
  root: string,
  command: string,
  options?: ExecOptions,
): Promise<ExecResult> {
  const timeoutMs = Math.min(options?.timeout ?? 30000, 120000);
  const cwd = options?.cwd ? `${root}/${options.cwd}` : root;

  // Validate cwd to prevent traversal
  if (!cwd.startsWith(root)) {
    throw new Error("Invalid working directory: path traversal detected");
  }

  const startTime = Date.now();
  let stdout = "";
  let stderr = "";

  try {
    // LangSmith SDK's Sandbox.run method returns a CommandHandle
    // We wrap it to collect output and return the final result
    const handle = await (remote as unknown as LangSmithSandbox).run(
      command,
      {
        timeout: timeoutMs,
        cwd,
        wait: false,
      }
    );

    // Collect output from the handle
    for await (const chunk of handle) {
      if (chunk.stdout) {
        const str = new TextDecoder().decode(chunk.stdout);
        if (stdout.length < MAX_OUTPUT_SIZE) {
          const remaining = MAX_OUTPUT_SIZE - stdout.length;
          stdout += str.slice(0, remaining);
        }
      }
      if (chunk.stderr) {
        const str = new TextDecoder().decode(chunk.stderr);
        if (stderr.length < MAX_OUTPUT_SIZE) {
          const remaining = MAX_OUTPUT_SIZE - stderr.length;
          stderr += str.slice(0, remaining);
        }
      }
    }

    const result = await handle.result;
    const duration = Date.now() - startTime;

    // Append truncation notice if output was capped
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
