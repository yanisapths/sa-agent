import { z } from "zod";
import { randomUUID } from "node:crypto";
import { defineTool } from "./types";
import { getChatSandboxManager } from "../../../internal/sandbox/manager";
import { getToolEventEmitter } from "../../../internal/chat/tool-context";
import type { ToolContext } from "./types";

const sandboxExecSchema = z.object({
  command: z
    .string()
    .describe('Shell command to run (e.g., "ls -la" or "npm --version")'),
  cwd: z
    .string()
    .optional()
    .describe("Working directory relative to sandbox root (default: '.')"),
  timeout: z
    .number()
    .int()
    .optional()
    .describe(
      "Timeout in milliseconds (default: 30000, max: 120000). Values outside this range are clamped.",
    ),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Additional environment variables"),
  input: z.string().optional().describe("Stdin to pipe to the command"),
});

type SandboxExecInput = z.infer<typeof sandboxExecSchema>;

interface SandboxExecOutput {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string;
  duration: number;
  command: string;
  cwd: string;
}

/**
 * Validate that cwd is safe (no traversal, no absolute paths).
 */
function validateCwd(cwd: string): void {
  if (cwd.startsWith("/") || cwd.startsWith("\\")) {
    throw new Error("Absolute paths are not allowed in sandbox");
  }
  if (cwd.includes("..")) {
    throw new Error("Path traversal (..) is not allowed in sandbox");
  }
}

export const sandboxTools = [
  defineTool({
    name: "sandbox_exec",
    description:
      "Execute a shell command in the sandbox environment for this chat session. " +
      "The sandbox is isolated from the workspace and persists across commands in the same session. " +
      "Output is limited to 64 KB per stream (stdout/stderr). " +
      "Commands are executed sequentially; a long-running command will block subsequent invocations. " +
      "If LANGSMITH_API_KEY is set, commands run in a cloud microVM; otherwise they run in a local temp directory.",
    schema: sandboxExecSchema,
    surfaces: ["langchain"],
    invoke: async (args: SandboxExecInput, ctx: ToolContext) => {
      const threadId = ctx.threadId;
      if (!threadId) {
        throw new Error("threadId is required in tool context");
      }

      // Validate cwd
      if (args.cwd) {
        validateCwd(args.cwd);
      }

      // Clamp timeout
      let timeout = args.timeout ?? 30000;
      timeout = Math.max(1000, Math.min(120000, timeout));

      const manager = getChatSandboxManager();
      const sandbox = await manager.getSandbox(threadId);
      const runId = randomUUID();
      const emitter = getToolEventEmitter();
      const startedAt = Date.now();

      // Emit queued event
      if (emitter) {
        emitter.sandboxRun({
          id: runId,
          command: args.command,
          status: "queued",
          startedAt,
        });
      }

      try {
        // Emit running event
        if (emitter) {
          emitter.sandboxRun({
            id: runId,
            command: args.command,
            status: "running",
          });
        }

        const result = await sandbox.exec(args.command, {
          timeout,
          cwd: args.cwd,
          env: args.env as Record<string, string> | undefined,
          input: args.input,
        });

        const output: SandboxExecOutput = {
          success: result.exitCode === 0,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          signal: result.signal,
          duration: result.duration,
          command: args.command,
          cwd: args.cwd || ".",
        };

        // Emit completed event
        if (emitter) {
          emitter.sandboxRun({
            id: runId,
            command: args.command,
            status: "completed",
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            duration: result.duration,
          });
        }

        return JSON.stringify(output);
      } catch (err) {
        // Emit error event
        if (emitter) {
          emitter.sandboxRun({
            id: runId,
            command: args.command,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
            duration: Date.now() - startedAt,
            startedAt,
          });
        }
        throw err;
      }
    },
  }),
] as const;
