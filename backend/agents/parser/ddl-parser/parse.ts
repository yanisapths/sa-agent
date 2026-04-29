import { readFileSync } from "fs";
import { ddlStore } from "../../../database/chromadb.ts";
import { buildRelationshipDocs } from "./buildRelationshipDocs.ts";
import { schemaToDocuments } from "./schemaToDocs.ts";
import { parseSQLToSchema } from "./sqlToSchema.ts";

const sql = readFileSync("./schema.sql", "utf-8");

// 1. Parse
const schemas = parseSQLToSchema(sql);
console.log(`✅ Parsed ${schemas.length} tables`);

// 2. Convert to embedding docs
const schemaDocs = schemaToDocuments(schemas);
const relationDocs = buildRelationshipDocs(schemas);

console.log(`📄 Schema docs: ${schemaDocs.length}`);
console.log(`🔗 Relationship docs: ${relationDocs.length}`);

// 3. Sanitize
function sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (Array.isArray(value)) {
      cleaned[key] = value.length > 0 ? value.join(",") : "none";
    } else if (value === "" || value === null || value === undefined) {
      cleaned[key] = "none";
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

const allDocs = [...schemaDocs, ...relationDocs].map((doc) => ({
  ...doc,
  metadata: sanitizeMetadata(doc.metadata),
}));

// 4. Store
await ddlStore.addDocuments(allDocs);
console.log(`🎉 Stored ${allDocs.length} docs in ddl collection`);
