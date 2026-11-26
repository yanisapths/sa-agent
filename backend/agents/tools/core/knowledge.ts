import { storesFor } from "../../../database/chroma";
import { currentProduct } from "../../../internal/product/runtime";
import { docsProviderFor } from "../../docs";
import { orToolError } from "../errors";

const DOCS = "This product's documentation";
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
    return docsProviderFor(currentProduct()).search(query, size);
  });
}

export async function getDocPage(paths: string[]): Promise<string> {
  return orToolError(DOCS, async () => {
    const unique = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
    if (unique.length === 0) {
      return "get_doc_page requires at least one page id or URL from search_docs.";
    }
    return docsProviderFor(currentProduct()).fetch(unique.slice(0, 8));
  });
}

export async function searchSchemaDocs(
  query: string,
  limit = 5,
): Promise<string> {
  return orToolError(SCHEMA_DOCS, async () => {
    const product = currentProduct();
    const { ddl } = storesFor(product.index);
    if (!ddl) return `Product "${product.name}" has no schema index configured.`;
    return join(await ddl.similaritySearch(query, limit));
  });
}
