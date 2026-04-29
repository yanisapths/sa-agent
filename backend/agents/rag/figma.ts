import { FigmaFileLoader } from "@langchain/community/document_loaders/web/figma";

const loader = new FigmaFileLoader({
  accessToken: process.env.FIGMA_ACCESS_TOKEN,
  nodeIds: ["0-1"],
  fileKey: process.env.FIGMA_FILE_KEY!,
});
const docs = await loader.load();

console.log({ docs });
