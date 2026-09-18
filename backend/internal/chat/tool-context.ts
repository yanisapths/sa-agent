import { AsyncLocalStorage } from "node:async_hooks";
import type { SandboxRunData } from "./events";

const asyncLocalStorage = new AsyncLocalStorage<ToolEventEmitter>();

export interface ToolEventEmitter {
  sandboxRun: (event: SandboxRunData) => void;
}

export function withToolEventEmitter<T>(
  emitter: ToolEventEmitter,
  fn: () => Promise<T>,
): Promise<T> {
  return asyncLocalStorage.run(emitter, fn);
}

export function getToolEventEmitter(): ToolEventEmitter | undefined {
  return asyncLocalStorage.getStore();
}
