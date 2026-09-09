import path from "node:path";
import { HumanMessage, type ContentBlock } from "@langchain/core/messages";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { PHASE_OWNERS } from "../agents";
import { config } from "../config";
import { isChatModelId } from "../internal/gateway/models";
import {
  createUsageCollector,
  type UsageCollector,
} from "../internal/gateway/usage";
import { HttpError } from "../internal/httpError";
import { isCsvFile, parkPvtCases } from "../internal/pvtCases";
import {
  artifactMentionTokens,
  resolveMentions as resolveArtifactMentions,
} from "../internal/artifactStore/service";
import {
  extractMentionTokens,
  resolveMentions as resolveVaultMentions,
} from "../internal/vault/service";
import type { ResolvedMention as VaultResolvedMention } from "../internal/vault/types";
import { parkVaultMentions } from "../internal/vault/mount";
import {
  getWorkspace,
  liveWorkspaceRoot,
  resolveMentions as resolveWorkspaceMentions,
  workspaceMentionTokens,
} from "../internal/workspace/service";
import { optionalAuth } from "../middleware/requireAuth";
import {
  finishTurn,
  invokeAgentTurn,
  parseDecisions,
  resumeCommand,
  startExecutionTimer,
  streamAgentTurn,
} from "../internal/chat/execute";
import { openSse, wantsEventStream, writeSse } from "../internal/chat/events";
import { isAbortError } from "../internal/chat/stream";
import {
  dropChatRun,
  getChatRun,
  putChatRun,
  type ChatRunContext,
} from "../internal/chat/run-context";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/** One shape for both an upload and a file pulled out of the vault. */
interface ChatFile {
  name: string;
  mimetype: string;
  buffer: Buffer;
  vaultFileId?: string;
}

/**
 * Extensions we can put in a prompt as text. `.pdf`, `.docx`, and `.xlsx` are
 * uploadable to the vault but are containers — decoding them as UTF-8 yields
 * mojibake the model would read as data, so they are named and skipped instead.
 */
const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".csv",
  ".json",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".sql",
  ".yaml",
  ".yml",
  ".py",
  ".go",
  ".java",
  ".kt",
  ".rb",
  ".php",
  ".rs",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cs",
  ".sh",
  ".html",
  ".css",
  ".xml",
  ".toml",
  ".ini",
  ".graphql",
  ".proto",
  ".vue",
  ".svelte",
]);

function toFileBlock(file: ChatFile): ContentBlock {
  if (file.mimetype.startsWith("image/")) {
    return {
      type: "image_url",
      image_url: {
        url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
      },
    } as ContentBlock;
  }

  const ext = path.extname(file.name).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) {
    return {
      type: "text",
      text: `[Attached file: ${file.name} — ${file.mimetype} cannot be read as text. Ask for a CSV, Markdown, or plain-text export.]`,
    } as ContentBlock;
  }

  return {
    type: "text",
    text: `[Attached file: ${file.name}]\n\`\`\`${ext.slice(1)}\n${file.buffer.toString("utf-8")}\n\`\`\``,
  } as ContentBlock;
}

function toContentBlocks(
  message: string,
  files: ChatFile[],
  notes: string[] = [],
): ContentBlock[] {
  const blocks: ContentBlock[] = files.map(toFileBlock);

  for (const note of notes) {
    blocks.push({ type: "text", text: note } as ContentBlock);
  }

  if (message) blocks.push({ type: "text", text: message });
  return blocks;
}

/**
 * `@folder/file.csv` in the message is inert text on its own. Resolve it to
 * bytes so the file reaches the agent the same way an upload does. Needs an
 * identity: without one the tokens stay literal and the agent is told why,
 * rather than guessing at a file it cannot read.
 */
function requestedMentions(body: Record<string, unknown>): string[] {
  const raw = body.mentions;
  if (typeof raw === "string") {
    return raw.trim() ? [raw.trim()] : [];
  }
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string");
  }
  return [];
}

