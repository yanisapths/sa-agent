import { Document } from "@langchain/core/documents";
import { parse } from "pgsql-ast-parser";
import type { DataTypeDef, Statement } from "pgsql-ast-parser";

export interface Column {
  name: string;
  type: string;
  nullable?: boolean;
  primary?: boolean;
  unique?: boolean;
  default?: string | null;
  references?: {
    table: string;
    column: string;
  };
}

export interface TableSchema {
  table: string;
  columns: Column[];
  primaryKeys: string[];
  foreignKeys: {
    column: string;
    references: { table: string; column: string };
  }[];
}

function dataTypeToString(dt: DataTypeDef): string {
  if (dt.kind === "array") {
    return `${dataTypeToString(dt.arrayOf)}[]`;
  }
  return dt.name;
}

export function parseSQLToSchema(sql: string): TableSchema[] {
  const normalized = sql
    .replace(/public\./g, "")
    .replace(/serial4/g, "int")
    .replace(/serial8/g, "bigint")
    .replace(/timestamptz/g, "timestamp")
    .replace(/_text/g, "text") // ✅ was text[]
    .replace(/ARRAY\[\]::text\[\]/g, "''")
    .replace(/ARRAY\[\]::[a-z]+\[\]/g, "''")
    .replace(/::[a-z ]+(\[\])?/g, "") // ✅ strip all PG casts
    .replace(/DEFAULT '\{\}'/g, "DEFAULT ''");

  const statements: Statement[] = parse(normalized);
  const tables: TableSchema[] = [];

  for (const stmt of statements) {
    if (stmt.type !== "create table") continue;

    const tableName = stmt.name.name;
    const schema: TableSchema = {
      table: tableName,
      columns: [],
      primaryKeys: [],
      foreignKeys: [],
    };

    for (const col of stmt.columns ?? []) {
      if (col.kind === "column") {
        const column: Column = {
          name: col.name.name,
          type: dataTypeToString(col.dataType),
          nullable: !col.constraints?.some((c) => c.type === "not null"),
        };

        for (const constraint of col.constraints ?? []) {
          if (constraint.type === "primary key") {
            column.primary = true;
            schema.primaryKeys.push(column.name);
          }
          if (constraint.type === "unique") {
            column.unique = true;
          }
          if (constraint.type === "reference") {
            column.references = {
              table: constraint.foreignTable.name,
              column: constraint.foreignColumns?.[0]?.name ?? "id",
            };
          }
        }

        schema.columns.push(column);
      }
    }

    for (const col of stmt.constraints ?? []) {
      if (col.type === "primary key") {
        for (const c of col.columns ?? []) {
          schema.primaryKeys.push(c.name);
        }
      }

      if (col.type === "foreign key") {
        const fkCol = col.localColumns?.[0]?.name;
        const refTable = col.foreignTable?.name;
        const refCol = col.foreignColumns?.[0]?.name;

        if (fkCol && refTable && refCol) {
          schema.foreignKeys.push({
            column: fkCol,
            references: { table: refTable, column: refCol },
          });

          const colDef = schema.columns.find((c) => c.name === fkCol);
          if (colDef) colDef.references = { table: refTable, column: refCol };
        }
      }
    }

    tables.push(schema);
  }

  return tables;
}

/** One document per table: columns, constraints, and outbound references. */
export function schemaToDocuments(schemas: TableSchema[]): Document[] {
  return schemas.map((table) => {
    const lines = [`Table: ${table.table}`, "Columns:"];

    for (const col of table.columns) {
      const flags = [
        col.primary ? "PK" : null,
        col.unique ? "UNIQUE" : null,
        col.nullable === false ? "NOT NULL" : null,
      ].filter(Boolean);

      lines.push(
        `- ${col.name} (${col.type})` +
          (flags.length ? ` [${flags.join(", ")}]` : "") +
          (col.references
            ? ` -> references ${col.references.table}.${col.references.column}`
            : ""),
      );
    }

    return new Document({
      pageContent: lines.join("\n"),
      metadata: { type: "schema", table: table.table },
    });
  });
}

/** One document per table that has foreign keys, describing its joins. */
export function relationshipToDocuments(schemas: TableSchema[]): Document[] {
  return schemas
    .filter((table) => table.foreignKeys.length > 0)
    .map(
      (table) =>
        new Document({
          pageContent: [
            `Relationships for table: ${table.table}`,
            ...table.foreignKeys.map(
              (fk) =>
                `- ${table.table}.${fk.column} -> ${fk.references.table}.${fk.references.column}`,
            ),
          ].join("\n"),
          metadata: {
            type: "relationship",
            table: table.table,
            related_tables: table.foreignKeys
              .map((fk) => fk.references.table)
              .join(","),
          },
        }),
    );
}
