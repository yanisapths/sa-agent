/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { Bot, User, FileText, GitBranch, Download } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { type ChatUsage } from "@/features/gateway/types";
import {
  artifactService,
  triggerBlobDownload,
} from "@/features/artifacts/service";
import { type ChatArtifact } from "@/features/artifacts/types";
import { CopyButton, MarkdownContent } from "./markdown-content";
import { UsageBadge } from "./usage-badge";
import { MessageFeedback } from "./message-feedback";
import { PlanPanel, ThoughtPanel } from "./thought-panel";
import {
  type ChatFeedback,
  type InterruptPayload,
  type SandboxRun,
  type ThoughtStep,
  type UserScore,
} from "@/lib/chat-stream";


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
  /** Live tool / specialist steps for this turn. */
  steps?: ThoughtStep[];
  /** Client timestamp when the first step arrived, for “Thought for Ns”. */
  startedAt?: number;
  /** Client timestamp when the turn left streaming/waiting, for “Thought for Ns”. */
  endedAt?: number;
  /** Pending HITL tool batch, if the graph is paused. */
  interrupt?: InterruptPayload;
  /** LangSmith presigned URLs and any submitted score for this turn. */
  feedback?: ChatFeedback;
  /** Sandbox execution results from this turn. */
  sandboxRuns?: SandboxRun[];
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

export interface SandboxRunPart extends UIMessagePart {
  type: "sandbox-run";
  runId: string;
  command: string;
  status: "queued" | "running" | "completed" | "error";
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
  duration?: number;
  startedAt?: number;
}

export type UIPart =
  | UIMessagePart
  | ApiSpecPart
  | SqlPart
  | ImagePart
  | FilePart
  | DiagramPart
  | CodePart
  | SandboxRunPart;


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


function SandboxRunDisplay({ part }: { part: SandboxRunPart }) {
  const [isOpen, setIsOpen] = useState(false);
  const statusColor =
    part.status === "completed" && part.exitCode === 0
      ? "text-emerald-600 bg-emerald-50"
      : part.status === "error" || (part.exitCode && part.exitCode !== 0)
        ? "text-red-600 bg-red-50"
        : part.status === "running" || part.status === "queued"
          ? "text-blue-600 bg-blue-50"
          : "text-muted";

  const hasOutput = Boolean(part.stdout || part.stderr || part.error);

  return (
    <div className="bg-surface/5 rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-surface/10 transition-colors text-left"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-xs font-mono text-muted">$</span>
          <code className="text-xs font-mono truncate">{part.command}</code>
          <span
            className={cn(
              "text-xs font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap",
              statusColor,
            )}
          >
            {part.status === "completed" && part.exitCode === 0
              ? "Exit 0"
              : part.status === "completed"
                ? `Exit ${part.exitCode}`
                : part.status === "error"
                  ? "Error"
                  : part.status.charAt(0).toUpperCase() + part.status.slice(1)}
          </span>
          {part.duration && (
            <span className="text-xs text-muted ml-auto whitespace-nowrap">
              {part.duration}ms
            </span>
          )}
        </div>
        {hasOutput && (
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

      {isOpen && hasOutput && (
        <div className="border-t border-border px-3 py-2 bg-surface/5 space-y-2">
          {part.stdout && (
            <div>
              <p className="text-xs text-muted mb-1 font-mono">stdout</p>
              <pre className="text-xs bg-surface/10 rounded p-2 overflow-x-auto max-h-[200px] overflow-y-auto">
                {part.stdout}
              </pre>
            </div>
          )}
          {part.stderr && (
            <div>
              <p className="text-xs text-muted mb-1 font-mono">stderr</p>
              <pre className="text-xs bg-surface/10 rounded p-2 overflow-x-auto max-h-[200px] overflow-y-auto text-red-600">
                {part.stderr}
              </pre>
            </div>
          )}
          {part.error && (
            <div>
              <p className="text-xs text-muted mb-1 font-mono">error</p>
              <pre className="text-xs bg-surface/10 rounded p-2 overflow-x-auto max-h-[200px] overflow-y-auto text-red-600">
                {part.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessagePart({ part }: { part: UIPart }) {
  if (part.type === "diagram")
    return <DiagramDisplay part={part as DiagramPart} />;
  if (part.type === "api_spec")
    return <ApiSpecDisplay part={part as ApiSpecPart} />;
  if (part.type === "sql") return <SqlDisplay part={part as SqlPart} />;
  if (part.type === "code") return <CodeDisplay part={part as CodePart} />;
  if (part.type === "sandbox-run")
    return <SandboxRunDisplay part={part as SandboxRunPart} />;

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
  waiting = false,
  onFeedback,
}: {
  message: UIMessage;
  isStreaming?: boolean;
  waiting?: boolean;
  onFeedback?: (score: UserScore, comment?: string) => Promise<void>;
}) {
  const isUser = message.role === "user";
  const hasParts = (message.parts?.length ?? 0) > 0;
  const hasArtifacts =
    !isStreaming && !waiting && (message.artifacts?.length ?? 0) > 0;
  const showBubble = isUser || hasParts || isStreaming || hasArtifacts;
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
          "flex flex-col gap-2 max-w-[85%]",
          isUser ? "items-end" : "items-start",
        )}
      >
        {!isUser && (message.steps?.length ?? 0) > 0 && (
          <ThoughtPanel
            steps={message.steps ?? []}
            open={isStreaming || waiting}
            waiting={waiting}
            startedAt={message.startedAt}
            endedAt={message.endedAt}
          />
        )}
        {showBubble && (
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
              {hasArtifacts && (
                <ArtifactChips artifacts={message.artifacts ?? []} />
              )}
            </div>
          </div>
        )}
        {!isUser &&
          !waiting &&
          (message.interrupt?.actionRequests.length ?? 0) > 0 && (
            <PlanPanel interrupt={message.interrupt} waiting={false} />
          )}
        {!isUser &&
          !isStreaming &&
          !waiting &&
          (message.usage ||
            (message.feedback?.urls.user_score && onFeedback)) && (
          <div className="mt-0.5 flex flex-wrap items-start gap-x-3 gap-y-1">
            {message.usage && <UsageBadge usage={message.usage} />}
            {message.feedback?.urls.user_score && onFeedback && (
              <MessageFeedback
                feedback={message.feedback}
                onSubmit={onFeedback}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
