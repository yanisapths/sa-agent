/** Indexes a `.sql` DDL dump into the schema knowledge base. */
import { readFileSync } from "node:fs";
import { ddlStore } from "../../database/chroma";
import {
  parseSQLToSchema,
  relationshipToDocuments,
  schemaToDocuments,
} from "./parsers/sql-schema";
import { store } from "./store";

const file = process.argv[2];
if (!file) {
  throw new Error("Usage: bun run agents/ingest/ddl.ts <path-to-schema.sql>");
}

const schemas = parseSQLToSchema(readFileSync(file, "utf-8"));
console.log(`parsed ${schemas.length} tables`);

const docs = [
  ...schemaToDocuments(schemas),
  ...relationshipToDocuments(schemas),
];

const stored = await store(ddlStore, docs);
console.log(`indexed ${stored} documents`);
