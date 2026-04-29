import { Document } from "@langchain/core/documents";
import type { TableSchema } from "./sqlToSchema.ts";

export function schemaToDocuments(schemas: TableSchema[]): Document[] {
  const docs: Document[] = [];

  for (const table of schemas) {
    const lines: string[] = [];

    lines.push(`Table: ${table.table}`);

    lines.push(`Columns:`);
    for (const col of table.columns) {
      let line = `- ${col.name} (${col.type})`;

      if (col.primary) line += " [PK]";
      if (col.unique) line += " [UNIQUE]";
      if (col.nullable === false) line += " [NOT NULL]";

      if (col.references) {
        line += ` → references ${col.references.table}.${col.references.column}`;
      }

      lines.push(line);
    }

    if (table.foreignKeys.length > 0) {
      lines.push(`Relationships:`);
      for (const fk of table.foreignKeys) {
        lines.push(
          `- ${table.table}.${fk.column} → ${fk.references.table}.${fk.references.column}`,
        );
      }
    }

    docs.push(
      new Document({
        pageContent: lines.join("\n"),
        metadata: {
          type: "schema",
          table: table.table,
        },
      }),
    );
  }

  return docs;
}
