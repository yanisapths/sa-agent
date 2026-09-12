"use client";

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { type ChatFeedback, type UserScore } from "@/lib/chat-stream";

export function MessageFeedback({
  feedback,
  disabled = false,
  onSubmit,
}: {
  feedback: ChatFeedback;
  disabled?: boolean;
  onSubmit: (score: UserScore, comment?: string) => Promise<void>;
}) {
  const selected = feedback.score;
  const [downOpen, setDownOpen] = useState(false);
  const [comment, setComment] = useState(feedback.comment ?? "");
  const [busy, setBusy] = useState(false);

  const locked = disabled || busy || selected !== undefined;

  const send = async (score: UserScore, note?: string) => {
    if (locked) return;
    setBusy(true);
    try {
      await onSubmit(score, note?.trim() || undefined);
      setDownOpen(false);
    } catch {
      /* stay interactive so the user can retry */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Helpful"
          disabled={locked && selected !== 1}
          onClick={() => void send(1)}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
            selected === 1
              ? "text-foreground"
              : "text-muted/80 hover:bg-muted/20 hover:text-foreground"
          } disabled:pointer-events-none disabled:opacity-50`}
        >
          <ThumbsUp
            className="h-3.5 w-3.5"
            fill={selected === 1 ? "currentColor" : "none"}
          />
        </button>
        <button
          type="button"
          aria-label="Not helpful"
          disabled={locked && selected !== -1}
          onClick={() => {
            if (locked) return;
            if (selected !== undefined) return;
            setDownOpen((open) => !open);
          }}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
            selected === -1
              ? "text-foreground"
              : "text-muted/80 hover:bg-muted/20 hover:text-foreground"
          } disabled:pointer-events-none disabled:opacity-50`}
        >
          <ThumbsDown
            className="h-3.5 w-3.5"
            fill={selected === -1 ? "currentColor" : "none"}
          />
        </button>
        {selected !== undefined && (
          <span className="text-[11px] text-muted/80">Thanks for the feedback</span>
        )}
      </div>
      {downOpen && selected === undefined && (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void send(-1, comment);
          }}
        >
          <input
            type="text"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="What went wrong? (optional)"
            maxLength={2000}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-[11px] text-foreground outline-none placeholder:text-muted/70 focus:border-muted"
          />
          <button
            type="submit"
            disabled={busy}
            className="h-7 rounded-md border border-border px-2 text-[11px] text-foreground hover:bg-muted/20 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      )}
    </div>
  );
}
