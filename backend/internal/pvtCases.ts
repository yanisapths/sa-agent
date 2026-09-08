import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { ARTIFACT } from "../agents/harness";

const EXTRACTOR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../scripts/testcase-extractor.py",
);

export interface ParkedFile {
  name: string;
  mimetype: string;
  buffer: Buffer;
}

/** LangGraph StateBackend FileData (content as lines). */
export interface FileData {
  content: string[];
  created_at: string;
  modified_at: string;
}

export interface ParkedPvtCases {
  files: Record<string, FileData>;
  notes: string[];
}

export function isCsvFile(file: { name: string; mimetype: string }): boolean {
  const ext = path.extname(file.name).toLowerCase();
  return ext === ".csv" || file.mimetype === "text/csv";
}

function toFileData(text: string): FileData {
  const now = new Date().toISOString();
  return {
    content: text.split("\n"),
    created_at: now,
    modified_at: now,
  };
}

/** Excel/Windows CSV is often cp1252, not UTF-8 (0x85 is an ellipsis). */
export function decodeCsvBuffer(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

function runExtractor(csvPath: string, jsonPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [EXTRACTOR, csvPath, "-o", jsonPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve(stderr.trim());
      else reject(new Error(stderr.trim() || `extractor exited ${code}`));
    });
  });
}

/**
 * Put the user's CSV on the agent's virtual FS and normalise it here.
 *
 * Do not inline a large sheet into the HumanMessage: deepagents evicts oversized
 * prompts to `/conversation_history/{id}`, and the specialist then tries to
 * `read_file` that path plus the original filename — which does not exist.
 */
export async function parkPvtCases(csvs: ParkedFile[]): Promise<ParkedPvtCases> {
  if (csvs.length === 0) return { files: {}, notes: [] };

  const primary = csvs[0];
  const csvText = decodeCsvBuffer(primary.buffer);
  const files: Record<string, FileData> = {
    [ARTIFACT.pvtCases]: toFileData(csvText),
  };

  const extras =
    csvs.length > 1
      ? ` Extra CSV not used: ${csvs
          .slice(1)
          .map((file) => file.name)
          .join(", ")}.`
      : "";

  const dir = await mkdtemp(path.join(tmpdir(), "pvt-cases-"));
  const csvPath = path.join(dir, "cases.csv");
  const jsonPath = path.join(dir, "cases.json");

  try {
    await writeFile(csvPath, primary.buffer);
    await runExtractor(csvPath, jsonPath);
    const jsonText = await readFile(jsonPath, "utf-8");
    files[ARTIFACT.pvtCasesJson] = toFileData(jsonText);
    let count = 0;
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      count = Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      count = 0;
    }
    return {
      files,
      notes: [
        `[PVT case list "${primary.name}" is at ${ARTIFACT.pvtCases}. Normalised inventory (${count} cases) is at ${ARTIFACT.pvtCasesJson}. Read those virtual paths with read_file. Do not look under /conversation_history — that is an eviction dump, not the sheet.]${extras}`,
      ],
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      files,
      notes: [
        `[PVT case list "${primary.name}" is at ${ARTIFACT.pvtCases}. Extractor could not run (${reason}). Parse the CSV at that path. Do not look under /conversation_history.]${extras}`,
      ],
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
