"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/** Portal overlay like `AddFolderDialog`, plus Escape, initial focus and focus restore. */
export function Dialog({ open, title, description, onClose, children, className }: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>(
      "input, select, textarea, button, [href], [tabindex]:not([tabindex='-1'])",
    );
    first?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previous?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="aster-overlay flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-lg",
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        {description ? <div className="mt-1 text-xs text-muted">{description}</div> : null}
        <div className="mt-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