async function chatMentions(
  message: string,
  explicit: readonly string[],
  userId: string | undefined,
  threadId: string,
): Promise<{
  files: ChatFile[];
  notes: string[];
  vaultFiles: VaultResolvedMention[];
}> {
  // An explicit `mentions[]` is authoritative — the client knows which
  // suggestion the human picked. Scanning the text is the fallback for
  // clients that only send the message.
  const tokens = [
    ...new Set([...explicit, ...extractMentionTokens(message)]),
  ];
  if (tokens.length === 0) {
    return { files: [], notes: [], vaultFiles: [] };
  }

  if (!userId) {
    return {
      files: [],
      vaultFiles: [],
      notes: [
        `[Mentions ${tokens.join(", ")} could not be read: this chat request is not signed in. Tell the human to attach the file directly instead.]`,
      ],
    };
  }

  const { artifact, other: notArtifact } = artifactMentionTokens(tokens);
  const { workspace, other } = workspaceMentionTokens(notArtifact);
  const vault = await resolveVaultMentions(userId, other);
  const stored = await resolveArtifactMentions(userId, artifact, threadId);
  const projects = await resolveWorkspaceMentions(userId, workspace);

  return {
    files: [
      ...vault.files.map((file) => ({
        name: file.name,
        mimetype: file.mimeType,
        buffer: file.buffer,
        vaultFileId: file.id,
      })),
      ...[...stored.files, ...projects.files].map((file) => ({
        name: file.name,
        mimetype: file.mimeType,
        buffer: file.buffer,
      })),
    ],
    vaultFiles: vault.files,
    notes: [
      ...vault.unresolved.map(
        (item) =>
          `[Vault mention ${item.token} could not be read: ${item.reason}.]`,
      ),
      ...stored.unresolved.map(
        (item) =>
          `[Artifact mention ${item.token} could not be read: ${item.reason}.]`,
      ),
      ...projects.unresolved.map(
        (item) =>
          `[Project mention ${item.token} could not be read: ${item.reason}.]`,
      ),
    ],
  };
}

/**
 * The model the human picked in the GUI, checked against the gateway's own
 * catalogue. Validating here rather than letting it through means an unknown or
 * embedding-only id fails as a 400 up front, instead of as a 404 from the
 * gateway several supersteps into an agent run the caller has already paid for.
 */
async function requestedModel(
  body: Record<string, unknown>,
): Promise<string | undefined> {
  const raw = body.model;
  if (typeof raw !== "string" || !raw.trim()) return undefined;

  const model = raw.trim();
  if (!(await isChatModelId(model))) {
    throw new HttpError(
      400,
      `Unknown model "${model}". Ask GET /v1/gateway/models what this key can reach.`,
    );
  }
  return model;
}

/**
 * A phase pins the specialist for this turn. Without one the router decides,
 * which is right for an open-ended question and wrong when the human has
 * already said "plan this" — it may re-run discuss instead.
 */
function requestedPhase(body: Record<string, unknown>): string | undefined {
  const raw = body.phase;
  if (typeof raw !== "string" || !raw.trim()) return undefined;

  const phase = raw.trim();
  if (!PHASE_OWNERS.has(phase)) {
    throw new HttpError(
      400,
      `Unknown phase "${phase}". Expected one of: ${[...PHASE_OWNERS].join(", ")}.`,
    );
  }
  return phase;
}

/**
 * Phrased to reinforce the router contract in `agents/prompt.ts` — "task()
 * exactly one specialist" — rather than argue with it, so the only thing left
 * for the router to decide is already decided.
 *
 * The last sentence is doing real work. The router is also told that questions
 * needing no specialist should be answered directly and stopped, and left to
 * itself it sometimes reads a request like this as one of those. An explicit
 * phase has to win over that rule, or the selection silently does nothing.
 */
function phaseDirective(phase: string): string {
  return `[Phase: ${phase}] The human explicitly selected this phase, so the routing decision is already made. task() the \`${phase}\` specialist for this turn and return its artifact. Do not choose a different specialist, and do not answer directly even if you believe you could — an explicit phase overrides the rule about questions that need no specialist.`;
}

