/**
 * The database half of the system model, read from the live schema.
 *
 * Table and column nodes are marked `source: "database"` so a reader can tell
 * a confirmed table from one that only appears in a SQL string. Code that
 * mentions a table the database does not have is reported as a warning, never
 * promoted into a node — that is the "never invent a table" rule, enforced
 * rather than asked for.
 */
import { config } from "../../config";
import { readOnlyQuery } from "../../database/postgres";
import type { ModelEdge, ModelNode } from "./types";

export function tableId(name: string): string {
  return `table:${name.toLowerCase()}`;
}

export function columnId(table: string, column: string): string {
  return `column:${table.toLowerCase()}.${column.toLowerCase()}`;
}

export interface SchemaResult {
  nodes: ModelNode[];
  edges: ModelEdge[];
  tables: Set<string>;
  warnings: string[];
}

const EMPTY: SchemaResult = { nodes: [], edges: [], tables: new Set(), warnings: [] };

interface ColumnRow extends Record<string, unknown> {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  is_primary_key: boolean;
  comment: string | null;
}

interface FkRow extends Record<string, unknown> {
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
  delete_rule: string;
}

/**
 * Reads tables, columns, and foreign keys. A missing or unreachable database
 * degrades the build to code-only rather than failing it, because a useful
 * partial model beats no model when someone is offline.
 */
export async function scanSchema(): Promise<SchemaResult> {
  const schema = config.postgres.schema;

  let columns: ColumnRow[];
  let fks: FkRow[];

  try {
    columns = await readOnlyQuery<ColumnRow>(
      `SELECT c.table_name,
              c.column_name,
              c.data_type,
              c.is_nullable,
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
        WHERE c.table_schema = $1
        ORDER BY c.table_name, c.ordinal_position`,
      [schema],
    );

    fks = await readOnlyQuery<FkRow>(
      `SELECT tc.table_name   AS source_table,
              kcu.column_name AS source_column,
              ccu.table_name  AS target_table,
              ccu.column_name AS target_column,
              rc.delete_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1`,
      [schema],
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...EMPTY,
      warnings: [
        `live schema unavailable, built a code-only model: ${message}`,
      ],
    };
  }

  const nodes: ModelNode[] = [];
  const edges: ModelEdge[] = [];
  const tables = new Set<string>();

  for (const row of columns) {
    const table = row.table_name.toLowerCase();
    const column = row.column_name.toLowerCase();

    if (!tables.has(table)) {
      tables.add(table);
      nodes.push({
        id: tableId(table),
        kind: "table",
        name: table,
        file: null,
        line: null,
        source: "database",
        meta: { schema },
      });
    }

    nodes.push({
      id: columnId(table, column),
      kind: "column",
      name: `${table}.${column}`,
      file: null,
      line: null,
      source: "database",
      meta: {
        table,
        column,
        type: row.data_type,
        nullable: row.is_nullable === "YES",
        primaryKey: row.is_primary_key,
        comment: row.comment ?? undefined,
      },
    });

    // The table breaks when the column changes, so the table is the dependent.
    edges.push({
      from: tableId(table),
      to: columnId(table, column),
      kind: "has_column",
      file: null,
      line: null,
      source: "database",
    });
  }

  for (const fk of fks) {
    const source = fk.source_table.toLowerCase();
    const target = fk.target_table.toLowerCase();
    if (!tables.has(source) || !tables.has(target) || source === target) continue;

    // The referencing table depends on the referenced one.
    edges.push({
      from: tableId(source),
      to: tableId(target),
      kind: "references",
      file: null,
      line: null,
      source: "database",
    });
    edges.push({
      from: columnId(source, fk.source_column),
      to: columnId(target, fk.target_column),
      kind: "references",
      file: null,
      line: null,
      source: "database",
    });
  }

  return { nodes, edges, tables, warnings: [] };
}
