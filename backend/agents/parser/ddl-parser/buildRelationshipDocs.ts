import { Document } from "@langchain/core/documents";
import type { TableSchema } from "./sqlToSchema";

export function buildRelationshipDocs(schemas: TableSchema[]): Document[] {
  const docs: Document[] = [];

  for (const table of schemas) {
    if (table.foreignKeys.length === 0) continue;

    const lines: string[] = [];
    lines.push(`Relationships for table: ${table.table}`);

    for (const fk of table.foreignKeys) {
      lines.push(
        `- ${table.table}.${fk.column} → ${fk.references.table}.${fk.references.column}`,
      );
    }

    docs.push(
      new Document({
        pageContent: lines.join("\n"),
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

  return docs;
}
