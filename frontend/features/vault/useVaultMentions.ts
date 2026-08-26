"use client";

import { useEffect, useState } from "react";
import { vaultService } from "./service";
import { type VaultMention } from "./types";

export function useVaultMentions(): VaultMention[] {
  const [mentions, setMentions] = useState<VaultMention[]>([]);

  useEffect(() => {
    let cancelled = false;
    void vaultService
      .listMentions()
      .then((data) => {
        if (!cancelled) setMentions(data);
      })
      .catch(() => {
        if (!cancelled) setMentions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return mentions;
}
