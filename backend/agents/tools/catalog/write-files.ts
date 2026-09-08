import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { saveArtifact, safeFileName } from "../../../internal/artifactStore/service";
import { orToolError } from "../errors";
import { defineTool, type ToolContext } from "./types";

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/write_files.py",
);

const fileSchema = z.object({
  name: z.string().min(1).describe("Filename including extension, e.g. export.sql"),
  content: z.string().describe("Full file contents"),
  mimeType: z
    .string()
    .optional()
    .describe("Optional MIME type; inferred from the extension when omitted"),
});

type WrittenManifest = {
  ok: boolean;
  files: Array<{ name: string; path: string; size: number; mimeType: string }>;
};

function runWriter(dir: string, payload: unknown): Promise<WrittenManifest> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [SCRIPT, dir], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `write_files.py exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as WrittenManifest);
      } catch {
        reject(new Error(stderr.trim() || "write_files.py returned invalid JSON"));
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

async function writeFilesCore(
  files: z.infer<typeof fileSchema>[],
  ctx: ToolContext,
): Promise<string> {
  if (!ctx.userId) {
    return "write_files failed: sign in to save files for download.";
  }
  if (!ctx.threadId) {
    return "write_files failed: missing chat thread.";
  }
  if (files.length === 0) {
    return "write_files failed: no files provided.";
  }

  const dir = await mkdtemp(path.join(tmpdir(), "write-files-"));
  try {
    const manifest = await runWriter(dir, {
      files: files.map((file) => ({
        name: safeFileName(file.name),
        content: file.content,
        mimeType: file.mimeType ?? "",
      })),
    });

    const saved = [];
    for (const written of manifest.files) {
      const buffer = await readFile(written.path);
      const record = await saveArtifact(ctx.userId, {
        threadId: ctx.threadId,
        name: written.name,
        mimeType: written.mimeType || undefined,
        buffer,
        source: "write_files",
      });
      saved.push({
        id: record.id,
        name: record.name,
        version: record.currentVersion,
        mentionToken: record.mentionToken,
      });
    }

    return JSON.stringify({ saved });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const writeFilesTools = [
  defineTool({
    name: "write_files",
    description:
      "Save generated files so the human can download them from the Artifacts library. " +
      "Use when they ask to generate or download a file (SQL script, CSV, markdown export, etc.). " +
      "Do not use this instead of write_file for phase artifacts at /artifacts/*.md — still write those " +
      "with write_file so the next phase can read them. Returns mention tokens such as @Artifacts/export.sql.",
    schema: z.object({
      files: z
        .array(fileSchema)
        .min(1)
        .describe("Files to write and persist for download"),
    }),
    surfaces: ["langchain"],
    invoke: ({ files }, ctx) =>
      orToolError("write_files", () => writeFilesCore(files, ctx)),
  }),
] as const;