function requestedWorkspaceId(body: Record<string, unknown>): string | undefined {
  const raw = body.workspaceId;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  return raw.trim();
}

function workspaceDirective(name: string, root: string): string {
  return (
    `[Workspace: ${name} at ${root}] The product repo is mounted as the agent's filesystem. ` +
    `ls, read_file, glob, and grep from / see this folder (e.g. ls /internal/handler/voting or glob with pattern **/*.go). ` +
    `Do not pass ${root}/… — use /path/from/repo/root. ` +
    `If a name is wrong, ls the parent; spelling and case may differ (e.g. Redme.md). ` +
    `/artifacts/*.md is still virtual phase scratch (write_file). ` +
    `Mentioned vault files are at /vault/folder/file and can be edited with edit_file / write_file. ` +
    `/resources is skills. workspace_ls / workspace_read / workspace_grep also work with relative paths.`
  );
}

async function attachedWorkspace(
  userId: string | undefined,
  workspaceId: string | undefined,
): Promise<{ id: string; name: string; path: string } | undefined> {
  if (!workspaceId) return undefined;
  if (!userId) {
    throw new HttpError(
      400,
      "Sign in to work in a local folder. The chat request needs a vault token.",
    );
  }
  try {
    const ws = await getWorkspace(userId, workspaceId);
    return { id: ws.id, name: ws.name, path: liveWorkspaceRoot(ws.path) };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw new HttpError(400, "Unknown project folder.");
    }
    throw err;
  }
}

/** The `usage` block on a response, successful or not. */
async function usagePayload(
  collector: UsageCollector,
  model: string | undefined,
  phase: string | undefined,
  durationMs: number,
): Promise<Record<string, unknown>> {
  return {
    model: model ?? config.model.orchestrator,
    phase: phase ?? null,
    durationMs,
    ...(await collector.totals()),
  };
}

function abortError(clientGone: boolean): HttpError {
  return new HttpError(
    504,
    clientGone
      ? "Chat cancelled."
      : `Agent timed out after ${config.agent.invokeTimeoutMs}ms.`,
  );
}

async function runStreamSegment(opts: {
  req: Request;
  res: Response;
  input: unknown;
  run: ChatRunContext;
  streaming: boolean;
}): Promise<void> {
  const abort = new AbortController();
  const timer = startExecutionTimer(abort);
  const segmentStarted = Date.now();
  let clientGone = false;
  const onClose = () => {
    if (opts.res.writableEnded) return;
    clientGone = true;
    abort.abort();
  };
  opts.req.on("close", onClose);

  const emit = (event: Parameters<typeof writeSse>[1]) => {
    if (opts.streaming) writeSse(opts.res, event);
  };

  try {
    const result = await streamAgentTurn({
      input: opts.input,
      run: opts.run,
      signal: abort.signal,
      emit,
    });
    opts.run.executionMs += Date.now() - segmentStarted;
    if (result.interrupted) {
      putChatRun(opts.run);
      const usage = await usagePayload(
        opts.run.collector,
        opts.run.model,
        opts.run.phase,
        opts.run.executionMs,
      );
      emit({ event: "usage", data: usage });
      emit({ event: "done", data: { status: "waiting" } });
      return;
    }
    dropChatRun(opts.run.threadId);
    await finishTurn({ run: opts.run, values: result.values, emit });
    const usage = await usagePayload(
      opts.run.collector,
      opts.run.model,
      opts.run.phase,
      opts.run.executionMs,
    );
    emit({ event: "usage", data: usage });
    emit({ event: "done", data: { status: "complete" } });
  } catch (err) {
    opts.run.executionMs += Date.now() - segmentStarted;
    if (abort.signal.aborted || isAbortError(err)) throw abortError(clientGone);
    throw err;
  } finally {
    clearTimeout(timer);
    opts.req.off("close", onClose);
  }
}

