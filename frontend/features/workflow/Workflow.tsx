"use client";

import { Button } from "@/components/ui/Button";
import { useChatSession } from "@/features/chat-session/ChatSessionProvider";
import { artifactService } from "@/features/artifacts/service";
import { type ArtifactFile } from "@/features/artifacts/types";
import { cn } from "@/lib/utils";
import { Volume2, VolumeX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { KanbanBoard } from "./KanbanBoard";
import {
  columnForPhase,
  phaseLabel,
  phaseOf,
  trackOf,
  type WorkflowTrack,
} from "./columns";
import { type WorkflowCard } from "./types";

function firstHeading(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/^#\s+(.+)$/m);
  const value = match?.[1]?.trim();
  return value || null;
}

function latestByThread(files: ArtifactFile[]): ArtifactFile[] {
  const map = new Map<string, ArtifactFile>();
  for (const file of files) {
    const current = map.get(file.threadId);
    if (!current) {
      map.set(file.threadId, file);
      continue;
    }
    if (Date.parse(file.updatedAt) >= Date.parse(current.updatedAt)) {
      map.set(file.threadId, file);
    }
  }
  return [...map.values()];
}

function fallbackTitle(threadId: string, phase: string | null): string {
  return `${phaseLabel(phase)} · Chat ${threadId.slice(0, 8)}`;
}

export function Workflow() {
  const router = useRouter();
  const { session, soundsMuted, setSoundsMuted } = useChatSession();
  const [track, setTrack] = useState<WorkflowTrack>("sa");
  const [files, setFiles] = useState<ArtifactFile[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void artifactService
      .listFiles()
      .then((data) => {
        if (cancelled) return;
        setFiles(data);
        setStatus("ready");
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load workflow");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [session.settledAt]);

  useEffect(() => {
    const latest = latestByThread(files);
    if (latest.length === 0) return;
    let cancelled = false;
    void Promise.allSettled(
      latest.map(async (file) => {
        const content = await artifactService.getContent(file.id);
        return [file.threadId, firstHeading(content.text)] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const entry of entries) {
        if (entry.status !== "fulfilled") continue;
        const [threadId, heading] = entry.value;
        if (heading) next[threadId] = heading;
      }
      setTitles(next);
    });
    return () => {
      cancelled = true;
    };
  }, [files]);

  const cards = useMemo(() => {
    const latest = latestByThread(files);
    const byThread = new Map<string, WorkflowCard>();

    for (const file of latest) {
      const phase = phaseOf(file);
      const cardTrack = trackOf(phase);
      if (!cardTrack) continue;
      const live =
        session.threadId === file.threadId &&
        (session.status === "submitted" || session.status === "streaming");
      const livePhase = live ? session.phase ?? phase : phase;
      byThread.set(file.threadId, {
        threadId: file.threadId,
        title: titles[file.threadId] ?? fallbackTitle(file.threadId, livePhase),
        phase: livePhase,
        column: columnForPhase(livePhase, live),
        filename: file.name,
        artifactId: file.id,
        updatedAt: live
          ? new Date(session.updatedAt || Date.parse(file.updatedAt)).toISOString()
          : file.updatedAt,
        live,
        track: trackOf(livePhase) ?? cardTrack,
      });
    }

    const live =
      Boolean(session.threadId) &&
      (session.status === "submitted" || session.status === "streaming");
    if (session.threadId && !byThread.has(session.threadId) && session.phase) {
      const phase = session.phase;
      const cardTrack = trackOf(phase) ?? "sa";
      byThread.set(session.threadId, {
        threadId: session.threadId,
        title: fallbackTitle(session.threadId, phase),
        phase,
        column: columnForPhase(phase, live),
        filename: null,
        artifactId: null,
        updatedAt: new Date(session.updatedAt).toISOString(),
        live,
        track: cardTrack,
      });
    }

    return [...byThread.values()]
      .filter((card) => card.track === track)
      .sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      );
  }, [files, titles, session, track]);

  const openChat = () => {
    router.push("/");
  };

  if (status === "loading" && files.length === 0) {
    return (
      <p className="p-6 text-sm text-muted" role="status">
        Loading workflow...
      </p>
    );
  }

  if (status === "error" && files.length === 0) {
    return (
      <section className="flex h-full flex-col items-start justify-center gap-3 p-6">
        <h1 className="text-lg font-semibold">Could not load Workflow</h1>
        <p className="text-sm text-muted">{error}</p>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Workflow</h1>
          <p className="mt-1 text-sm text-muted">
            Phase loop for the orchestrator. Approve in chat, then ship
            yourself — the agent does not commit.
          </p>
        </div>
        <div
          className="flex rounded-xl border border-border p-0.5"
          role="group"
          aria-label="Workflow track"
        >
          {(["sa", "pvt"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTrack(item)}
              className={cn(
                "cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium",
                track === item
                  ? "bg-muted/15 text-foreground"
                  : "text-muted hover:text-foreground",
              )}
            >
              {item === "sa" ? "SA" : "PVT"}
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="icon"
          size="sm"
          aria-pressed={soundsMuted}
          aria-label={soundsMuted ? "Unmute notification sounds" : "Mute notification sounds"}
          onClick={() => setSoundsMuted(!soundsMuted)}
        >
          {soundsMuted ? (
            <VolumeX className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
        </Button>
      </header>

      {error && files.length > 0 ? (
        <p className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}

      <KanbanBoard cards={cards} onOpen={openChat} onShip={openChat} />
    </section>
  );
}
