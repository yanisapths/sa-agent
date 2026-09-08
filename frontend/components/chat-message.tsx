/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useCallback } from "react";
import { Bot, User, Copy, Check, FileText, GitBranch, Download } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { type ChatUsage } from "@/features/gateway/types";
import {
  artifactService,
  triggerBlobDownload,
} from "@/features/artifacts/service";
import { type ChatArtifact } from "@/features/artifacts/types";
import { UsageBadge } from "./usage-badge";


export type Role = "user" | "assistant";

export interface UIMessagePart {
  type: string;
  text: string;
}
export interface UIMessage {
  id: string;
  role: Role;
  parts: UIMessagePart[];
  /** Tokens and cost for the turn that produced this message. */
  usage?: ChatUsage;
  /** Files persisted this turn for download. */
  artifacts?: ChatArtifact[];
}

export interface ApiSpecPart extends UIMessagePart {
  type: "api_spec";
  method?: string;
  endpoint?: string;
  description?: string;
  auth?: string;
  parameters?: Record<string, unknown>[];
  responses?: Record<string, unknown>;
  componentSchemas?: Record<string, unknown>;
  notes?: string[];
}
export interface SqlPart extends UIMessagePart {
  type: "sql";
  query?: string;
  reasoning?: string;
}
export interface ImagePart extends UIMessagePart {
  type: "image";
  src: string;
  name?: string;
}

export interface FilePart extends UIMessagePart {
  type: "file";
  name: string;
}

export interface DiagramPart extends UIMessagePart {
  type: "diagram";
  diagramType?: string;
  title?: string;
  content: string;
}

export interface CodePart extends UIMessagePart {
  type: "code";
  language?: string;
  filename?: string;
  title?: string;
  description?: string;
  code: string;
}

export type UIPart =
  | UIMessagePart
  | ApiSpecPart
  | SqlPart
  | ImagePart
  | FilePart
  | DiagramPart
  | CodePart;


const cn = (...c: (string | false | undefined | null)[]) =>
  c.filter(Boolean).join(" ");

const METHOD_COLOR: Record<string, string> = {
  GET: "text-sky-600 bg-sky-50 border-sky-200",
  POST: "text-emerald-600 bg-emerald-50 border-emerald-200",
  PUT: "text-amber-600 bg-amber-50 border-amber-200",
  PATCH: "text-orange-600 bg-orange-50 border-orange-200",
  DELETE: "text-red-600 bg-red-50 border-red-200",
};

const STATUS_COLOR: Record<string, string> = {
  "2": "text-emerald-600 bg-emerald-50 border-emerald-200",
  "4": "text-amber-600 bg-amber-50 border-amber-200",
  "5": "text-red-600 bg-red-50 border-red-200",
};

function CopyButton({ text }: { text: string }) {
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
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
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

function MarkdownContent({ text }: { text: string }) {
  const tokens = tokenize(text);

  // Collapse consecutive blank tokens
  const nodes: React.ReactNode[] = [];
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

  return <div className="space-y-0.5">{nodes}</div>;
}


function DiagramDisplay({ part }: { part: DiagramPart }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden text-sm w-full">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/10 border-b border-border">
        <div className="flex items-center gap-2">
          <GitBranch className="w-3.5 h-3.5 text-primary dark:text-light" />
          <span className="text-xs font-medium text-muted uppercase tracking-wide">
            {part.title || part.diagramType || "Diagram"}
          </span>
        </div>
        <CopyButton text={part.content} />
      </div>
      <pre className="px-3 py-3 text-xs font-mono text-foreground overflow-x-auto bg-surface whitespace-pre">
        {part.content}
      </pre>
    </div>
  );
}


