"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// Lightweight parser — no external deps. Handles:
//   headings (# ## ###), bold (**), inline code (`), fenced code blocks,
//   markdown tables, unordered/ordered lists, horizontal rules, blank lines.

type Token =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { kind: "code_block"; lang: string; code: string }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "ul_item"; text: string; depth: number }
  | { kind: "ol_item"; text: string; index: number }
  | { kind: "hr" }
  | { kind: "blank" }
  | { kind: "paragraph"; text: string };

function tokenize(markdown: string): Token[] {
  const lines = markdown.split("\n");
  const tokens: Token[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fenced code block
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      tokens.push({ kind: "code_block", lang, code: codeLines.join("\n") });
      i++; // skip closing fence
      continue;
    }

    // Heading
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      tokens.push({
        kind: "heading",
        level: headingMatch[1].length as 1 | 2 | 3 | 4,
        text: headingMatch[2],
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmed)) {
      tokens.push({ kind: "hr" });
      i++;
      continue;
    }

    // Table (line contains pipes and next line is separator)
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const headers = trimmed
        .slice(1, -1)
        .split("|")
        .map((h) => h.trim());
      // Check next line is separator
      const next = lines[i + 1]?.trim() ?? "";
      if (/^\|[-| :]+\|$/.test(next)) {
        i += 2; // skip header + separator
        const rows: string[][] = [];
        while (
          i < lines.length &&
          lines[i].trim().startsWith("|") &&
          lines[i].trim().endsWith("|")
        ) {
          rows.push(
            lines[i]
              .trim()
              .slice(1, -1)
              .split("|")
              .map((c) => c.trim()),
          );
          i++;
        }
        tokens.push({ kind: "table", headers, rows });
        continue;
      }
    }

    // Unordered list item
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)/);
    if (ulMatch) {
      tokens.push({
        kind: "ul_item",
        text: ulMatch[2],
        depth: Math.floor(ulMatch[1].length / 2),
      });
      i++;
      continue;
    }

    // Ordered list item
    const olMatch = line.match(/^\s*(\d+)\.\s+(.+)/);
    if (olMatch) {
      tokens.push({
        kind: "ol_item",
        text: olMatch[2],
        index: parseInt(olMatch[1]),
      });
      i++;
      continue;
    }

    // Blank line
    if (!trimmed) {
      tokens.push({ kind: "blank" });
      i++;
      continue;
    }

    // Paragraph / continuation
    tokens.push({ kind: "paragraph", text: trimmed });
    i++;
  }

  return tokens;
}

// Render inline markdown: **bold**, `code`, plain text
function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  // Split on **bold** and `code`
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const chunk = m[0];
    if (chunk.startsWith("**")) {
      parts.push(<strong key={key++}>{chunk.slice(2, -2)}</strong>);
    } else {
      parts.push(
        <code
          key={key++}
          className="px-1 py-0.5 rounded text-[11px] font-mono bg-muted/15 text-foreground/80 border border-border"
        >
          {chunk.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + chunk.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function MarkdownCodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <div className="my-2 rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-700">
        <span className="text-[10px] font-mono text-muted uppercase tracking-wider">
          {lang || "code"}
        </span>
        <CopyButton text={code} />
      </div>
      <pre className="bg-gray-900 text-gray-100 text-xs font-mono px-3 py-3 overflow-x-auto whitespace-pre leading-relaxed">
        {code}
      </pre>
    </div>
  );
}

function MarkdownTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="my-2 rounded-lg border border-border overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/10 border-b border-border">
            {headers.map((h, i) => (
              <th
                key={i}
                className="px-3 py-2 text-left font-medium text-muted uppercase tracking-wide text-[10px]"
              >
                {renderInline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              className={cn(
                "border-t border-border",
                ri % 2 === 1 ? "bg-muted/10" : "bg-surface",
              )}
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="px-3 py-2 text-foreground/80 font-mono leading-relaxed"
                >
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MarkdownContent({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const tokens = tokenize(text);

  // Collapse consecutive blank tokens
  const nodes: ReactNode[] = [];
  let key = 0;
  let lastWasBlank = false;

  for (const token of tokens) {
    if (token.kind === "blank") {
      lastWasBlank = true;
      continue;
    }

    if (lastWasBlank && nodes.length) {
      // small spacer between blocks
      nodes.push(<div key={key++} className="h-2" />);
    }
    lastWasBlank = false;

    if (token.kind === "heading") {
      const Tag = `h${token.level}` as "h1" | "h2" | "h3" | "h4";
      const cls = {
        h1: "text-base font-semibold text-foreground mt-3 mb-1",
        h2: "text-sm font-semibold text-foreground mt-2.5 mb-1",
        h3: "text-xs font-semibold text-foreground/80 mt-2 mb-0.5 uppercase tracking-wide",
        h4: "text-xs font-medium text-muted mt-1.5 mb-0.5",
      }[Tag];
      nodes.push(
        <Tag key={key++} className={cls}>
          {renderInline(token.text)}
        </Tag>,
      );
    } else if (token.kind === "code_block") {
      nodes.push(
        <MarkdownCodeBlock key={key++} lang={token.lang} code={token.code} />,
      );
    } else if (token.kind === "table") {
      nodes.push(
        <MarkdownTable key={key++} headers={token.headers} rows={token.rows} />,
      );
    } else if (token.kind === "ul_item") {
      nodes.push(
        <div
          key={key++}
          className="flex gap-2 text-sm text-foreground/80 leading-relaxed"
          style={{ paddingLeft: `${token.depth * 12}px` }}
        >
          <span className="text-muted mt-0.5 select-none">•</span>
          <span>{renderInline(token.text)}</span>
        </div>,
      );
    } else if (token.kind === "ol_item") {
      nodes.push(
        <div
          key={key++}
          className="flex gap-2 text-sm text-foreground/80 leading-relaxed"
        >
          <span className="text-muted tabular-nums w-4 text-right shrink-0">
            {token.index}.
          </span>
          <span>{renderInline(token.text)}</span>
        </div>,
      );
    } else if (token.kind === "hr") {
      nodes.push(<hr key={key++} className="border-t border-border my-2" />);
    } else if (token.kind === "paragraph") {
      nodes.push(
        <p key={key++} className="text-sm text-foreground/80 leading-relaxed">
          {renderInline(token.text)}
        </p>,
      );
    }
  }

  return <div className={cn("space-y-0.5", className)}>{nodes}</div>;
}
