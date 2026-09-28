import { describe, expect, test } from "bun:test";
import {
  confluenceCql,
  confluencePageUrl,
  htmlToDocText,
  parsePageRef,
} from "./confluence-api";

describe("confluence docs query helpers", () => {
  test("wraps a plain query as page CQL inside the configured space", () => {
    expect(confluenceCql("voting overview", "API")).toBe(
      'type = page AND space = "API" AND text ~ "voting overview"',
    );
  });

  test("leaves an existing CQL expression unchanged", () => {
    const cql = 'type = page AND text ~ "billing"';
    expect(confluenceCql(cql, "API")).toBe(cql);
  });

  test("reads a page id from a bare id or a Confluence URL", () => {
    expect(parsePageRef(" 12345 ")).toEqual({ id: "12345" });
    expect(
      parsePageRef("https://acme.atlassian.net/wiki/spaces/API/pages/12345/Voting"),
    ).toEqual({ id: "12345" });
    expect(parsePageRef("Voting overview")).toEqual({ title: "Voting overview" });
  });

  test("joins a site base with a webui path", () => {
    expect(
      confluencePageUrl(
        "https://acme.atlassian.net/wiki",
        "/spaces/API/pages/12345/Voting",
      ),
    ).toBe("https://acme.atlassian.net/wiki/spaces/API/pages/12345/Voting");
  });

  test("turns storage HTML into text", () => {
    expect(htmlToDocText("<p>Hello <strong>API</strong></p>")).toBe("Hello API");
  });
});
