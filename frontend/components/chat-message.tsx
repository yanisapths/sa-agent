/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useCallback } from "react";
import { Bot, User, Copy, Check, FileText, GitBranch } from "lucide-react";
import Image from "next/image";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Role = "user" | "assistant";

export interface UIMessagePart {
  type: string;
  text: string;
}
export interface UIMessage {
  id: string;
  role: Role;
  parts: UIMessagePart[];
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

export type UIPart =
  | UIMessagePart
  | ApiSpecPart
  | SqlPart
  | ImagePart
  | FilePart
  | FilePart;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ─── Markdown Renderer ────────────────────────────────────────────────────────
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
          className="px-1 py-0.5 rounded text-[11px] font-mono bg-gray-100 text-gray-700 border border-gray-200"
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
    <div className="my-2 rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-700">
        <span className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">
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
    <div className="my-2 rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {headers.map((h, i) => (
              <th
                key={i}
                className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wide text-[10px]"
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
                "border-t border-gray-100",
                ri % 2 === 1 ? "bg-gray-50/50" : "bg-white",
              )}
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="px-3 py-2 text-gray-700 font-mono leading-relaxed"
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
        h1: "text-base font-semibold text-gray-900 mt-3 mb-1",
        h2: "text-sm font-semibold text-gray-800 mt-2.5 mb-1",
        h3: "text-xs font-semibold text-gray-700 mt-2 mb-0.5 uppercase tracking-wide",
        h4: "text-xs font-medium text-gray-600 mt-1.5 mb-0.5",
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
          className="flex gap-2 text-sm text-gray-700 leading-relaxed"
          style={{ paddingLeft: `${token.depth * 12}px` }}
        >
          <span className="text-gray-400 mt-0.5 select-none">•</span>
          <span>{renderInline(token.text)}</span>
        </div>,
      );
    } else if (token.kind === "ol_item") {
      nodes.push(
        <div
          key={key++}
          className="flex gap-2 text-sm text-gray-700 leading-relaxed"
        >
          <span className="text-gray-400 tabular-nums w-4 text-right shrink-0">
            {token.index}.
          </span>
          <span>{renderInline(token.text)}</span>
        </div>,
      );
    } else if (token.kind === "hr") {
      nodes.push(<hr key={key++} className="border-t border-gray-200 my-2" />);
    } else if (token.kind === "paragraph") {
      nodes.push(
        <p key={key++} className="text-sm text-gray-700 leading-relaxed">
          {renderInline(token.text)}
        </p>,
      );
    }
  }

  return <div className="space-y-0.5">{nodes}</div>;
}

// ─── Diagram ──────────────────────────────────────────────────────────────────

function DiagramDisplay({ part }: { part: DiagramPart }) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden text-sm w-full">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <GitBranch className="w-3.5 h-3.5 text-violet-500" />
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            {part.title || part.diagramType || "Diagram"}
          </span>
        </div>
        <CopyButton text={part.content} />
      </div>
      <pre className="px-3 py-3 text-xs font-mono text-gray-800 overflow-x-auto bg-white whitespace-pre">
        {part.content}
      </pre>
    </div>
  );
}

