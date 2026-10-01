import { describe, expect, test } from "bun:test";
import {
  confluenceAuthorization,
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

describe("confluence authorization", () => {
  const cloud = "https://acme.atlassian.net/wiki";
  const server = "https://confluence.example.com";
  const email = "dev@example.com";
  const apiToken = "api-token";
  const encoded = Buffer.from(`${email}:${apiToken}`).toString("base64");

  test("uses Basic on Cloud even when a PAT is also set", () => {
    const header = confluenceAuthorization({
      baseUrl: cloud,
      username: email,
      accessToken: apiToken,
      personalToken: "server-pat",
    });
    expect(header).toBe(`Basic ${encoded}`);
  });

  test("treats a base64 email:token PAT as Basic on Cloud", () => {
    expect(
      confluenceAuthorization({
        baseUrl: cloud,
        personalToken: encoded,
      }),
    ).toBe(`Basic ${encoded}`);
  });

  test("uses Bearer for a Server personal access token", () => {
    expect(
      confluenceAuthorization({
        baseUrl: server,
        personalToken: "server-pat",
        username: email,
        accessToken: apiToken,
      }),
    ).toBe("Bearer server-pat");
  });
});
