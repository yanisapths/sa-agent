/** Deletes every record in a Chroma collection without dropping it. */
import { apiSpecStore, ddlStore } from "../../database/chroma";
import { config } from "../../config";

/** Chroma Cloud rejects Get with limit > 300 on this tenant. */
const PAGE = 250;

const arg = process.argv[2] ?? "api";
const store =
  arg === "api" || arg === config.chroma.apiSpecCollection
    ? apiSpecStore
    : arg === "ddl" || arg === config.chroma.ddlCollection
      ? ddlStore
      : null;

if (!store) {
  throw new Error(
    `Usage: bun run ingest:clear -- [api|ddl]\n` +
      `  api → ${config.chroma.apiSpecCollection}\n` +
      `  ddl → ${config.chroma.ddlCollection}`,
  );
}

const collection = await store.ensureCollection();
const name = store.collectionName;
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
