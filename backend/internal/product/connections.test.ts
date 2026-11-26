import { afterEach, describe, expect, test } from "bun:test";
import type { Connection } from "../../contract/connection";
import {
  assertConnectionsAllowed,
  hostAllowed,
  isBlockedAddress,
  MAX_CONNECTIONS_HEADER_BYTES,
  parseConnections,
  pinOutbound,
  resolveConnection,
  scrubSecrets,
  withConnections,
  currentConnection,
} from "./connections";
import { defaultProduct } from "./default";
import type { ResolvedProduct } from "./types";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

const PG: Connection = { kind: "postgres", url: "postgresql://club:hunter22@db.club.internal:5432/club", schema: "public" };
const CF: Connection = {
  kind: "confluence",
  baseUrl: "https://club.atlassian.net/wiki",
  spaceKey: "CLUB",
  username: "me@club.co",
  token: "atl-secret-token",
};

function product(overrides: Partial<ResolvedProduct> = {}): ResolvedProduct {
  return {
    id: "prd_1",
    slug: "club-co",
    name: "Club&co",
    isDefault: false,
    db: { urlEnv: "SA_PRODUCT_CLUB_DATABASE_URL", schema: "public" },
    docs: { provider: "none" },
    index: {},
    models: {},
    repos: [],
    connectionSources: {},
    ...overrides,
  };
}

const lookupTo =
  (...addresses: string[]) =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

describe("X-SA-Connections parsing", () => {
  test("absent or empty is no connections", () => {
    expect(parseConnections(undefined)).toEqual([]);
    expect(parseConnections("  ")).toEqual([]);
  });

  test("decodes base64url JSON", () => {
    expect(parseConnections(encode([PG, CF]))).toEqual([PG, CF]);
  });

  test("rejects a header over 8 KB before decoding", () => {
    const big = "A".repeat(MAX_CONNECTIONS_HEADER_BYTES + 1);
    expect(() => parseConnections(big)).toThrow(/over 8 KB/);
  });

  test("rejects more than 4 connections and duplicate kinds", () => {
    expect(() => parseConnections(encode([PG, PG, PG, PG, PG]))).toThrow(/At most 4/);
    expect(() => parseConnections(encode([PG, PG]))).toThrow(/more than one postgres/);
  });

  test("rejects non-base64 and repeated headers without echoing the value", () => {
    let message = "";
    try {
      parseConnections("not base64 hunter22!");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("base64url");
    expect(message).not.toContain("hunter22");
    expect(() => parseConnections(["a", "b"])).toThrow(/once/);
  });

  test("a username without a token is invalid", () => {
    const bad = { kind: "confluence", baseUrl: "https://x.atlassian.net/wiki", spaceKey: "X", username: "me" };
    expect(() => parseConnections(encode([bad]))).toThrow(/token/);
  });
});

describe("outbound rules", () => {
  const savedEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = savedEnv;
  });

  test("metadata and link-local addresses are always blocked; private ranges are not", () => {
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedAddress("fd00:ec2::254")).toBe(true);
    expect(isBlockedAddress("fe80::1")).toBe(true);
    expect(isBlockedAddress("0.0.0.0")).toBe(true);
    expect(isBlockedAddress("10.0.0.5")).toBe(false);
    expect(isBlockedAddress("192.168.1.10")).toBe(false);
  });

  test("a literal metadata IP is rejected", async () => {
    await expect(pinOutbound("postgresql://u:p@169.254.169.254/db", "postgres", lookupTo())).rejects.toThrow(
      /link-local or metadata/,
    );
  });

  test("a name that resolves to metadata is rejected (DNS)", async () => {
    await expect(
      pinOutbound("https://evil.example.com/wiki", "confluence", lookupTo("10.0.0.1", "169.254.169.254")),
    ).rejects.toThrow(/link-local or metadata/);
  });

  test("pins to the resolved address", async () => {
    const pin = await pinOutbound("postgresql://u:p@db.internal:5432/x", "postgres", lookupTo("10.1.2.3"));
    expect(pin).toEqual({ hostname: "db.internal", address: "10.1.2.3", family: 4 });
  });

  test("wrong schemes are rejected", async () => {
    await expect(pinOutbound("mysql://u:p@db/x", "postgres", lookupTo("10.0.0.1"))).rejects.toThrow(/postgresql/);
    await expect(pinOutbound("http://wiki.example.com", "confluence", lookupTo("10.0.0.1"))).rejects.toThrow(
      /https/,
    );
    await expect(pinOutbound("http://localhost:8090", "confluence", lookupTo("127.0.0.1"))).resolves.toBeDefined();
  });

  test("a non-local deployment without an allowlist refuses browser connections", async () => {
    process.env.NODE_ENV = "production";
    await expect(pinOutbound("https://club.atlassian.net/wiki", "confluence", lookupTo("1.2.3.4"))).rejects.toThrow(
      /SA_CONNECTION_ALLOWED_HOSTS/,
    );
    await expect(assertConnectionsAllowed([CF], lookupTo("1.2.3.4"))).rejects.toThrow(/hosted backend/);
  });

  test("allowlist entries match exactly or by *.domain", () => {
    expect(hostAllowed("db.acme.com", ["db.acme.com"])).toBe(true);
    expect(hostAllowed("eu.db.acme.com", ["*.acme.com"])).toBe(true);
    expect(hostAllowed("acme.com", ["*.acme.com"])).toBe(false);
    expect(hostAllowed("evilacme.com", ["*.acme.com"])).toBe(false);
  });
});

