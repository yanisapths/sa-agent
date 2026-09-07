"use client";

import { useEffect, useState } from "react";

import { workspaceService } from "./service";
import { type WorkspaceMention } from "./types";

/**
 * Folder tokens on mount; file matches while the human is typing `@…`.
 * A full repo is never preloaded.
 */
export function useWorkspaceMentions(query: string | null): WorkspaceMention[] {
  const [mentions, setMentions] = useState<WorkspaceMention[]>([]);

  useEffect(() => {
    let cancelled = false;
    const q = query ?? "";
    const handle = window.setTimeout(() => {
      void workspaceService
        .listMentions(q)
        .then((data) => {
          if (!cancelled) setMentions(data);
        })
        .catch(() => {
          if (!cancelled) setMentions([]);
        });
    }, query === null ? 0 : 200);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query]);

  return mentions;
}
