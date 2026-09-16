const root = process.env.EVAL_WORKSPACE;
if (!root) {
  console.error("EVAL_WORKSPACE is required");
  process.exit(1);
}

import path from "node:path";

const proc = Bun.spawn(["bun", "tests/probe-auth.ts"], {
  cwd: path.join(import.meta.dir, ".."),
  env: { ...process.env, EVAL_WORKSPACE: root },
  stdout: "pipe",
  stderr: "pipe",
});

const exit = await proc.exited;
const stdout = await new Response(proc.stdout).text();
const stderr = await new Response(proc.stderr).text();

let parsed: {
  empty?: unknown;
  null?: unknown;
  missing?: unknown;
  wrong?: unknown;
  correct?: unknown;
};
try {
  parsed = JSON.parse(stdout.trim());
} catch {
  console.error("probe did not return JSON");
  if (stdout.trim()) console.error(stdout);
  if (stderr.trim()) console.error(stderr);
  process.exit(1);
}

if (exit !== 0) {
  console.error("probe exited", exit);
  process.exit(1);
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

assert(parsed.empty === false, "empty password must be rejected");
assert(parsed.null === false, "null password must be rejected");
assert(parsed.missing === false, "missing password must be rejected");
assert(parsed.wrong === false, "wrong password must be rejected");
assert(parsed.correct === true, "correct password must be accepted");

console.log("ok");
