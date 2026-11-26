import { describe, expect, test } from "bun:test";
import {
  ALL_CAPABILITIES,
  capabilitiesOf,
  capabilityNote,
  capabilitySignature,
  grantedTools,
} from "./capabilities";
import type { ResolvedProduct } from "./types";

function product(overrides: Partial<ResolvedProduct> = {}): ResolvedProduct {
  return {
    id: "prd_1",
    slug: "club-co",
    name: "Club&co",
    isDefault: false,
    db: { schema: "public" },
    docs: { provider: "none" },
    index: {},
    models: {},
    repos: [],
    connectionSources: {},
    ...overrides,
  };
}

describe("capabilitiesOf", () => {
  test("a bare product has nothing", () => {
    expect(capabilitiesOf(product(), { connections: [] })).toEqual({
      db: false,
      docs: false,
      schemaIndex: false,
      repos: false,
    });
  });

  test("browser connections, an index and an attached folder turn capabilities on", () => {
    const caps = capabilitiesOf(product({ index: { ddlCollection: "club_ddl" } }), {
      attachedRoot: "/work/club",
      connections: [
        { kind: "postgres", url: "postgresql://u:p@db/club", schema: "public" },
        { kind: "confluence", baseUrl: "https://club.atlassian.net/wiki", spaceKey: "CLUB" },
      ],
    });
    expect(caps).toEqual(ALL_CAPABILITIES);
  });

  test("a product repo counts without an attached folder", () => {
    const caps = capabilitiesOf(product({ repos: [{ id: "w1", name: "app", path: "/work/app" }] }), {
      connections: [],
    });
    expect(caps.repos).toBe(true);
  });
});

describe("tool gating", () => {
  const tools = ["list_tables", "run_sql", "search_docs", "search_schema_docs", "workspace_read", "fetch_jira_issue"];

  test("all capabilities keep every tool", () => {
    expect(grantedTools(tools, ALL_CAPABILITIES)).toEqual(tools);
  });

  test("missing capabilities remove their tools and nothing else", () => {
    const caps = { db: false, docs: true, schemaIndex: false, repos: false };
    expect(grantedTools(tools, caps)).toEqual(["search_docs", "fetch_jira_issue"]);
  });

  test("the signature is secret-free and changes with capabilities", () => {
    expect(capabilitySignature(ALL_CAPABILITIES)).toBe("db1docs1idx1repo1");
    expect(capabilitySignature({ ...ALL_CAPABILITIES, db: false })).toBe("db0docs1idx1repo1");
  });

  test("the prompt note names what is missing and tells the agent not to guess", () => {
    expect(capabilityNote(ALL_CAPABILITIES)).toBe("");
    const note = capabilityNote({ ...ALL_CAPABILITIES, db: false });
    expect(note).toContain("no database connected");
    expect(note).toContain("Do not guess");
    expect(note).not.toContain("Confluence");
  });
});