async function chatHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  /**
   * Hoisted out of the try so a failure can still report what it spent. The
   * turns worth costing are exactly the ones that time out or hit the step cap.
   */
  const startedAt = Date.now();
  let collector: UsageCollector | undefined;
  let model: string | undefined;
  let phase: string | undefined;
  let executionMs = 0;
  const streaming = wantsEventStream(req.headers.accept);

  try {
    const message: string = req.body.message ?? "";
    const uploads: ChatFile[] = ((req.files ?? []) as Express.Multer.File[]).map(
      (file) => ({
        name: file.originalname,
        mimetype: file.mimetype,
        buffer: file.buffer,
      }),
    );

    const body = (req.body ?? {}) as Record<string, unknown>;
    model = await requestedModel(body);
    phase = requestedPhase(body);
    const workspace = await attachedWorkspace(
      req.userId,
      requestedWorkspaceId(body),
    );

    // A stable threadId keeps the agent's short-term session memory across turns.
    const threadId: string = req.body.threadId || randomUUID();

    const mentioned = await chatMentions(
      message,
      requestedMentions(body),
      req.userId,
      threadId,
    );
    const vaultParked = req.userId
      ? parkVaultMentions(req.userId, mentioned.vaultFiles)
      : parkVaultMentions("", []);
    const incoming = [...uploads, ...mentioned.files];
    const csvs = incoming.filter(isCsvFile);
    const otherFiles = incoming.filter(
      (file) =>
        !isCsvFile(file) &&
        !(file.vaultFileId && vaultParked.fileIds.has(file.vaultFileId)),
    );
    const parked = await parkPvtCases(csvs);
    const seededFiles = { ...parked.files, ...vaultParked.files };
    const content = toContentBlocks(message, otherFiles, [
      ...mentioned.notes,
      ...vaultParked.notes,
      ...parked.notes,
      ...(workspace
        ? [workspaceDirective(workspace.name, workspace.path)]
        : []),
      ...(phase ? [phaseDirective(phase)] : []),
    ]);

    if (content.length === 0) {
      throw new HttpError(400, "Message or file required.");
    }

    collector = createUsageCollector(model ?? config.model.orchestrator);
    const input = {
      messages: [new HumanMessage({ content })],
      ...(Object.keys(seededFiles).length > 0 ? { files: seededFiles } : {}),
    };
    const run: ChatRunContext = {
      threadId,
      userId: req.userId,
      model,
      phase,
      workspaceRoot: workspace?.path,
      workspaceId: workspace?.id,
      vaultMount: vaultParked.mount,
      startedAt,
      executionMs: 0,
      collector,
      expiresAt: Date.now() + 30 * 60 * 1000,
    };

    if (!streaming) {
      const abort = new AbortController();
      const timer = startExecutionTimer(abort);
      let clientGone = false;
      const onClose = () => {
        if (res.writableEnded) return;
        clientGone = true;
        abort.abort();
      };
      req.on("close", onClose);
      try {
        const result = await invokeAgentTurn({
          input,
          run,
          signal: abort.signal,
        });
        executionMs = Date.now() - startedAt;
        res.json({
          ok: true,
          threadId,
          type: result.type,
          data: result.data,
          artifacts: result.artifacts,
          usage: await usagePayload(collector, model, phase, executionMs),
        });
      } catch (err) {
        if (abort.signal.aborted || isAbortError(err)) throw abortError(clientGone);
        throw err;
      } finally {
        clearTimeout(timer);
        req.off("close", onClose);
      }
      return;
    }

    openSse(res);
    writeSse(res, { event: "thread", data: { threadId } });
    await runStreamSegment({ req, res, input, run, streaming: true });
    if (!res.writableEnded) res.end();
  } catch (err) {
    /**
     * A timeout or a step-cap stop has already been paid for, so it carries its
     * usage rather than going to the generic error handler empty. A cancelled
     * request has nowhere to send it — the socket is gone.
     */
    if (err instanceof HttpError && collector) {
      const usage = await usagePayload(
        collector,
        model,
        phase,
        executionMs || Date.now() - startedAt,
      );
      if (streaming && res.headersSent && !res.writableEnded) {
        writeSse(res, { event: "error", data: { error: err.message } });
        writeSse(res, { event: "usage", data: usage });
        res.end();
        return;
      }
      if (!res.writableEnded) {
        res.status(err.status).json({
          ok: false,
          error: err.message,
          usage,
        });
        return;
      }
      return;
    }
    if (streaming && res.headersSent && !res.writableEnded) {
      const message = err instanceof Error ? err.message : "Agent failed.";
      writeSse(res, { event: "error", data: { error: message } });
      res.end();
      return;
    }
    next(err);
  }
}

