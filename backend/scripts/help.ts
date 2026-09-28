import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderHelp } from "./commands";

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  process.stdout.write(renderHelp());
}
