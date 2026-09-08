import { ddlStore } from "../../../database/chroma";
import { orToolError } from "../errors";
import {
  formatPage,
  formatSearchHits,
  mintlifyPage,
  mintlifySearch,
} from "./mintlify";

const DOCS = "Mintlify documentation";
const SCHEMA_DOCS = "The indexed schema documentation";

function join(docs: { pageContent: string }[]): string {
  if (docs.length === 0) return "No matching documents.";
  return docs.map((d) => d.pageContent).join("\n\n---\n\n");
}

export async function searchDocs(
  query: string,
  pageSize = 5,
): Promise<string> {
  return orToolError(DOCS, async () => {
    const size = Math.min(10, Math.max(1, pageSize));
    return formatSearchHits(await mintlifySearch(query, size));
  });
}

export async function getDocPage(paths: string[]): Promise<string> {
  return orToolError(DOCS, async () => {
    const unique = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
    if (unique.length === 0) {
      return "get_doc_page requires at least one documentation path from search_docs.";
    }
    const selected = unique.slice(0, 3);
    const pages = await Promise.all(selected.map((path) => mintlifyPage(path)));
    return pages.map(formatPage).join("\n\n---\n\n");
  });
}

export async function searchSchemaDocs(
  query: string,
  limit = 5,
): Promise<string> {
  return orToolError(SCHEMA_DOCS, async () =>
    join(await ddlStore.similaritySearch(query, limit)),
  );
}