async function resumeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const streaming = wantsEventStream(req.headers.accept);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
  let run: ChatRunContext | undefined;

  try {
    if (!threadId) throw new HttpError(400, "threadId is required.");
    run = getChatRun(threadId);
    if (!run) {
      throw new HttpError(
        409,
        "No paused turn for this thread. Send a new message.",
      );
    }
    const decisions = parseDecisions(body.decisions);
    if (streaming) {
      openSse(res);
      writeSse(res, { event: "thread", data: { threadId } });
    }
    const abort = new AbortController();
    const timer = startExecutionTimer(abort);
    const segmentStarted = Date.now();
    let clientGone = false;
    const onClose = () => {
      if (res.writableEnded) return;
      clientGone = true;
      abort.abort();
    };
    req.on("close", onClose);
    try {
      if (streaming) {
        const result = await streamAgentTurn({
          input: resumeCommand(decisions),
          run,
          signal: abort.signal,
          emit: (event) => writeSse(res, event),
        });
        run.executionMs += Date.now() - segmentStarted;
        if (result.interrupted) {
          putChatRun(run);
          const usage = await usagePayload(
            run.collector,
            run.model,
            run.phase,
            run.executionMs,
          );
          writeSse(res, { event: "usage", data: usage });
          writeSse(res, { event: "done", data: { status: "waiting" } });
        } else {
          dropChatRun(threadId);
          await finishTurn({
            run,
            values: result.values,
            emit: (event) => writeSse(res, event),
          });
          const usage = await usagePayload(
            run.collector,
            run.model,
            run.phase,
            run.executionMs,
          );
          writeSse(res, { event: "usage", data: usage });
          writeSse(res, { event: "done", data: { status: "complete" } });
        }
        if (!res.writableEnded) res.end();
        return;
      }

      const finished = await invokeAgentTurn({
        input: resumeCommand(decisions),
        run,
        signal: abort.signal,
      });
      dropChatRun(threadId);
      res.json({
        ok: true,
        threadId,
        type: finished.type,
        data: finished.data,
        artifacts: finished.artifacts,
        usage: await usagePayload(
          run.collector,
          run.model,
          run.phase,
          run.executionMs + (Date.now() - segmentStarted),
        ),
      });
    } catch (err) {
      run.executionMs += Date.now() - segmentStarted;
      if (abort.signal.aborted || isAbortError(err)) throw abortError(clientGone);
      throw err;
    } finally {
      clearTimeout(timer);
      req.off("close", onClose);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent failed.";
    if (streaming && res.headersSent && !res.writableEnded) {
      writeSse(res, { event: "error", data: { error: message } });
      if (run) {
        writeSse(res, {
          event: "usage",
          data: await usagePayload(
            run.collector,
            run.model,
            run.phase,
            run.executionMs,
          ),
        });
      }
      res.end();
      return;
    }
    if (err instanceof HttpError && run && !res.writableEnded) {
      res.status(err.status).json({
        ok: false,
        error: err.message,
        usage: await usagePayload(
          run.collector,
          run.model,
          run.phase,
          run.executionMs,
        ),
      });
      return;
    }
    next(err);
  }
}

const chat = Router();
chat.post("/", optionalAuth, upload.array("files"), chatHandler);
chat.post("/resume", optionalAuth, resumeHandler);

export { chat };
