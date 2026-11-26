import { describe, expect, test } from "bun:test";

import { connectionsDefaults, connectionsForTest, toConnections } from "./form";

const filled = {
  ...connectionsDefaults(null, []),
  postgres: {
    ...connectionsDefaults(null, []).postgres,
    enabled: true,
    url: "postgresql://readonly:p@host:5432/app",
  },
  confluence: {
    ...connectionsDefaults(null, []).confluence,
    enabled: true,
    baseUrl: "https://acme.atlassian.net/wiki",
    spaceKey: "ENG",
    token: "tok",
  },
  jira: {
    ...connectionsDefaults(null, []).jira,
    enabled: true,
    baseUrl: "https://acme.atlassian.net",
    token: "tok",
  },
};

describe("connectionsForTest", () => {
  test("does not send empty browser fields so Default cannot fake a pass from .env", () => {
    const empty = connectionsDefaults(null, []);
    empty.postgres.enabled = true;
    empty.confluence.enabled = true;
    empty.jira.enabled = true;
    expect(connectionsForTest(empty, [], "postgres")).toEqual({
      detail: "Enter a postgresql:// URL first.",
    });
    expect(connectionsForTest(empty, [], "confluence")).toEqual({
      detail: "Enter the site URL and space key first.",
    });
    expect(connectionsForTest(empty, [], "jira")).toEqual({
      detail: "Enter the Jira URL and token first.",
    });
    expect(toConnections(empty, [])).toEqual([]);
  });

  test("sends the filled browser connection", () => {
    expect(connectionsForTest(filled, [], "postgres")).toEqual({
      connections: [{ kind: "postgres", url: filled.postgres.url, schema: "public" }],
    });
  });

  test("env source sends no browser secret; the backend reads the env reference", () => {
    const env = {
      ...filled,
      postgres: { ...filled.postgres, source: "env" as const, urlEnv: "SA_PRODUCT_CLUB_DATABASE_URL" },
    };
    expect(connectionsForTest(env, [], "postgres")).toEqual({ connections: [] });
  });
});
