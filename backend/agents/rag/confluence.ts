import { ConfluencePagesLoader } from "@langchain/community/document_loaders/web/confluence";
import { parseConfluenceToDocuments } from "../parser/confluence-parser";

const username = process.env.CONFLUENCE_USERNAME;
const accessToken = process.env.CONFLUENCE_ACCESS_TOKEN;
const personalAccessToken = process.env.CONFLUENCE_PAT;

function createLoader() {
  if (username && accessToken) {
    return new ConfluencePagesLoader({
      baseUrl: process.env.CONFLUENCE_BASE_URL!,
      spaceKey: process.env.CONFLUENCE_SPACE_KEY!,
      username,
      accessToken,
    });
  } else if (personalAccessToken) {
    return new ConfluencePagesLoader({
      baseUrl: process.env.CONFLUENCE_BASE_URL!,
      spaceKey: process.env.CONFLUENCE_SPACE_KEY!,
      personalAccessToken,
    });
  } else {
    console.log(
      "You need either a username and access token, or a personal access token (PAT), to use this example.",
    );
  }
}

async function main() {
  const loader = createLoader();
  if (!loader) {
    return null;
  } else {
    const documents = await loader.load();
    console.log(`✅ Loaded ${documents.length} documents\n`);
    for (const [index, doc] of documents.entries()) {
      console.log(`\n${"=".repeat(80)}`);
      console.log(
        `📄 Document #${index + 1} — ${doc.metadata.title ?? "untitled"}`,
      );
      console.log(`${"=".repeat(80)}`);
      // ── PARSED ────────────────────────────────────────────────────────────────
      const parsed = parseConfluenceToDocuments(doc);
      parsed.forEach((p, i) => {
        console.log(`\n  [${i + 1}] type=${p.metadata.type}`);
        console.log(`  ${"-".repeat(60)}`);
        console.log(p.pageContent);
      });
    }
    return documents;
  }
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
