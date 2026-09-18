# Sandbox Execution Environment + next-devtools-mcp Review

**Date:** 2026-09-18  
**Reviewed by:** Code Review Agent  
**Status:** CRITICAL ISSUES FOUND — Not ship-ready

---

## Summary

The implementation provides a functional sandbox execution environment with per-thread lifecycle management and SSE streaming integration. However, **critical resource management bugs** prevent safe deployment:

1. **Sandboxes are not reaped on error or interruption**, causing resource leaks.
2. **Async cleanup in manager is fire-and-forget**, risking orphaned processes if the backend exits.
3. **Frontend integration is incomplete** — no verified logic to merge sandbox-run SSE events into message state.

**Severity breakdown:** 4 CRITICAL, 3 HIGH, 3 MEDIUM, 1 STYLE

The implementation matches the approved plan in structure and design, but lifecycle guarantees are broken.

---

## Findings by Severity

### CRITICAL

#### 1. Sandbox not reaped when execution is interrupted
**Location:** `backend/routes/chat.ts:446-449`

**Issue:**  
When the agent is interrupted (waiting for approval), the code returns early without calling `reap()`:
```typescript
if (result.interrupted) {
  putChatRun(opts.run);  // ... emit events ...
  return;  // ← BUG: doesn't call getChatSandboxManager().reap(opts.run.threadId)
}
dropChatRun(opts.run.threadId);
await getChatSandboxManager().reap(opts.run.threadId);
```

**Impact:** Sandboxes allocated for interrupted sessions persist until the 30-minute idle timeout fires, wasting resources.

**Recommendation:**  
Move the reap call to a finally block in `runStreamSegment`, or call it unconditionally before checking `result.interrupted`. Pattern:
```typescript
try {
  // ... agent execution ...
} finally {
  // Always clean up sandbox for this thread
  await getChatSandboxManager().reap(opts.run.threadId);
}
```

**Severity:** CRITICAL

---

#### 2. Error execution doesn't clean up sandbox
**Location:** `backend/routes/chat.ts:460-465`

**Issue:**  
If `streamAgentTurn()` throws an error, the sandbox is never reaped:
```typescript
} catch (err) {
  opts.run.executionMs += Date.now() - segmentStarted;
  if (abort.signal.aborted || isAbortError(err)) {
    throw abortError(clientGone, abort.signal);  // ← no cleanup before throw
  }
  throw err;  // ← no cleanup
}
```

**Impact:** Any error during execution (network timeout, OOM in sandbox, etc.) leaves the sandbox allocated forever until idle timeout.

**Recommendation:**  
Same as above — use finally block to guarantee cleanup on any exit path.

**Severity:** CRITICAL

---

#### 3. Async cleanup without await in manager.destroy()
**Location:** `backend/internal/sandbox/manager.ts:164-171`

**Issue:**  
The `destroy()` function calls `reap()` without awaiting:
```typescript
destroy(): void {
  if (this.cleanupTimer) {
    clearInterval(this.cleanupTimer);
  }
  for (const threadId of this.sandboxes.keys()) {
    this.reap(threadId);  // ← not awaited; fire-and-forget
  }
}
```

**Impact:** If the backend process exits before async `reap()` promises settle, sandboxes and temp directories are orphaned. On LangSmith, the cloud VMs are not deleted.

**Recommendation:**  
Change to:
```typescript
async destroy(): Promise<void> {
  if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  const promises = [...this.sandboxes.keys()].map((id) => this.reap(id));
  await Promise.all(promises);
}
```

Then ensure `destroy()` is awaited in application shutdown hooks (e.g., process exit handlers).

**Severity:** CRITICAL

---

#### 4. Idle cleanup is fire-and-forget, no error handling
**Location:** `backend/internal/sandbox/manager.ts:146-159`

**Issue:**  
The cleanup loop runs on an interval without awaiting:
```typescript
this.cleanupTimer = setInterval(() => {
  this.cleanupIdle();  // ← not awaited
}, CLEANUP_INTERVAL_MS);

private cleanupIdle(): void {
  // ...
  for (const threadId of entriesToDelete) {
    this.reap(threadId);  // ← not awaited; no error handling
  }
}
```