function ApiSpecDisplay({ part }: { part: ApiSpecPart }) {
  const [openCode, setOpenCode] = useState<string | null>(null);
  const responses = part.responses ?? {};
  const schemas = (part.componentSchemas ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const parameters = part.parameters ?? [];

  const methodColor =
    METHOD_COLOR[(part.method ?? "").toUpperCase()] ??
    "text-muted bg-muted/10 border-border";

  const getFields = (
    r: Record<string, unknown>,
  ): Record<string, Record<string, unknown>> => {
    const flat = r.schema as Record<string, unknown> | undefined;
    if (flat?.type === "array") {
      return ((flat.items as any)?.properties ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
    }
    if (flat?.type === "object") {
      return (flat.properties ?? {}) as Record<string, Record<string, unknown>>;
    }
    const jsonSchema = (r.content as any)?.["application/json"]?.schema as
      | Record<string, unknown>
      | undefined;
    if (jsonSchema?.$ref) return {};
    if (jsonSchema?.properties)
      return jsonSchema.properties as Record<string, Record<string, unknown>>;
    return {};
  };

  const getRef = (r: Record<string, unknown>): string | undefined => {
    const jsonSchema = (r.content as any)?.["application/json"]?.schema as
      | Record<string, unknown>
      | undefined;
    return jsonSchema?.$ref as string | undefined;
  };

  const getExample = (r: Record<string, unknown>): unknown =>
    r.example ?? (r.content as any)?.["application/json"]?.example;

  return (
    <div className="border border-border rounded-lg overflow-hidden text-sm w-full">
      <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/10 border-b border-border">
        <span
          className={cn(
            "px-2 py-0.5 rounded text-xs font-mono font-semibold border",
            methodColor,
          )}
        >
          {part.method?.toUpperCase()}
        </span>
        <code className="text-foreground text-xs font-mono">{part.endpoint}</code>
      </div>

      {part.description && (
        <p className="px-3 py-2 text-muted text-xs border-b border-border">
          {part.description}
        </p>
      )}

      {part.auth && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <span className="text-xs text-muted w-16">Auth</span>
          <code className="text-xs text-foreground/80 bg-muted/15 px-1.5 py-0.5 rounded">
            {part.auth}
          </code>
        </div>
      )}

      {parameters.length > 0 && (
        <div className="border-b border-border">
          <p className="px-3 py-1.5 text-xs font-medium text-muted uppercase tracking-wide">
            Parameters
          </p>
          {parameters.map((p: any, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-3 py-1.5 border-t border-border"
            >
              <code className="text-xs text-foreground/80 w-32 truncate">
                {p.name}
              </code>
              <span className="text-xs text-muted bg-muted/10 border border-border px-1.5 py-0.5 rounded">
                {p.in}
              </span>
              {p.required && (
                <span className="text-xs text-red-400">required</span>
              )}
              {p.description && (
                <span className="text-xs text-muted truncate">
                  {p.description}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {Object.keys(responses).length > 0 && (
        <div>
          <p className="px-3 py-1.5 text-xs font-medium text-muted uppercase tracking-wide border-b border-border">
            Responses
          </p>
          {Object.entries(responses).map(([code, resp]) => {
            const r = resp as Record<string, unknown>;
            const isOpen = openCode === code;
            const fields = getFields(r);
            const ref = getRef(r);
            const refName = ref?.split("/").pop();
            const resolvedSchema = refName ? schemas[refName] : undefined;
            const example = getExample(r);
            const hasDetail =
              Object.keys(fields).length > 0 ||
              !!resolvedSchema ||
              example !== undefined;
            const statusColor =
              STATUS_COLOR[code[0]] ??
              "text-muted bg-muted/10 border-border";

            return (
              <div key={code} className="border-t border-border">
                <button
                  onClick={() => hasDetail && setOpenCode(isOpen ? null : code)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/10 transition-colors"
                >
                  <span
                    className={cn(
                      "text-xs font-mono font-semibold px-1.5 py-0.5 rounded border",
                      statusColor,
                    )}
                  >
                    {code}
                  </span>
                  <span className="text-xs text-muted flex-1">
                    {String(r.description ?? "")}
                  </span>
                  {hasDetail && (
                    <span
                      className={cn(
                        "text-muted text-xs transition-transform",
                        isOpen && "rotate-180",
                      )}
                    >
                      ▾
                    </span>
                  )}
                </button>

                {isOpen && hasDetail && (
                  <div className="px-3 pb-3 space-y-2 bg-muted/10">
                    {Object.keys(fields).length > 0 && (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted">
                            <th className="text-left py-1 font-medium">
                              field
                            </th>
                            <th className="text-left py-1 font-medium">type</th>
                            <th className="text-left py-1 font-medium">
                              description
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(fields).map(([name, s]) => (
                            <tr key={name} className="border-t border-border">
                              <td className="py-1 pr-3 font-mono text-foreground/80">
                                {name}
                              </td>
                              <td className="py-1 pr-3 text-sky-600">
                                {String(s.type ?? "")}
                              </td>
                              <td className="py-1 text-muted">
                                {String(s.description ?? "")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {resolvedSchema &&
                      (() => {
                        const props = (resolvedSchema.properties ??
                          {}) as Record<string, Record<string, unknown>>;
                        const req = (resolvedSchema.required ?? []) as string[];
                        return (
                          <div>
                            <p className="text-xs text-muted mb-1 font-mono">
                              {refName}
                            </p>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-muted">
                                  <th className="text-left py-1 font-medium">
                                    field
                                  </th>
                                  <th className="text-left py-1 font-medium">
                                    type
                                  </th>
                                  <th className="text-left py-1 font-medium">
                                    description
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(props).map(([name, s]) => (
                                  <tr
                                    key={name}
                                    className="border-t border-border"
                                  >
                                    <td className="py-1 pr-3 font-mono text-foreground/80">
                                      {name}
                                      {req.includes(name) && (
                                        <span className="text-red-400 ml-1">
                                          *
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-1 pr-3 text-sky-600">
                                      {String(s.type ?? "")}
                                    </td>
                                    <td className="py-1 text-muted">
                                      {String(s.description ?? "")}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        );
                      })()}

                    {example !== undefined && (
                      <div className="relative">
                        <div className="absolute top-2 right-2">
                          <CopyButton text={JSON.stringify(example, null, 2)} />
                        </div>
                        <pre className="bg-gray-900 text-gray-100 text-xs rounded p-3 overflow-x-auto font-mono">
                          {JSON.stringify(example, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {Object.keys(schemas).length > 0 && (
        <details className="border-t border-border">
          <summary className="px-3 py-2 text-xs text-muted cursor-pointer hover:text-foreground hover:bg-muted/10">
            Schemas ({Object.keys(schemas).length})
          </summary>
          <div className="px-3 pb-3 space-y-3">
            {Object.entries(schemas).map(([name, s]) => {
              const props = (s.properties ?? {}) as Record<
                string,
                Record<string, unknown>
              >;
              const req = (s.required ?? []) as string[];
              return (
                <div key={name}>
                  <p className="text-xs font-mono text-muted mb-1">{name}</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted">
                        <th className="text-left py-1 font-medium">field</th>
                        <th className="text-left py-1 font-medium">type</th>
                        <th className="text-left py-1 font-medium">
                          description
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(props).map(([fn, fs]) => (
                        <tr key={fn} className="border-t border-border">
                          <td className="py-1 pr-3 font-mono text-foreground/80">
                            {fn}
                            {req.includes(fn) && (
                              <span className="text-red-400 ml-1">*</span>
                            )}
                          </td>
                          <td className="py-1 pr-3 text-sky-600">
                            {String(fs.type ?? "")}
                          </td>
                          <td className="py-1 text-muted">
                            {String(fs.description ?? "")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {(part.notes ?? []).length > 0 && (
        <div className="border-t border-border px-3 py-2.5 space-y-1">
          <p className="text-xs font-medium text-muted uppercase tracking-wide mb-1.5">
            Notes
          </p>
          {part.notes!.map((note, i) => (
            <p key={i} className="text-xs text-muted flex gap-2">
              <span className="text-muted/50 select-none">—</span>
              {note}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}


function SqlDisplay({ part }: { part: SqlPart }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden text-sm">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/10 border-b border-border">
        <span className="text-xs font-medium text-muted uppercase tracking-wide">
          SQL
        </span>
        <CopyButton text={part.query ?? part.text} />
      </div>
      <pre className="px-3 py-3 text-xs font-mono text-foreground overflow-x-auto bg-surface">
        {part.query ?? part.text}
      </pre>
      {part.reasoning && (
        <p className="px-3 py-2 text-xs text-muted border-t border-border bg-muted/10">
          {part.reasoning}
        </p>
      )}
    </div>
  );
}

function CodeDisplay({ part }: { part: CodePart }) {
  const download = () => {
    const blob = new Blob([part.code], { type: "text/plain" });
    triggerBlobDownload(blob, part.filename || "code.txt");
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden text-sm">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/10 border-b border-border">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted uppercase tracking-wide">
            {part.title || part.filename || part.language || "Code"}
          </p>
          {part.description ? (
            <p className="text-xs text-muted mt-0.5 truncate">
              {part.description}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CopyButton text={part.code} />
          <button
            type="button"
            onClick={download}
            className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors"
          >
            <Download className="w-3 h-3" />
            Download
          </button>
        </div>
      </div>
      <pre className="px-3 py-3 text-xs font-mono text-foreground overflow-x-auto bg-surface">
        {part.code}
      </pre>
    </div>
  );
}

function ArtifactChips({ artifacts }: { artifacts: ChatArtifact[] }) {
  const download = async (artifact: ChatArtifact) => {
    const blob = await artifactService.downloadFile(artifact.id);
    triggerBlobDownload(blob, artifact.name);
  };

  return (
    <ul className="flex flex-col gap-1.5">
      {artifacts.map((artifact) => (
        <li
          key={artifact.id}
          className="flex items-center gap-2 rounded-lg border border-border bg-surface/80 px-2.5 py-1.5 text-xs"
        >
          <FileText className="w-3.5 h-3.5 shrink-0 text-muted" />
          <span className="min-w-0 truncate font-medium">{artifact.name}</span>
          <span className="shrink-0 text-muted">
            {artifact.mentionToken}
          </span>
          <button
            type="button"
            onClick={() => void download(artifact)}
            className="ml-auto flex shrink-0 items-center gap-1 text-muted hover:text-foreground"
          >
            <Download className="w-3 h-3" />
            Download
          </button>
          <Link
            href={`/artifacts?file=${encodeURIComponent(artifact.id)}`}
            className="shrink-0 text-muted hover:text-foreground"
          >
            Open
          </Link>
        </li>
      ))}
    </ul>
  );
}


function MessagePart({ part }: { part: UIPart }) {
  if (part.type === "diagram")
    return <DiagramDisplay part={part as DiagramPart} />;
  if (part.type === "api_spec")
    return <ApiSpecDisplay part={part as ApiSpecPart} />;
  if (part.type === "sql") return <SqlDisplay part={part as SqlPart} />;
  if (part.type === "code") return <CodeDisplay part={part as CodePart} />;

  if (part.type === "image") {
    const p = part as ImagePart;
    return (
      <Image
        width={240}
        height={180}
        src={p.src}
        alt={p.name ?? "attachment"}
        className="max-w-[240px] max-h-[180px] rounded-lg object-cover border border-white/20"
      />
    );
  }

  if (part.type === "file") {
    const p = part as FilePart;
    return (
      <div className="flex items-center gap-2 bg-surface/10 rounded-lg px-2.5 py-1.5 text-xs">
        <FileText className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate max-w-[160px]">{p.name}</span>
      </div>
    );
  }

  if (!part.text) return null;

  // Detect markdown: headings, tables, code fences, lists
  const looksLikeMarkdown =
    /^#{1,4}\s/m.test(part.text) ||
    /^\|.+\|$/m.test(part.text) ||
    /^```/m.test(part.text) ||
    /^\s*[-*+]\s/m.test(part.text);

  if (looksLikeMarkdown) {
    return <MarkdownContent text={part.text} />;
  }

  // Plain text — original line-by-line rendering
  return (
    <div className="space-y-1">
      {part.text.split("\n").map((line, i) => (
        <p key={i} className={cn("text-sm leading-relaxed", !line && "h-4")}>
          {line}
        </p>
      ))}
    </div>
  );
}


export function ChatMessage({
  message,
  isStreaming = false,
}: {
  message: UIMessage;
  isStreaming?: boolean;
}) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-4",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      <div
        className={cn(
          "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 border",
          isUser
            ? "bg-muted/15 border-border"
            : "bg-light/10 dark:bg-light/15 border-light/40",
        )}
      >
        {isUser ? (
          <User className="w-3.5 h-3.5 text-foreground" />
        ) : (
          <Bot className="w-3.5 h-3.5 text-primary dark:text-light" />
        )}
      </div>
      <div
        className={cn(
          "flex flex-col gap-1 max-w-[85%]",
          isUser ? "items-end" : "items-start",
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm",
            isUser
              ? "bg-muted/30 text-foreground rounded-tr-sm"
              : "bg-surface border border-border text-foreground rounded-tl-sm",
          )}
        >
          <div className="space-y-2">
            {message.parts?.map((part, i) => (
              <MessagePart key={i} part={part as UIPart} />
            ))}
            {isStreaming && (
              <span className="inline-block w-0.5 h-4 bg-muted ml-0.5 align-middle animate-pulse rounded" />
            )}
            {!isUser &&
              !isStreaming &&
              (message.artifacts?.length ?? 0) > 0 && (
                <ArtifactChips artifacts={message.artifacts ?? []} />
              )}
          </div>
        </div>
        {/* Only once the answer is complete — a cost that ticks up mid-render reads as noise. */}
        {!isUser && !isStreaming && message.usage && (
          <UsageBadge usage={message.usage} />
        )}
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex gap-3 px-4 py-4">
      <div className="w-7 h-7 rounded-full bg-light/10 dark:bg-light/15 border border-light/40 flex items-center justify-center">
        <Bot className="w-3.5 h-3.5 text-primary dark:text-light" />
      </div>
      <div className="bg-surface border border-border rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5 h-10">
        {[0, 150, 300].map((d) => (
          <span
            key={d}
            className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce"
            style={{ animationDelay: `${d}ms`, animationDuration: "1.1s" }}
          />
        ))}
      </div>
    </div>
  );
}
