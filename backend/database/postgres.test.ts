import { afterAll, describe, expect, test } from "bun:test";
import { closeProductPools, openPoolCount, poolFor } from "./postgres";

const club = { kind: "postgres" as const, url: "postgresql://u:p@db.club.internal:5432/club", schema: "public" };
const aster = { kind: "postgres" as const, url: "postgresql://u:p@db.aster.internal:5432/aster", schema: "public" };

afterAll(async () => {
  await closeProductPools("prd_club");
  await closeProductPools("prd_aster");
});

describe("per-product pools", () => {
  test("one pool per connection, reused, and closed with its product", async () => {
    const before = openPoolCount();
    const first = poolFor(club, { productId: "prd_club" });
    expect(poolFor(club, { productId: "prd_club" })).toBe(first);
    const other = poolFor(aster, { productId: "prd_aster" });
    expect(other).not.toBe(first);
    expect(openPoolCount()).toBe(before + 2);

    await closeProductPools("prd_club");
    expect(openPoolCount()).toBe(before + 1);
    expect(poolFor(club, { productId: "prd_club" })).not.toBe(first);
  });

  test("a pinned pool is keyed by the pinned address, not only the URL", () => {
    const plain = poolFor(club, { productId: "prd_club" });
    const pinned = poolFor(club, {
      productId: "prd_club",
      pin: { hostname: "db.club.internal", address: "10.0.0.7", family: 4 },
    });
    expect(pinned).not.toBe(plain);
  });

  test("product pools are capped at 3 connections", () => {
    expect(poolFor(aster, { productId: "prd_aster" }).options.max).toBe(3);
  });
});