describe("resolveConnection", () => {
  test("browser first, then the product's env reference", () => {
    const env = { SA_PRODUCT_CLUB_DATABASE_URL: "postgresql://env@db/club" };
    expect(resolveConnection(product(), "postgres", [PG], env)?.source).toBe("browser");
    expect(resolveConnection(product(), "postgres", [], env)).toEqual({
      source: "env",
      connection: { kind: "postgres", url: "postgresql://env@db/club", schema: "public" },
    });
  });

  test("a non-default product never falls back to Default's .env", () => {
    const env = { DATABASE_URL: "postgresql://default@db/app" };
    expect(resolveConnection(product(), "postgres", [], env)).toBeUndefined();
    expect(resolveConnection(product(), "jira", [], env)).toBeUndefined();
  });

  test("source 'browser' turns the env reference off", () => {
    const env = { SA_PRODUCT_CLUB_DATABASE_URL: "postgresql://env@db/club" };
    const browserOnly = product({ connectionSources: { postgres: "browser" } });
    expect(resolveConnection(browserOnly, "postgres", [], env)).toBeUndefined();
  });

  test("an env reference outside SA_PRODUCT_ throws", () => {
    const sneaky = product({ db: { urlEnv: "SUPABASE_SERVICE_ROLE_KEY", schema: "public" } });
    expect(() => resolveConnection(sneaky, "postgres", [], { SUPABASE_SERVICE_ROLE_KEY: "x" })).toThrow(
      /SA_PRODUCT_/,
    );
  });

  test("Default reads the global DATABASE_URL", () => {
    const resolved = resolveConnection(defaultProduct(), "postgres", [], { DATABASE_URL: "postgresql://d@db/app" });
    expect(resolved?.source).toBe("default");
  });

  test("tools read connections from the request scope only", async () => {
    expect(currentConnection("postgres")).toBeUndefined();
    await withConnections([PG], async () => {
      expect(currentConnection("postgres")).toEqual(PG);
    });
    expect(currentConnection("postgres")).toBeUndefined();
  });
});

describe("scrubSecrets", () => {
  test("removes values, URL passwords and any userinfo", () => {
    const text =
      'connect failed for postgresql://club:hunter22@db.club.internal:5432/club (password "hunter22"); token atl-secret-token; other https://bob:pw@x.io/';
    const out = scrubSecrets(text, [PG, CF]);
    expect(out).not.toContain("hunter22");
    expect(out).not.toContain("atl-secret-token");
    expect(out).not.toContain("bob:pw");
    expect(out).toContain("[redacted]");
  });
});
