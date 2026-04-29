import { vectorStore } from "../rag/chromadb.ts";
import { buildRelationshipDocs } from "./buildRelationshipDocs.ts";
import { schemaToDocuments } from "./schemaToDocs.ts";
import { parseSQLToSchema } from "./sqlToSchema.ts";

const sql = "...";

// 1. Parse
const schemas = parseSQLToSchema(sql);

// 2. Convert to embedding docs
const schemaDocs = schemaToDocuments(schemas);
const relationDocs = buildRelationshipDocs(schemas);

// 3. Store in vector DB
await vectorStore.addDocuments([...schemaDocs, ...relationDocs]);
