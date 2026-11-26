/** Indexes a `.sql` DDL dump into the schema knowledge base. */
import { readFileSync } from "node:fs";
import { ingestProduct, positionalArgs, requiredCollection } from "./product";
import {
  parseSQLToSchema,
  relationshipToDocuments,
  schemaToDocuments,
} from "./parsers/sql-schema";
import { store } from "./store";

const file = positionalArgs()[0];
if (!file) {
  throw new Error(
    "Usage: bun run agents/ingest/ddl.ts [--product <slug> | --profile <.sa/product.json>] <path-to-schema.sql>",
  );
}
const product = await ingestProduct();
const ddlStore = requiredCollection(product, "ddlCollection");
console.log(`product ${product.slug} → ${ddlStore.collectionName}`);

const schemas = parseSQLToSchema(readFileSync(file, "utf-8"));
console.log(`parsed ${schemas.length} tables`);

const docs = [
  ...schemaToDocuments(schemas),
  ...relationshipToDocuments(schemas),
];

const stored = await store(ddlStore, docs);
console.log(`indexed ${stored} documents`);