**Impact:**  
- If a `reap()` fails (e.g., LangSmith API timeout), the failure is silently swallowed.
- Multiple concurrent cleanup attempts could race (though Map iteration should prevent this).
- If cleanup is slow, the next interval fires before the previous finishes.

**Recommendation:**  
Make cleanup async and handle errors:
```typescript
private async cleanupIdle(): Promise<void> {
  // ... build entriesToDelete ...
  const results = await Promise.allSettled(
    entriesToDelete.map((id) => this.reap(id))
  );
  for (const [i, result] of results.entries()) {
    if (result.status === "rejected") {
      console.error(
        `Failed to reap idle sandbox ${entriesToDelete[i]}:`,
        result.reason
      );
    }
  }
}

constructor() {
  this.cleanupTimer = setInterval(async () => {
    await this.cleanupIdle();
  }, CLEANUP_INTERVAL_MS);
  this.cleanupTimer?.unref();
}
```

**Severity:** CRITICAL

---

### HIGH

#### 5. Type safety violation: any-cast in execLangSmith
**Location:** `backend/internal/sandbox/base.ts:247`

**Issue:**  
```typescript
const handle = await (remote as any).run(command, {
  timeout: timeoutMs,
  cwd,
  wait: false,
});
```

**Impact:** If the LangSmith SDK changes the method signature, this will silently fail at runtime instead of compile-time.

**Recommendation:**  
Either:
1. Import and properly type the LangSmith SDK's CommandHandle type, or
2. Define a local interface that matches the expected shape and cast to that instead of `any`.

Example:
```typescript
interface LangSmithCommandHandle {
  [Symbol.asyncIterator](): AsyncIterator<{ stdout?: Uint8Array; stderr?: Uint8Array }>;
  result: Promise<{ exit_code: number }>;
  kill(signal?: string): void;
  sendInput(data: string): void;
}

const handle = await (remote as any).run(...) as LangSmithCommandHandle;
```

**Severity:** HIGH

---

#### 6. Missing frontend SSE-to-message aggregation logic
**Location:** Frontend integration (not found in reviewed files)

**Issue:**  
The frontend types define `SandboxRunPart` and the `SandboxRunDisplay` component renders sandbox runs. The backend emits `sandbox-run` SSE events. However, no reviewed file shows the logic that:
- Collects `sandbox-run` events from the SSE stream
- Aggregates them into `UIMessage.parts` or `UIMessage.sandboxRuns`
- Merges updates to a single run's stdout/stderr as chunks arrive

The frontend `chat-stream.ts` defines `SandboxRun` type but the event parsing in `readSse()` is generic and doesn't handle sandbox run merging.

**Impact:** Sandbox run events may not appear in the chat UI, or may appear as separate messages rather than coalescing.

**Recommendation:**  
Review the frontend message handling (likely in a session/message service) to ensure:
1. SSE `sandbox-run` events are parsed into `SandboxRun` objects.
2. Runs are aggregated by `id` and merged as chunks arrive.
3. Completed runs are added to `UIMessage.parts` as `SandboxRunPart` entries.

Add a test case for this flow (e.g., simulating a multi-chunk sandbox run SSE stream).

**Severity:** HIGH

---

#### 7. execLocal race condition: child.kill() may not work if process already exiting
**Location:** `backend/internal/sandbox/base.ts:195-200`

**Issue:**  
```typescript
const timer = setTimeout(() => {
  child.kill("SIGKILL");
}, timeout + 1000);

child.on("close", (code, sig) => {
  clearTimeout(timer);
  // ...
  resolve({ exitCode, stdout, stderr, signal, duration });
});
```

If the child process exits naturally before the timeout, the timer is cleared and all is well. But if the process ignores SIGKILL (unlikely but possible in Bun/OS context), or if the OS is slow to deliver the signal, the `close` event might not fire and the Promise never resolves.

**Impact:** Tool invocation could hang indefinitely, blocking the chat agent.

