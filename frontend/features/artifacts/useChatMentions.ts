"use client";

import { type MentionItem } from "@/components/chat-input";
import { useVaultMentions } from "@/features/vault/useVaultMentions";
import { useArtifactMentions } from "./useArtifactMentions";

/** Vault folders/files plus `@Artifacts/...` tokens for chat autocomplete. */
export function useChatMentions(): MentionItem[] {
  const vault = useVaultMentions();
  const artifacts = useArtifactMentions();
  return [...vault, ...artifacts];
}
