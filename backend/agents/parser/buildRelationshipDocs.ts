import { Document } from "@langchain/core/documents";
import type { TableSchema } from "./sqlToSchema.ts";

export function buildRelationshipDocs(schemas: TableSchema[]) {
  const docs: Document[] = [];

  for (const table of schemas) {
    for (const fk of table.foreignKeys) {
      docs.push(
        new Document({
          pageContent: `
  Relationship:
  - ${table.table} (many) → ${fk.references.table} (one)
  - Join: ${table.table}.${fk.column} = ${fk.references.table}.${fk.references.column}
            `.trim(),
          metadata: {
            type: "relationship",
          },
        }),
      );
    }
  }

  return docs;
}
