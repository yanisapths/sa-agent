import { scrubSecrets } from "../../internal/product/connections";

/**
 * The deep agent's tool middleware re-throws anything a tool raises, which
 * aborts the whole run and turns one unreachable dependency into a 500 on
 * `/chat`. Tools therefore report failures as text so the model can fall back
 * to another source or tell the user what is misconfigured.
 *
 * The text reaches the model, the checkpoint and traces, so a driver error
 * that echoes a connection string or token is scrubbed first.
 */
export async function orToolError(
  source: string,
  run: () => Promise<string>,
): Promise<string> {
  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `${source} is unavailable: ${scrubSecrets(message)}`;
  }
}
