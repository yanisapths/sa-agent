import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Conversation id for this `/chat` invoke. Model instances are built once per
 * id and reused, so gatewayFetch reads the thread from here rather than from
 * constructor args — same pattern as workspaceRoot / vault mount.
 */
const store = new AsyncLocalStorage<string>();

export function currentLlmSession(): string | undefined {
  const session = store.getStore();
  return session && session.trim() ? session.trim() : undefined;
}

export function withLlmSession<T>(
  threadId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const session = threadId?.trim();
  if (!session) return fn();
  return store.run(session, fn);
}
