import { backendEnvLoaded } from "../load-env";
import { serveCatalog } from "./runtime";

void backendEnvLoaded;

serveCatalog({ name: "jira-server", surface: "mcp-jira" }).catch((err) => {
  console.error(err);
  process.exit(1);
});
