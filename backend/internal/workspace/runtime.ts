import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The attached project root for this `/chat` invoke. Tool backends are built
 * once per model and reused, so they read the folder from here (or from
 * LangGraph `configurable.workspaceRoot`) rather than from constructor args.
 */
const store = new AsyncLocalStorage<string>();

export function currentWorkspaceRoot(): string | undefined {
  const root = store.getStore();
  return root && root.trim() ? root.trim() : undefined;
}

export function withWorkspaceRoot<T>(
  root: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!root) return fn();
  return store.run(root, fn);
}
