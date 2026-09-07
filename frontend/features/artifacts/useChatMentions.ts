"use client";

import { useVaultMentions } from "@/features/vault/useVaultMentions";
import { useWorkspaceMentions } from "@/features/workspace/useWorkspaceMentions";
import { useArtifactMentions } from "./useArtifactMentions";

/** Vault, artifacts, and `@Projects/...` tokens for chat autocomplete. */
export function useChatMentions(query: string | null = null): {
  token: string;
  label: string;
}[] {
  const vault = useVaultMentions();
  const artifacts = useArtifactMentions();
  const projects = useWorkspaceMentions(query);
  return [...vault, ...artifacts, ...projects];
}
