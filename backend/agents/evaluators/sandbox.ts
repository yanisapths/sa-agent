// Re-export from the shared internal module for backward compatibility
export type {
  IsolatedSandbox,
  ExecResult,
  ExecOptions,
} from "../../internal/sandbox/base";
export {
  langSmithSandboxConfigured,
  withIsolatedSandbox,
  withLangSmithSandbox,
} from "../../internal/sandbox/base";

// Re-export from langsmith for convenience
export type { Sandbox } from "langsmith/sandbox";