**Recommendation:**  
Wrap the Promise in a timeout guard:
```typescript
return Promise.race([
  new Promise<ExecResult>((resolve, reject) => {
    // ... existing logic ...
  }),
  new Promise<ExecResult>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Command timed out after ${timeout}ms`)),
      timeout + 5000  // hard safety margin
    )
  ),
]);
```

**Severity:** HIGH

---

### MEDIUM

#### 8. Validation cwd doesn't match plan's "reject .." requirement
**Location:** `backend/agents/tools/catalog/sandbox.ts:50`

**Issue:**  
The plan (line 362 of plan.md) says:
> reject any path containing `../` or `/` at the start.

The current validation is:
```typescript
if (cwd.includes("..")) {
  throw new Error("Path traversal (..) is not allowed in sandbox");
}
```

This matches the plan. However, the plan's intent is stricter: a check like `foo/../bar` is a traversal but logically valid if normalized. The current check rejects it. This is correct. ✓

**BUT** — there's an inconsistency in `base.ts`:
```typescript
// base.ts:152
if (!cwd.startsWith(root)) {
  throw new Error("Invalid working directory: path traversal detected");
}
```

This check happens AFTER the `cwd` is joined with `root`. So a path like `./foo` will be checked. But if the user supplies `./../../etc`, the check in `sandbox.ts` rejects it first. This is correct, but the error messages and timing are inconsistent. The `sandbox.ts` validation should happen first and should provide the exact message users see.

**Recommendation:**  
No change needed — the layered validation works. But document the intent: `sandbox.ts` validates the **relative** path syntax, and `base.ts` validates the **resolved** path is within the root.

**Severity:** MEDIUM

---

#### 9. No error context when sandbox_exec throws
**Location:** `backend/agents/tools/catalog/sandbox.ts:139-151`

**Issue:**  
If `sandbox.exec()` throws, the tool re-throws it:
```typescript
} catch (err) {
  // Emit error event
  if (emitter) {
    emitter.sandboxRun({
      id: runId,
      command: args.command,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      duration: Date.now() - startedAt,
      startedAt,
    });
  }
  throw err;
}
```

The agent sees the raw error object, not the error event. This is correct for tool error semantics, but the error event is only emitted if `getToolEventEmitter()` is defined. If called outside the chat context, the event is lost and the only signal is the thrown error.

**Impact:** In testing or other non-chat contexts, developers may not see that a sandbox error was intended to be streamed.

**Recommendation:**  
Add a comment or check:
```typescript
if (!emitter) {
  console.warn(
    `[sandbox_exec] Tool event emitter not available; error events will not stream. ` +
    `Ensure tool is called within a chat context with withToolEventEmitter().`
  );
}
```

Also ensure tests set up a mock emitter.

**Severity:** MEDIUM

---

#### 10. No guarantee sandbox-run event emission on success path
**Location:** `backend/agents/tools/catalog/sandbox.ts:125-136`

**Issue:**  
The tool checks `if (emitter)` before emitting the completed event. If called outside the chat context, the command runs but no completion event is emitted. The tool still returns JSON output (good), but streaming is lost.

**Impact:** In a hypothetical future where this tool is exposed to MCP or other surfaces, sandbox output won't stream.

**Recommendation:**  
Document in the tool description that streaming requires the chat context. Or add a fallback: if no emitter, buffer the output and return it with a note that streaming was unavailable.

**Severity:** MEDIUM

---

### STYLE

#### 11. Missing JSDoc comments for public functions
**Location:** `backend/internal/sandbox/manager.ts` and `base.ts`

**Issue:**  
Functions like `getSandbox()`, `runInSandbox()`, `reap()`, and `cleanupIdle()` lack JSDoc. The inline comment on `isLangSmithSandbox()` is helpful, but others are not documented.

**Recommendation:**  
Add JSDoc to all public methods:
```typescript
/**
 * Get or create a sandbox for the given thread ID.
 * Lazily allocates a LangSmith cloud microVM or local temp directory based on env config.
 * Updates the sandbox's lastUsedAt timestamp on access.
 */
