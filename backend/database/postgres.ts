import { Pool, type QueryResultRow } from "pg";
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
  const client = await getPool().connect();
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

export async function closePostgres(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
