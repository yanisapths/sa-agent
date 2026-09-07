"use client";

import { useEffect, useState } from "react";
import { artifactService } from "./service";
import { type ArtifactMention } from "./types";

export function useArtifactMentions(): ArtifactMention[] {
  const [mentions, setMentions] = useState<ArtifactMention[]>([]);

  useEffect(() => {
    let cancelled = false;
    void artifactService
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
