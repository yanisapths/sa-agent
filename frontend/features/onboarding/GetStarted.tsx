"use client";

import { CheckCircle2, Circle, ExternalLink } from "lucide-react";
import { useState } from "react";

import { useProduct } from "@/features/product/ProductProvider";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";

import { hasSentFirstMessage } from "./progress";

const GUIDES = [
  { slug: "cursor", label: "Cursor" },
  { slug: "claude-code", label: "Claude Code" },
  { slug: "codex-mcp", label: "Codex (MCP)" },
  { slug: "models", label: "Models" },
  { slug: "add-product", label: "Add a product" },
] as const;

/** Derived from live state, not stored, except the first-message flag. */
export function GetStarted() {
  const { products, active, capabilities, openDialog } = useProduct();
  const { workspaces } = useWorkspace();
  const [firstMessage] = useState(() => typeof window !== "undefined" && hasSentFirstMessage());

  const hasProduct =
    products.some((item) => !item.isDefault) || Boolean(active?.isDefault && workspaces.length > 0);
  const hasSource = capabilities.db === "on" || capabilities.docs === "on";

  const steps = [
    {
      label: "Add a product",
      done: hasProduct,
      action: () => openDialog("add"),
    },
    {
      label: "Connect docs or a database",
      done: hasSource,
      action: () => openDialog("connections"),
    },
    { label: "Send your first message", done: firstMessage },
  ];

  if (steps.every((step) => step.done)) return null;

  const docsUrl = process.env.NEXT_PUBLIC_DOCS_URL?.replace(/\/+$/, "");

  return (
    <section
      aria-labelledby="get-started-title"
      className="mb-6 w-full max-w-3xl rounded-2xl border border-border bg-surface/70 p-4 backdrop-blur-md"
    >
      <h2 id="get-started-title" className="text-sm font-semibold">
        Three steps and you&apos;re running.
      </h2>
      <ol className="mt-3 grid gap-2 sm:grid-cols-3">
        {steps.map((step) => {
          const content = (
            <>
              {step.done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              )}
              <span className={step.done ? "text-muted line-through" : undefined}>{step.label}</span>
              <span className="sr-only">{step.done ? "(done)" : "(to do)"}</span>
            </>
          );
          return (
            <li key={step.label}>
              {step.action && !step.done ? (
                <button
                  type="button"
                  onClick={step.action}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted/10"
                >
                  {content}
                </button>
              ) : (
                <span className="flex items-center gap-2 px-2 py-1.5 text-sm">{content}</span>
              )}
            </li>
          );
        })}
      </ol>
      {docsUrl ? (
        <nav aria-label="Guides" className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {GUIDES.map((guide) => (
            <a
              key={guide.slug}
              href={`${docsUrl}/guides/${guide.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-muted hover:text-foreground"
            >
              {guide.label}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ))}
        </nav>
      ) : null}
    </section>
  );
}
