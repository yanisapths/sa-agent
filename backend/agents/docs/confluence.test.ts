import { describe, expect, test } from "bun:test";
import type { ResolvedProduct } from "../../internal/product/types";
import { targetFor } from "./confluence";
import { docsProviderFor } from "./index";

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

describe("docs provider", () => {
  test("a product without docs says so instead of searching another space", async () => {
    const provider = docsProviderFor(product(), []);
    expect(provider.name).toBe("none");
    await expect(provider.search("orders", 5)).rejects.toThrow(/Club&co" has no Confluence docs connected/);
  });

  test("a browser connection targets its own site, pinned, with its own auth", () => {
    const target = targetFor(product(), [
      {
        kind: "confluence",
        baseUrl: "https://club.atlassian.net/wiki",
        spaceKey: "CLUB",
        username: "me@club.co",
        token: "atl-token",
      },
    ]);
    expect(target?.baseUrl).toBe("https://club.atlassian.net/wiki");
    expect(target?.spaceKey).toBe("CLUB");
    expect(target?.pinned).toBe(true);
    expect(target?.username).toBe("me@club.co");
    expect(target?.accessToken).toBe("atl-token");
  });

  test("a public space works without a token", () => {
    const target = targetFor(product(), [
      { kind: "confluence", baseUrl: "https://wiki.example.com", spaceKey: "PUB" },
    ]);
    expect(target?.accessToken).toBeUndefined();
    expect(target?.personalToken).toBeUndefined();
  });

  test("an env-sourced product is not pinned and reads only SA_PRODUCT_ tokens", () => {
    const saved = process.env.SA_PRODUCT_CLUB_CONFLUENCE_TOKEN;
    process.env.SA_PRODUCT_CLUB_CONFLUENCE_TOKEN = "env-pat";
    try {
      const target = targetFor(
        product({
          docs: {
            provider: "confluence",
            spaceKey: "CLUB",
            baseUrl: "https://confluence.club.internal",
            tokenEnv: "SA_PRODUCT_CLUB_CONFLUENCE_TOKEN",
          },
        }),
        [],
      );
      expect(target?.pinned).toBe(false);
      expect(target?.personalToken).toBe("env-pat");
    } finally {
      if (saved === undefined) delete process.env.SA_PRODUCT_CLUB_CONFLUENCE_TOKEN;
      else process.env.SA_PRODUCT_CLUB_CONFLUENCE_TOKEN = saved;
    }
  });
});
