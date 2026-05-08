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

  // Resolve inline schema fields from a response entry
  const getFields = (
    r: Record<string, unknown>,
  ): Record<string, Record<string, unknown>> => {
    // flat schema
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
    // content: application/json schema
    const jsonSchema = (r.content as any)?.["application/json"]?.schema as
      | Record<string, unknown>
      | undefined;
    if (jsonSchema?.$ref) return {}; // resolved via componentSchemas below
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
      {/* Endpoint */}
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

      {/* Description */}
      {part.description && (
        <p className="px-3 py-2 text-gray-600 text-xs border-b border-gray-100">
          {part.description}
        </p>
      )}

      {/* Auth */}
      {part.auth && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
          <span className="text-xs text-gray-400 w-16">Auth</span>
          <code className="text-xs text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded">
            {part.auth}
          </code>
        </div>
      )}

      {/* Parameters */}
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

      {/* Responses */}
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
                    {/* Inline fields */}
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

                    {/* $ref resolved schema */}
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

                    {/* Example */}
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

      {/* Component Schemas */}
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

// ─── Message ──────────────────────────────────────────────────────────────────

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
