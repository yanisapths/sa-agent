import { Pool } from "pg";
import { config } from "../config";

let pool: Pool | undefined;

function getPool(): Pool {
  pool ??= new Pool({
    connectionString: config.postgres.url,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: config.postgres.connectionTimeoutMs,
    statement_timeout: config.postgres.statementTimeoutMs,
  });
  return pool;
}

/**
 * Runs `sql` inside a read-only transaction. Every agent-facing database call
 * goes through here, so no tool can mutate the application database.
 */
export async function readOnlyQuery<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const result = await client.query<T>(sql, params);
    return result.rows;
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

export async function closePostgres(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
