import { spawn } from "node:child_process";
import { HttpError } from "../httpError";

const PICK_TIMEOUT_MS = 5 * 60 * 1000;

type ScriptResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function runOsascript(source: string): Promise<ScriptResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("osascript", ["-"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new HttpError(504, "Finder did not return a folder in time."),
      );
    }, PICK_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.write(source);
    child.stdin.end();
  });
}

function cancelled(stderr: string, code: number): boolean {
  if (code === 0) return false;
  return /user canceled/i.test(stderr) || /user cancelled/i.test(stderr);
}

let inFlight: Promise<string | null> | null = null;

async function pickOnce(): Promise<string | null> {
  if (process.platform !== "darwin") {
    throw new HttpError(
      501,
      "Finder folder picker is only available when the backend runs on macOS. Paste an absolute path instead.",
    );
  }

  const script = [
    'tell application "SystemUIServer"',
    "activate",
    'set chosen to choose folder with prompt "Select a project folder"',
    "POSIX path of chosen",
    "end tell",
  ].join("\n");
  const result = await runOsascript(script);
  if (cancelled(result.stderr, result.code)) return null;
  if (result.code !== 0) {
    throw new HttpError(
      500,
      "Could not open Finder. Paste an absolute path instead.",
    );
  }

  const picked = result.stdout.trim().replace(/\/+$/, "");
  return picked || null;
}

/**
 * Opens the macOS "choose folder" panel (Finder) on the machine running this
 * process and returns a POSIX path. `null` means the human cancelled.
 * Concurrent callers share one panel so React Strict Mode cannot stack them.
 */
export function pickFolderInFinder(): Promise<string | null> {
  if (inFlight) return inFlight;
  inFlight = pickOnce().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
