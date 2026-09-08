import type { ChatArtifact } from "../../contract/chat-response";
import {
  lastAssistantContent,
  normalizeArtifact,
  stripThinking,
  tryParseJsonObject,
} from "../artifacts";
import {
  persistPhaseArtifacts,
  uniqueArtifacts,
} from "../artifactStore/persist";
import { listFiles as listArtifactFiles } from "../artifactStore/service";
import { persistVaultEdits, type VaultMount } from "../vault/mount";

export function artifactFromState(result: unknown): {
  type: string;
  data: ChatArtifact;
} {
  const raw = stripThinking(lastAssistantContent(result));
  const parsed = tryParseJsonObject(raw);
  const data = parsed?.type
    ? normalizeArtifact(parsed)
    : { type: "text" as const, text: raw };
  return { type: data.type, data };
}

export async function persistTurnArtifacts(opts: {
  userId: string | undefined;
  threadId: string;
  phase: string | undefined;
  result: unknown;
  startedAt: number;
  vaultMount: VaultMount | undefined;
}): Promise<unknown[]> {
  let artifacts: unknown[] = [];
  if (!opts.userId) return artifacts;

  try {
    const persisted = await persistPhaseArtifacts(
      opts.userId,
      opts.threadId,
      opts.phase,
      opts.result,
      opts.startedAt,
    );
    const recent = (await listArtifactFiles(opts.userId, opts.threadId)).filter(
      (file) => Date.parse(file.updatedAt) >= opts.startedAt - 1000,
    );
    artifacts = uniqueArtifacts(persisted, recent);
  } catch (err) {
    console.error("Failed to persist artifacts:", err);
  }
  try {
    await persistVaultEdits(opts.vaultMount, opts.result);
  } catch (err) {
    console.error("Failed to persist vault edits:", err);
  }
  return artifacts;
}
