import { createHash } from "node:crypto";
import { Pool, type PoolConfig, type QueryResultRow } from "pg";
import { parseIntoClientConfig } from "pg-connection-string";
import { config, validatePostgresUrl } from "../config";
import type { PostgresConnection } from "../contract/connection";
import {
  pinOutbound,
  resolveConnection,
  type ConnectionOrigin,
  type PinnedHost,
} from "../internal/product/connections";
import { currentProduct } from "../internal/product/runtime";
import type { ResolvedProduct } from "../internal/product/types";

const PRODUCT_POOL_MAX = 3;
const IDLE_CLOSE_MS = 10 * 60 * 1000;

type PoolEntry = {
  pool: Pool;
  productId: string;
  lastUsed: number;
  /** Default's pool is the one the whole install shares; it is never idle-closed. */
  keep: boolean;
};

/**
 * Keyed by a SHA-256 of the connection string plus the pinned address, never
 * the string itself, so a heap dump or debug log of the map holds no secret.
 */
const pools = new Map<string, PoolEntry>();
let sweeper: ReturnType<typeof setInterval> | undefined;

function poolKey(url: string, pin?: PinnedHost): string {
  return createHash("sha256")
    .update(url)
    .update("\0")
    .update(pin?.address ?? "")
    .digest("hex");
}

function sweepIdle(now = Date.now()): void {
  for (const [key, entry] of pools) {
    if (entry.keep || now - entry.lastUsed < IDLE_CLOSE_MS) continue;
    pools.delete(key);
    void entry.pool.end().catch(() => {});
  }
}

function ensureSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => sweepIdle(), 60_000);
  sweeper.unref?.();
}

/**
 * Connect to the address `pinOutbound` checked, not the name: letting the
 * driver resolve again is open to DNS rebinding. TLS still verifies the name.
 */
function pinnedConfig(url: string, pin: PinnedHost): PoolConfig {
  const parsed = parseIntoClientConfig(url) as PoolConfig;
  const ssl = parsed.ssl;
  return {
    ...parsed,
    host: pin.address,
    ...(ssl
      ? { ssl: { ...(typeof ssl === "object" ? ssl : {}), servername: pin.hostname } }
      : {}),
  };
}

export function poolFor(
  conn: PostgresConnection,
  opts: { productId: string; pin?: PinnedHost; keep?: boolean },
): Pool {
  const key = poolKey(conn.url, opts.pin);
  const existing = pools.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.pool;
  }

  const base: PoolConfig = opts.pin
    ? pinnedConfig(conn.url, opts.pin)
    : { connectionString: conn.url };
  const pool = new Pool({
    ...base,
    max: opts.keep ? 5 : PRODUCT_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: config.postgres.connectionTimeoutMs,
    statement_timeout: config.postgres.statementTimeoutMs,
  });
  pool.on("error", () => {});
  pools.set(key, {
    pool,
    productId: opts.productId,
    lastUsed: Date.now(),
    keep: opts.keep ?? false,
  });
  ensureSweeper();
  return pool;
}

function validated(
  product: ResolvedProduct,
  source: ConnectionOrigin,
  conn: PostgresConnection,
): string {
  if (source === "default") return config.postgres.url;
  const name = source === "env" ? (product.db.urlEnv ?? "The product database URL") : "The database connection";
  return validatePostgresUrl(conn.url, name);
}

function notConnected(product: ResolvedProduct): Error {
  if (product.isDefault) return new Error("Missing required env: DATABASE_URL");
  return new Error(`Product "${product.name}" has no database connected.`);
}

/** The active product's pool and schema, resolved per call. */
export async function currentDatabase(): Promise<{ pool: Pool; schema: string }> {
  const product = currentProduct();
  const resolved = resolveConnection(product, "postgres");
  if (!resolved) throw notConnected(product);

  const url = validated(product, resolved.source, resolved.connection);
  const conn = { ...resolved.connection, url };
  const pin =
    resolved.source === "browser" ? await pinOutbound(url, "postgres") : undefined;
  return {
    pool: poolFor(conn, {
      productId: product.id,
      pin,
      keep: resolved.source === "default",
    }),
    schema: resolved.connection.schema || product.db.schema,
  };
}

/** Schema name for the active product, without opening a connection. */
export function currentSchema(): string {
  const product = currentProduct();
  return resolveConnection(product, "postgres")?.connection.schema || product.db.schema;
}

export type QueryResult<T extends QueryResultRow = QueryResultRow> = {
  rows: T[];
  rowCount: number;
};

/**
 * Runs `sql` inside a read-only transaction. Schema inspection and SELECT
 * sampling go through here so a mis-bound tool cannot mutate by accident.
 */
export async function readOnlyQuery<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { rows } = await runQuery<T>(sql, params, { readOnly: true });
  return rows;
}

/**
 * Runs `sql` in a read/write transaction and commits on success.
 * Agent-facing DML (`INSERT` / `UPDATE` / `DELETE`) must go through the
 * human-gated `run_sql` tool — do not call this from ungated paths.
 */
export async function writeQuery<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return runQuery<T>(sql, params, { readOnly: false });
}

async function runQuery<T extends QueryResultRow>(
  sql: string,
  params: unknown[],
  opts: { readOnly: boolean },
): Promise<QueryResult<T>> {
  const { pool } = await currentDatabase();
  const client = await pool.connect();
  try {
    await client.query(
      opts.readOnly ? "BEGIN TRANSACTION READ ONLY" : "BEGIN",
    );
    const result = await client.query<T>(sql, params);
    if (opts.readOnly) {
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
    }
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function openPoolCount(): number {
  return pools.size;
}

/** On product delete: its credentials must not stay connected. */
export async function closeProductPools(productId: string): Promise<void> {
  const closing: Promise<void>[] = [];
  for (const [key, entry] of pools) {
    if (entry.productId !== productId) continue;
    pools.delete(key);
    closing.push(entry.pool.end().catch(() => {}));
  }
  await Promise.all(closing);
}

export async function closePostgres(): Promise<void> {
  const all = [...pools.values()];
  pools.clear();
  if (sweeper) {
    clearInterval(sweeper);
    sweeper = undefined;
  }
  await Promise.all(all.map((entry) => entry.pool.end().catch(() => {})));
}
