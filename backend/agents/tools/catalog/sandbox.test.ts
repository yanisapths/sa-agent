import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sandboxTools } from "./sandbox";
import { getChatSandboxManager } from "../../../internal/sandbox/manager";

describe("sandbox tools", () => {
  const tool = sandboxTools[0]!;

  it("has correct name and surfaces", () => {
    expect(tool.name).toBe("sandbox_exec");
    expect(tool.surfaces).toContain("langchain");
  });

  describe("input validation", () => {
    it("validates cwd prevents path traversal", async () => {
      const mockContext = {
        threadId: "test-thread",
      };

      await expect(
        tool.invoke({ command: "ls", cwd: "../etc" }, mockContext),
      ).rejects.toThrow("Path traversal (..) is not allowed in sandbox");
    });

    it("validates cwd prevents absolute paths", async () => {
      const mockContext = {
        threadId: "test-thread",
      };

      await expect(
        tool.invoke({ command: "ls", cwd: "/etc" }, mockContext),
      ).rejects.toThrow("not allowed");
    });
  });

  describe("timeout handling", () => {
    it("clamps timeout to min 1000ms", async () => {
      const mockContext = {
        threadId: "test-thread",
      };

      // Very low timeout should be clamped to 1000ms
      const resultStr = await tool.invoke(
        { command: "echo hello", timeout: 100 },
        mockContext,
      );
      const result = JSON.parse(resultStr);
      // Should still execute successfully
      expect(result).toHaveProperty("exitCode");
    });

    it("clamps timeout to max 120000ms", async () => {
      const mockContext = {
        threadId: "test-thread",
      };

      // Very high timeout should be clamped to 120000ms
      const resultStr = await tool.invoke(
        { command: "echo hello", timeout: 200000 },
        mockContext,
      );
      const result = JSON.parse(resultStr);
      expect(result).toHaveProperty("exitCode");
    });
  });

  describe("command execution", () => {
    it("executes simple commands", async () => {
      const mockContext = {
        threadId: "test-thread",
      };

      const resultStr = await tool.invoke(
        { command: "echo hello" },
        mockContext,
      );
      const result = JSON.parse(resultStr);
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("hello");
      expect(result.exitCode).toBe(0);
    });

    it("captures exit codes for failed commands", async () => {
      const mockContext = {
        threadId: "test-thread",
      };

      const resultStr = await tool.invoke(
        { command: "exit 42" },
        mockContext,
      );
      const result = JSON.parse(resultStr);
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(42);
    });

    it("captures stderr output", async () => {
      const mockContext = {
        threadId: "test-thread",
      };

      const resultStr = await tool.invoke(
        { command: "echo error >&2" },
        mockContext,
      );
      const result = JSON.parse(resultStr);
      expect(result.stderr).toContain("error");
    });
  });

  describe("output handling", () => {
    it("returns duration in milliseconds", async () => {
      const mockContext = {
        threadId: "test-thread",
      };

      const resultStr = await tool.invoke(
        { command: "echo test" },
        mockContext,
      );
      const result = JSON.parse(resultStr);
      expect(typeof result.duration).toBe("number");
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("includes command echo in output", async () => {
      const mockContext = {
        threadId: "test-thread",
      };

      const cmd = "echo test";
      const resultStr = await tool.invoke({ command: cmd }, mockContext);
      const result = JSON.parse(resultStr);
      expect(result.command).toBe(cmd);
    });

    it("includes cwd in output", async () => {
      const mockContext = {
        threadId: "test-thread",
      };

      const resultStr = await tool.invoke(
        { command: "pwd", cwd: undefined },
        mockContext,
      );
      const result = JSON.parse(resultStr);
      expect(result.cwd).toBe(".");
    });
  });

  describe("error handling", () => {
    it("throws error when threadId is missing", async () => {
      const mockContext = {};

      await expect(
        tool.invoke({ command: "echo test" }, mockContext),
      ).rejects.toThrow("threadId is required");
    });
  });
});
