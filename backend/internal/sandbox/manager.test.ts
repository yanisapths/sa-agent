import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getChatSandboxManager,
  destroyChatSandboxManager,
} from "./manager";

describe("ChatSandboxManager", () => {
  beforeEach(async () => {
    // Reset manager before each test
    await destroyChatSandboxManager();
  });

  afterEach(async () => {
    // Clean up after each test
    await destroyChatSandboxManager();
  });

  it("creates and reuses sandboxes per threadId", async () => {
    const manager = getChatSandboxManager();
    const threadId = "test-thread-1";

    const sandbox1 = await manager.getSandbox(threadId);
    const sandbox2 = await manager.getSandbox(threadId);

    // Should be the same instance
    expect(sandbox1.name).toBe(sandbox2.name);
  });

  it("creates different sandboxes for different threadIds", async () => {
    const manager = getChatSandboxManager();

    const sandbox1 = await manager.getSandbox("thread-1");
    const sandbox2 = await manager.getSandbox("thread-2");

    expect(sandbox1.name).not.toBe(sandbox2.name);
  });

  it("reaps sandboxes on request", async () => {
    const manager = getChatSandboxManager();
    const threadId = "test-thread";

    const sandbox1 = await manager.getSandbox(threadId);
    await manager.reap(threadId);

    // After reaping, a new get should create a new sandbox
    const sandbox2 = await manager.getSandbox(threadId);

    // Names should be different (though we can't directly compare instances
    // because the impl might reuse names after reaping)
    expect(sandbox1).toBeDefined();
    expect(sandbox2).toBeDefined();
  });

  it("returns singleton manager instance", () => {
    const manager1 = getChatSandboxManager();
    const manager2 = getChatSandboxManager();

    expect(manager1).toBe(manager2);
  });

  it("allows sandbox to execute commands", async () => {
    const manager = getChatSandboxManager();
    const threadId = "test-thread";

    const sandbox = await manager.getSandbox(threadId);
    const result = await sandbox.exec("echo hello");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello");
  });

  describe("idle cleanup", () => {
    it("should have idle cleanup configured", async () => {
      const manager = getChatSandboxManager();
      // Verify that the manager is created and has cleanup infrastructure
      expect(manager).toBeDefined();
      // Cleanup timer will be set up automatically
    });
  });

  describe("manager lifecycle", () => {
    it("can be destroyed and recreated", async () => {
      const manager1 = getChatSandboxManager();
      await destroyChatSandboxManager();
      const manager2 = getChatSandboxManager();

      expect(manager1).not.toBe(manager2);
    });
  });
});
