import { config } from "../../../config";
import { readOnlyQuery } from "../../../database/postgres";
import { orToolError } from "../errors";

const SCHEMA = config.postgres.schema;
const DATABASE = "The live application database";

function asBlock(title: string, lines: string[]): string {
  if (lines.length === 0) return `${title}\n(none)`;
  return `${title}\n${lines.join("\n")}`;
}

export async function listTables(): Promise<string> {
  return orToolError(DATABASE, async () => {
    const rows = await readOnlyQuery<{
      table_name: string;
      comment: string | null;
      columns: number;
      estimated_rows: number;
    }>(
      `SELECT c.relname                              AS table_name,
              obj_description(c.oid, 'pg_class')     AS comment,
              count(a.attname)::int                  AS columns,
              GREATEST(c.reltuples, 0)::bigint::int  AS estimated_rows
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attribute a
                ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'v', 'm', 'p')
        GROUP BY c.oid, c.relname, c.reltuples
        ORDER BY c.relname`,
      [SCHEMA],
    );

    return asBlock(
      `Tables in schema "${SCHEMA}" (${rows.length}):`,
      rows.map(
        (r) =>
          `- ${r.table_name} — ${r.columns} columns, ~${r.estimated_rows} rows` +
          (r.comment ? ` — ${r.comment}` : ""),
      ),
    );
  });
}

export async function describeTables(tables: string[]): Promise<string> {
  return orToolError(DATABASE, async () => {
    const rows = await readOnlyQuery<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
      is_primary_key: boolean;
      comment: string | null;
    }>(
      `SELECT c.table_name,
              c.column_name,
              c.data_type,
              c.is_nullable,
              c.column_default,
              COALESCE(pk.is_primary_key, false) AS is_primary_key,
              col_description(format('%I.%I', c.table_schema, c.table_name)::regclass,
                              c.ordinal_position) AS comment
         FROM information_schema.columns c
         LEFT JOIN (
              SELECT kcu.table_name, kcu.column_name, true AS is_primary_key
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON kcu.constraint_name = tc.constraint_name
                 AND kcu.table_schema = tc.table_schema
               WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1
         ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name
        WHERE c.table_schema = $1 AND c.table_name = ANY($2::text[])
        ORDER BY c.table_name, c.ordinal_position`,
      [SCHEMA, tables],
    );

    if (rows.length === 0) {
      return `No columns found for: ${tables.join(", ")}. Call list_tables to see valid names.`;
    }

    const byTable = new Map<string, string[]>();
    for (const r of rows) {
      const flags = [
        r.is_primary_key ? "PK" : null,
        r.is_nullable === "NO" ? "NOT NULL" : null,
        r.column_default ? `DEFAULT ${r.column_default}` : null,
      ].filter(Boolean);

      const line =
        `- ${r.column_name} ${r.data_type}` +
        (flags.length ? ` [${flags.join(", ")}]` : "") +
        (r.comment ? ` — ${r.comment}` : "");

      byTable.set(r.table_name, [...(byTable.get(r.table_name) ?? []), line]);
    }

    return [...byTable]
      .map(([table, lines]) => asBlock(`Table: ${table}`, lines))
      .join("\n\n");
  });
}

export async function inspectRelationships(
  tables?: string[],
): Promise<string> {
  return orToolError(DATABASE, async () => {
    const rows = await readOnlyQuery<{
      constraint_name: string;
      source_table: string;
      source_column: string;
      target_table: string;
      target_column: string;
      delete_rule: string;
    }>(
      `SELECT tc.constraint_name,
              tc.table_name    AS source_table,
              kcu.column_name  AS source_column,
              ccu.table_name   AS target_table,
              ccu.column_name  AS target_column,
              rc.delete_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = $1
          AND ($2::text[] IS NULL
               OR tc.table_name = ANY($2::text[])
               OR ccu.table_name = ANY($2::text[]))
        ORDER BY tc.table_name, kcu.column_name`,
      [SCHEMA, tables ?? null],
    );

    return asBlock(
      "Foreign key relationships:",
      rows.map(
        (r) =>
          `- ${r.source_table}.${r.source_column} -> ${r.target_table}.${r.target_column} ` +
          `(ON DELETE ${r.delete_rule})`,
      ),
    );
  });
}

export async function runSql(sql: string): Promise<string> {
  return orToolError(DATABASE, async () => {
    if (!/^\s*(select|with)\b/i.test(sql)) {
      return "Rejected: only SELECT and WITH statements are allowed.";
    }

    const rows = await readOnlyQuery(sql);
    if (rows.length === 0) return "0 rows.";

    const capped = rows.slice(0, config.postgres.maxRows);
    const truncated =
      rows.length > capped.length
        ? `\n(showing ${capped.length} of ${rows.length} rows)`
        : "";

    return `${JSON.stringify(capped, null, 2)}${truncated}`;
  });
}
