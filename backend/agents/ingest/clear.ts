/** Deletes every record in a Chroma collection without dropping it. */
import { ingestProduct, positionalArgs } from "./product";
import { collection as chromaCollection } from "../../database/chroma";

/** Chroma Cloud rejects Get with limit > 300 on this tenant. */
const PAGE = 250;

const product = await ingestProduct();
const { apiSpecCollection, ddlCollection } = product.index;
const arg = positionalArgs()[0] ?? "api";
const name =
  arg === "api" || arg === apiSpecCollection
    ? apiSpecCollection
    : arg === "ddl" || arg === ddlCollection
      ? ddlCollection
      : undefined;

if (!name) {
  throw new Error(
    `Usage: bun run ingest:clear -- [--product <slug>] [api|ddl]\n` +
      `  api → ${apiSpecCollection ?? "(not set)"}\n` +
      `  ddl → ${ddlCollection ?? "(not set)"}`,
  );
}
const store = chromaCollection(name);

const collection = await store.ensureCollection();
const before = await collection.count();
console.log(`${name}: ${before} records`);

if (before === 0) {
  console.log("already empty — collection kept");
  process.exit(0);
}

try {
  const { deleted } = await collection.delete({
    whereDocument: { $not_contains: "\u0000" },
  });
  const after = await collection.count();
  if (after === 0) {
    console.log(`deleted ${deleted || before} records; collection kept`);
    process.exit(0);
  }
  console.warn(`filtered delete left ${after} records; falling back to id batches`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`filtered delete not supported (${message}); falling back to id batches`);
}

let remaining = await collection.count();
while (remaining > 0) {
  const { ids } = await collection.get({ limit: PAGE, include: [] });
  if (!ids?.length) break;
  await collection.delete({ ids });
  remaining = await collection.count();
  console.log(`deleted batch of ${ids.length}; ${remaining} left`);
}

const after = await collection.count();
if (after > 0) {
  throw new Error(`${name} still has ${after} records`);
}
console.log(`cleared ${name}; collection kept`);