// ─── API Spec ─────────────────────────────────────────────────────────────────

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
    "text-gray-600 bg-gray-50 border-gray-200";

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
    <div className="border border-gray-200 rounded-lg overflow-hidden text-sm w-full">
      <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border-b border-gray-200">
        <span
          className={cn(
            "px-2 py-0.5 rounded text-xs font-mono font-semibold border",
            methodColor,
          )}
        >
          {part.method?.toUpperCase()}
        </span>
        <code className="text-gray-800 text-xs font-mono">{part.endpoint}</code>
      </div>

      {part.description && (
        <p className="px-3 py-2 text-gray-600 text-xs border-b border-gray-100">
          {part.description}
        </p>
      )}

      {part.auth && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
          <span className="text-xs text-gray-400 w-16">Auth</span>
          <code className="text-xs text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded">
            {part.auth}
          </code>
        </div>
      )}

      {parameters.length > 0 && (
        <div className="border-b border-gray-100">
          <p className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wide">
            Parameters
          </p>
          {parameters.map((p: any, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-3 py-1.5 border-t border-gray-50"
            >
              <code className="text-xs text-gray-700 w-32 truncate">
                {p.name}
              </code>
              <span className="text-xs text-gray-400 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded">
                {p.in}
              </span>
              {p.required && (
                <span className="text-xs text-red-400">required</span>
              )}
              {p.description && (
                <span className="text-xs text-gray-400 truncate">
                  {p.description}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {Object.keys(responses).length > 0 && (
        <div>
          <p className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100">
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
              "text-gray-600 bg-gray-50 border-gray-200";

            return (
              <div key={code} className="border-t border-gray-100">
                <button
                  onClick={() => hasDetail && setOpenCode(isOpen ? null : code)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
                >
                  <span
                    className={cn(
                      "text-xs font-mono font-semibold px-1.5 py-0.5 rounded border",
                      statusColor,
                    )}
                  >
                    {code}
                  </span>
                  <span className="text-xs text-gray-500 flex-1">
                    {String(r.description ?? "")}
                  </span>
                  {hasDetail && (
                    <span
                      className={cn(
                        "text-gray-400 text-xs transition-transform",
                        isOpen && "rotate-180",
                      )}
                    >
                      ▾
                    </span>
                  )}
                </button>

                {isOpen && hasDetail && (
                  <div className="px-3 pb-3 space-y-2 bg-gray-50/50">
                    {Object.keys(fields).length > 0 && (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400">
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
                            <tr key={name} className="border-t border-gray-100">
                              <td className="py-1 pr-3 font-mono text-gray-700">
                                {name}
                              </td>
                              <td className="py-1 pr-3 text-sky-600">
                                {String(s.type ?? "")}
                              </td>
                              <td className="py-1 text-gray-400">
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
                            <p className="text-xs text-gray-400 mb-1 font-mono">
                              {refName}
                            </p>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-400">
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
                                    className="border-t border-gray-100"
                                  >
                                    <td className="py-1 pr-3 font-mono text-gray-700">
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
                                    <td className="py-1 text-gray-400">
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
        <details className="border-t border-gray-100">
          <summary className="px-3 py-2 text-xs text-gray-400 cursor-pointer hover:text-gray-600 hover:bg-gray-50">
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
                  <p className="text-xs font-mono text-gray-500 mb-1">{name}</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400">
                        <th className="text-left py-1 font-medium">field</th>
                        <th className="text-left py-1 font-medium">type</th>
                        <th className="text-left py-1 font-medium">
                          description
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(props).map(([fn, fs]) => (
                        <tr key={fn} className="border-t border-gray-100">
                          <td className="py-1 pr-3 font-mono text-gray-700">
                            {fn}
                            {req.includes(fn) && (
                              <span className="text-red-400 ml-1">*</span>
                            )}
                          </td>
                          <td className="py-1 pr-3 text-sky-600">
                            {String(fs.type ?? "")}
                          </td>
                          <td className="py-1 text-gray-400">
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
        <div className="border-t border-gray-100 px-3 py-2.5 space-y-1">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">
            Notes
          </p>
          {part.notes!.map((note, i) => (
            <p key={i} className="text-xs text-gray-500 flex gap-2">
              <span className="text-gray-300 select-none">—</span>
              {note}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SQL ──────────────────────────────────────────────────────────────────────

function SqlDisplay({ part }: { part: SqlPart }) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden text-sm">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          SQL
        </span>
        <CopyButton text={part.query ?? part.text} />
      </div>
      <pre className="px-3 py-3 text-xs font-mono text-gray-800 overflow-x-auto bg-white">
        {part.query ?? part.text}
      </pre>
      {part.reasoning && (
        <p className="px-3 py-2 text-xs text-gray-500 border-t border-gray-100 bg-gray-50">
          {part.reasoning}
        </p>
      )}
    </div>
  );
}

// ─── Message Part ─────────────────────────────────────────────────────────────

function MessagePart({ part }: { part: UIPart }) {
  if (part.type === "diagram")
    return <DiagramDisplay part={part as DiagramPart} />;
  if (part.type === "api_spec")
    return <ApiSpecDisplay part={part as ApiSpecPart} />;
  if (part.type === "sql") return <SqlDisplay part={part as SqlPart} />;

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
      <div className="flex items-center gap-2 bg-white/10 rounded-lg px-2.5 py-1.5 text-xs">
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

// ─── Chat Message ─────────────────────────────────────────────────────────────

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
            ? "bg-gray-100 border-gray-200"
            : "bg-violet-50 border-violet-500",
        )}
      >
        {isUser ? (
          <User className="w-3.5 h-3.5 text-gray-800" />
        ) : (
          <Bot className="w-3.5 h-3.5 text-violet-500" />
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
              ? "bg-[#dfdad5]/50 text-gray-800 rounded-tr-sm"
              : "bg-white border border-gray-200 text-gray-800 rounded-tl-sm",
          )}
        >
          <div className="space-y-2">
            {message.parts?.map((part, i) => (
              <MessagePart key={i} part={part as UIPart} />
            ))}
            {isStreaming && (
              <span className="inline-block w-0.5 h-4 bg-[#dfdad5]/50 ml-0.5 align-middle animate-pulse rounded" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex gap-3 px-4 py-4">
      <div className="w-7 h-7 rounded-full bg-violet-50 border border-violet-300 flex items-center justify-center">
        <Bot className="w-3.5 h-3.5 text-violet-500" />
      </div>
      <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5 h-10">
        {[0, 150, 300].map((d) => (
          <span
            key={d}
            className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce"
            style={{ animationDelay: `${d}ms`, animationDuration: "1.1s" }}
          />
        ))}
      </div>
    </div>
  );
}
