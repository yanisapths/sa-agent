import { apiSpecStore, ddlStore } from "../../../database/chroma";
import { orToolError } from "../errors";

const KNOWLEDGE_BASE = "The indexed knowledge base";

function join(docs: { pageContent: string }[]): string {
  if (docs.length === 0) return "No matching documents.";
  return docs.map((d) => d.pageContent).join("\n\n---\n\n");
}

export async function searchApiSpecs(
  query: string,
  limit = 5,
): Promise<string> {
  return orToolError(KNOWLEDGE_BASE, async () =>
    join(await apiSpecStore.similaritySearch(query, limit)),
  );
}

export async function searchSchemaDocs(
  query: string,
  limit = 5,
): Promise<string> {
  return orToolError(KNOWLEDGE_BASE, async () =>
    join(await ddlStore.similaritySearch(query, limit)),
  );
}
