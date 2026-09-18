import { rm } from "node:fs/promises";
import { Sandbox } from "langsmith/sandbox";
import type { IsolatedSandbox } from "./base";
import {
  langSmithSandboxConfigured,
  createRawLocalSandbox,
  createRawLangSmithSandbox,
} from "./base";

interface SandboxHandle {
  sandbox: IsolatedSandbox;
  remote?: Sandbox; // Sandbox instance from LangSmith
  createdAt: number;
  lastUsedAt: number;
  mutex: Promise<void>; // For sequential execution
  mutexResolve?: () => void;
}

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 60 seconds

/**
 * Check if a sandbox is a LangSmith remote sandbox.
 */
function isLangSmithSandbox(handle: SandboxHandle): boolean {
  return handle.remote instanceof Sandbox;
}

/**
 * ChatSandboxManager is a singleton that manages per-thread sandboxes.
 * Each thread gets one ephemeral sandbox that is created on first use
 * and reaped on session end or idle timeout.
 */
class ChatSandboxManagerImpl {
  private sandboxes = new Map<string, SandboxHandle>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    // Start idle cleanup loop
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdle().catch((err) => {
        console.error(`Idle cleanup error:`, err);
      });
    }, CLEANUP_INTERVAL_MS);
    // Ensure cleanup loop is not blocking the process from exiting
    this.cleanupTimer?.unref();
  }

  /**
   * Get or create a sandbox for the given thread ID.
   */
  async getSandbox(threadId: string): Promise<IsolatedSandbox> {
    let handle = this.sandboxes.get(threadId);

    if (!handle) {
      // Create a new sandbox
      if (langSmithSandboxConfigured()) {
        // Use LangSmith cloud sandbox
        const { sandbox, remote } = await createRawLangSmithSandbox(threadId);

        handle = {
          sandbox,
          remote,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          mutex: Promise.resolve(),
        };
      } else {
        // Use local sandbox
        const { sandbox } = await createRawLocalSandbox(threadId);

        handle = {
          sandbox,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          mutex: Promise.resolve(),
        };
      }

      this.sandboxes.set(threadId, handle);
    }

    // Update last used time
    handle.lastUsedAt = Date.now();

    return handle.sandbox;
  }

  /**
   * Queue a function to run sequentially in the sandbox's mutex.
   */
  async runInSandbox<T>(
    threadId: string,
    fn: (sandbox: IsolatedSandbox) => Promise<T>,
  ): Promise<T> {
    const handle = this.sandboxes.get(threadId);
    if (!handle) {
      throw new Error(`Sandbox not found for thread ${threadId}`);
    }

    // Wait for current mutation to complete, then acquire the lock
    const oldMutex = handle.mutex;
    let resolve: () => void;
    handle.mutex = new Promise((r) => {
      resolve = r;
    });
    handle.mutexResolve = resolve!;

    try {
      await oldMutex;
      return await fn(handle.sandbox);
    } finally {
      resolve!();
    }
  }

  /**
   * Reap a sandbox, cleaning up resources.
   */
  async reap(threadId: string): Promise<void> {
    const handle = this.sandboxes.get(threadId);
    if (!handle) return;

    try {
      // Clean up LangSmith if applicable
      if (isLangSmithSandbox(handle)) {
        try {
          await handle.remote!.delete();
        } catch (err) {
          console.error(`Failed to delete LangSmith sandbox ${threadId}:`, err);
        }
      } else {
        // Local: rm -rf temp dir
        try {
          await rm(handle.sandbox.root, { recursive: true, force: true });
        } catch (err) {
          console.error(`Failed to delete local sandbox ${threadId}:`, err);
        }
      }
    } finally {
      this.sandboxes.delete(threadId);
    }
  }

  /**
   * Clean up idle sandboxes.
   */
  private async cleanupIdle(): Promise<void> {
    const now = Date.now();
    const entriesToDelete: string[] = [];

    for (const [threadId, handle] of this.sandboxes) {
      if (now - handle.lastUsedAt > IDLE_TIMEOUT_MS) {
        entriesToDelete.push(threadId);
      }
    }

    if (entriesToDelete.length === 0) return;

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

  /**
   * Destroy the manager and clean up all resources.
   */
  async destroy(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    // Force reap all sandboxes
    const promises = [...this.sandboxes.keys()].map((id) => this.reap(id));
    const results = await Promise.allSettled(promises);
    for (const [i, result] of results.entries()) {
      if (result.status === "rejected") {
        console.error(`Failed to reap sandbox on shutdown:`, result.reason);
      }
    }
  }
}

// Singleton instance
let manager: ChatSandboxManagerImpl | undefined;

export function getChatSandboxManager(): ChatSandboxManagerImpl {
  if (!manager) {
    manager = new ChatSandboxManagerImpl();
  }
  return manager;
}

export async function destroyChatSandboxManager(): Promise<void> {
  if (manager) {
    await manager.destroy();
    manager = undefined;
  }
}