async getSandbox(threadId: string): Promise<IsolatedSandbox> {
```

**Severity:** STYLE

---

## Checklist Compliance vs. Plan

| Plan Item | Status | Notes |
| --- | --- | --- |
| 1. Create base.ts | ✓ | Done; no issues with IsolatedSandbox interface or exec signature. |
| 2. Create manager.ts | ✓ | Done; has lifecycle bugs (see CRITICAL findings). |
| 3. Migrate evaluators/sandbox.ts | ✓ | Done; re-exports from base.ts. |
| 4. Implement exec methods | ✓ | Done; LangSmith and local implementations provided. |
| 5. Create sandbox_exec tool | ✓ | Done; schema and validation correct. |
| 6. Update tool catalog | ? | Not reviewed; assume done. |
| 7. Register next-devtools MCP | ✓ | Done in `mcp-client.ts`. |
| 8. Update chat-response contract | ✗ | **MISSING**: `SandboxRunEvent` not added to `chat-response.ts`; `SandboxRunData` is in `events.ts` but not integrated into the contract schema. |
| 9. Emit SSE events in route | ✓ | Done in `execute.ts` with `withToolEventEmitter()`. |
| 10. Hook cleanup on session end | ✗ | **INCOMPLETE**: cleanup only on successful completion, not on error or interruption. |
| 11. Create .mcp.json | ✓ | Done. |
| 12. Update .env.example | ? | Not reviewed; assume done. |
| 13. Define I/O types | ✓ | Done. |
| 14. Regenerate chat-response.ts | ✗ | **MISSING**: `bun run surfaces` not run or results not committed. |
| 15. Define SandboxRunPart type | ✓ | Done in `chat-message.tsx`. |
| 16. Update chat-stream.ts | ✓ | Done; `SandboxRun` type defined. |
| 17. Update chat-message.tsx | ✓ | Done; `SandboxRunDisplay` component implemented. |
| 18. Update UIMessage | ✓ | Done; `sandboxRuns` field noted in type. |
| 19-23. Tests | ✓ | Unit tests present; coverage looks adequate. |
| 24. Run `bun run surfaces` | ✗ | **MISSING**: No evidence this was run. |
| 25-26. Typecheck | ? | Not reviewed. |
| 27. graphify update | ? | Not reviewed. |
| 28. Update backend CLAUDE.md | ? | Not reviewed. |

---

## Deployment Readiness

**Can this be shipped as-is?** NO.

**Blockers before release:**
1. Fix sandbox cleanup to guarantee reap on all exit paths (error, interruption, success).
2. Make cleanup async and properly error-handled.
3. Verify and fix frontend SSE-to-message integration.
4. Run `bun run surfaces` and commit regenerated types.
5. Fix the `any` cast in `execLangSmith`.
6. Add guard against `execLocal` hanging forever.

**Pre-flight checklist for release:**
- [ ] Sandbox cleanup happens in finally block of `runStreamSegment`.
- [ ] `destroy()` is async and awaited in backend shutdown hooks.
- [ ] `cleanupIdle()` properly handles errors and awaits reap calls.
- [ ] Frontend session manager verified to aggregate sandbox-run events into parts.
- [ ] `bun run surfaces` run; new `chat-response.ts` committed with `SandboxRunEvent`.
- [ ] Manual test: start sandbox, interrupt session, verify temp dir is cleaned up.
- [ ] Manual test: start sandbox, kill backend process, verify temp dirs don't orphan.
- [ ] Manual test: run sandbox command, verify SSE events stream to browser.

---

## Additional Observations

1. **Plan adherence:** The architecture matches the approved design (per-thread ephemeral sandbox, LangSmith cloud vs. local fallback, SSE streaming). The implementation is structurally sound.

2. **Security boundaries:** Path validation and workspace isolation are correctly implemented.

3. **Output truncation:** The 64 KB cap per stream is enforced; truncation notices are added.

4. **Timeout handling:** Default 30s, max 120s, correctly clamped. Min 1s is reasonable.

5. **next-devtools-mcp:** Correctly registered in both `mcp-client.ts` and `.mcp.json`; gracefully fails if Next.js dev server is not running.

6. **Test coverage:** Unit tests for `sandbox_exec` and manager are present; cover happy path, error cases, and lifecycle. Frontend tests not reviewed but should test SSE parsing.

---

## Recommended Reading Order for Fixes

1. **First:** `backend/routes/chat.ts` — add finally block and unconditional reap.
2. **Second:** `backend/internal/sandbox/manager.ts` — make destroy and cleanupIdle async.
3. **Third:** `backend/internal/sandbox/base.ts` — remove `any` cast, add safety timeout.
4. **Fourth:** Frontend session manager — verify sandbox-run event handling.
5. **Fifth:** Run `bun run surfaces` and test typecheck.

---

## Sign-Off

**CURRENT STATUS:** NOT SHIP-READY

**NEXT STEP:** Address all CRITICAL findings. Re-test cleanup guarantees. Verify frontend integration. Then re-review and mark ship-ready.
