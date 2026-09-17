import { describe, expect, test } from "bun:test";
import { selectAgentKind } from "./route";

function kind(
  message: string,
  extra: { hasWorkspace?: boolean; phase?: string; hasPvtCases?: boolean } = {},
) {
  return selectAgentKind({
    threadId: `route-test-${crypto.randomUUID()}`,
    message,
    ...extra,
  });
}

describe("selectAgentKind", () => {
  test("attached folder with real work uses the Deep Agent", () => {
    expect(
      kind("create the missing tfvars instead of aborting prep", {
        hasWorkspace: true,
      }),
    ).toBe("deep");
  });

  test("greeting with a folder attached stays plain", () => {
    expect(kind("hi", { hasWorkspace: true })).toBe("plain");
    expect(kind("thanks", { hasWorkspace: true })).toBe("plain");
  });

  test("docs question with no folder uses chat", () => {
    expect(kind("what is the voting API?")).toBe("chat");
  });

  test("implement/refactor still uses the Deep Agent without a folder", () => {
    expect(kind("implement the approved plan")).toBe("deep");
    expect(kind("refactor the auth middleware")).toBe("deep");
  });

  test("explicit phase wins", () => {
    expect(kind("hi", { phase: "execute" })).toBe("deep");
  });
});
