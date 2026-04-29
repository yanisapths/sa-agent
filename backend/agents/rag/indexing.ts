import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import "cheerio"; // web scraping library, html transformation
import { vectorStore } from "./chromadb";

function isProbablyHtml(contentType: string | null, url: string): boolean {
  if (contentType?.toLowerCase().includes("text/html")) return true;
  const lower = url.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return true;
  return false;
}

function isProbablyText(contentType: string | null, url: string): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.startsWith("text/")) return true;
  if (ct.includes("application/json")) return true;
  if (ct.includes("application/xml") || ct.includes("text/xml")) return true;
  if (ct.includes("application/x-sql") || ct.includes("text/x-sql"))
    return true;
  const lower = url.toLowerCase();
  if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".csv"))
    return true;
  if (lower.endsWith(".json") || lower.endsWith(".xml")) return true;
  if (lower.endsWith(".sql")) return true;
  return false;
}

async function loadDocsFromUrl(url: string): Promise<Document[]> {
  // HTML pages: let Cheerio fetch + parse
  const head = await fetch(url, { method: "HEAD" }).catch(() => null);
  const contentType = head?.headers?.get("content-type") ?? null;
  if (isProbablyHtml(contentType, url)) {
    const cheerioloader = new CheerioWebBaseLoader(url);
    return await cheerioloader.load();
  }

  // Text-like resources: fetch body and wrap into a Document
  if (isProbablyText(contentType, url)) {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Failed to fetch url (status ${resp.status})`);
    }
    const text = await resp.text();
    return [
      new Document({
        pageContent: text,
        metadata: { source: url },
      }),
    ];
  }

  throw new Error(
    `Unsupported content-type for indexing: ${contentType ?? "unknown"}`,
  );
}

export const indexing = async ({
  path,
}: {
  /** URL to index (html page or direct text file) */
  path: string;
}) => {
  // 1. load
  const docs = await loadDocsFromUrl(path);

  // 2. split
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 2000,
    chunkOverlap: 200,
  });

  const allSplits = await splitter.splitDocuments(docs);
  console.log("Total splits:", allSplits.length);
  console.log("First split length:", allSplits[0]?.pageContent.length);
  for (const doc of allSplits) {
    const chars = doc.pageContent.length;
    const tokens = chars / 4;

    console.log(`Embedding chunk ~${Math.round(tokens)} tokens`);
  }
  const totalChars = allSplits.reduce(
    (sum, doc) => sum + doc.pageContent.length,
    0,
  );

  const estimatedTokens = Math.round(totalChars / 4);
  const estimatedCost = (estimatedTokens / 1000) * 0.0001; // adjust pricing

  console.log({
    splits: allSplits.length,
    estimatedTokens,
    estimatedCostUSD: estimatedCost.toFixed(6),
  });
  // 3. embedding and store
  try {
    await vectorStore.addDocuments(allSplits);
    console.log("✅ Documents sent to vector store");
  } catch (err) {
    console.error("❌ addDocuments failed:", err);
  }

  return { splits: allSplits.length };
};
