import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultProduct } from "./default";
import { EnvRefError, resolveEnvRef } from "./env-ref";
import { productFromProfile } from "./profile-file";
import {
  deleteProduct,
  importProfile,
  parseProductInput,
  slugify,
  throwIfMissingTable,
  toResponse,
  updateProduct,
} from "./service";

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "sa-product-")));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function repoWith(name: string, profile?: unknown): string {
  const root = path.join(tmp, name);
  mkdirSync(path.join(root, ".git"), { recursive: true });
  if (profile !== undefined) {
    mkdirSync(path.join(root, ".sa"), { recursive: true });
    writeFileSync(path.join(root, ".sa", "product.json"), JSON.stringify(profile));
  }
  return root;
}

describe("env references", () => {
  test("only SA_PRODUCT_* names are readable", () => {
    expect(resolveEnvRef("SA_PRODUCT_CLUB_DATABASE_URL", { SA_PRODUCT_CLUB_DATABASE_URL: "x" })).toBe("x");
    expect(resolveEnvRef("SA_PRODUCT_UNSET", {})).toBeUndefined();
    expect(() => resolveEnvRef("SUPABASE_SERVICE_ROLE_KEY", { SUPABASE_SERVICE_ROLE_KEY: "k" })).toThrow(
      EnvRefError,
    );
    expect(() => resolveEnvRef("DATABASE_URL")).toThrow(EnvRefError);
  });

  test("a product body naming another secret is a 400", () => {
    expect(() =>
      parseProductInput({ name: "Club", db: { urlEnv: "SUPABASE_SERVICE_ROLE_KEY" } }),
    ).toThrow(/Invalid product/);
    expect(() =>
      parseProductInput({
        name: "Club",
        docs: { provider: "confluence", spaceKey: "CLUB", tokenEnv: "BIFROST_API_KEY" },
      }),
    ).toThrow(/Invalid product/);
  });

  test("a product body has no field for a value: unknown keys are dropped", () => {
    const parsed = parseProductInput({
      name: "Club",
      db: { urlEnv: "SA_PRODUCT_CLUB_DATABASE_URL", url: "postgresql://u:p@db/x" },
      token: "secret",
    });
    expect(JSON.stringify(parsed)).not.toContain("postgresql://");
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });

  test("slugs are lowercase and 'default' is reserved", () => {
    expect(slugify("Club & Co!")).toBe("club-co");
    expect(() => parseProductInput({ name: "X", slug: "default" })).toThrow(/Invalid product/);
  });
});

describe("product responses", () => {
  test("carry names and hosts, never values", () => {
    const saved = process.env.SA_PRODUCT_CLUB_DATABASE_URL;
    process.env.SA_PRODUCT_CLUB_DATABASE_URL = "postgresql://club:hunter22@db.club.internal:5432/club";
    try {
      const product = productFromProfile(
        {
          id: "club-co",
          name: "Club&co",
          db: { urlEnv: "SA_PRODUCT_CLUB_DATABASE_URL", schema: "public" },
          docs: { provider: "none" },
          index: {},
        },
        "/work/club",
      );
      const body = JSON.stringify(toResponse(product));
      expect(body).not.toContain("hunter22");
      expect(body).not.toContain("postgresql://");
      expect(body).toContain("SA_PRODUCT_CLUB_DATABASE_URL");
      expect(body).toContain("db.club.internal");
    } finally {
      if (saved === undefined) delete process.env.SA_PRODUCT_CLUB_DATABASE_URL;
      else process.env.SA_PRODUCT_CLUB_DATABASE_URL = saved;
    }
  });

  test("Default comes from .env and cannot be edited or deleted", async () => {
    expect(toResponse(defaultProduct()).isDefault).toBe(true);
    await expect(updateProduct("user-1", "default", { name: "x" })).rejects.toThrow(/Default/);
    await expect(deleteProduct("user-1", "default")).rejects.toThrow(/Default/);
  });

  test("a missing products table or column is a 503 that names the SQL files", () => {
    expect(() => throwIfMissingTable({ code: "PGRST205", message: "table not in cache" })).toThrow(
      /products\.sql/,
    );
    expect(() => throwIfMissingTable({ code: "PGRST204", message: "column not in cache" })).toThrow(
      /products-connections\.sql/,
    );
  });
});

describe("importProfile", () => {
  test("reads a committed .sa/product.json at the folder root", () => {
    const root = repoWith("club", {
      id: "club-co",
      name: "Club&co",
      db: { urlEnv: "SA_PRODUCT_CLUB_DATABASE_URL" },
      docs: { provider: "confluence", spaceKey: "CLUB" },
    });
    const imported = importProfile(root);
    expect(imported.found).toBe(true);
    expect(imported.profile?.name).toBe("Club&co");
    expect(imported.profile?.db?.schema).toBe("public");
  });

  test("a folder without a profile is not an error", () => {
    expect(importProfile(repoWith("plain"))).toEqual({ path: path.join(tmp, "plain"), found: false });
  });

  test("an invalid profile is a 400 that names the problem", () => {
    const root = repoWith("broken", { id: "Bad Id", name: "x", db: { urlEnv: "DATABASE_URL" } });
    expect(() => importProfile(root)).toThrow(/not a valid product profile/);
  });

  test("a missing folder is a 400", () => {
    expect(() => importProfile(path.join(tmp, "nope"))).toThrow(/does not exist/);
  });
});
