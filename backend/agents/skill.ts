import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "resources/skills",
);

const cache = new Map<string, string>();

export const CHAT_STYLES = ["caveman", "off"] as const;
export type ChatStyle = (typeof CHAT_STYLES)[number];

/** Conversational default. Harness turns still skip injection. */
export const DEFAULT_CHAT_STYLE: ChatStyle = "caveman";

export function isChatStyle(value: string): value is ChatStyle {
  return (CHAT_STYLES as readonly string[]).includes(value);
}

export function parseChatStyle(value: string): ChatStyle | undefined {
  if (value === "off" || value === "normal") return "off";
  if (value === "caveman") return "caveman";
  return undefined;
}

export function skillBody(markdown: string): string {
  return markdown.replace(/^---[\s\S]*?---\s*/, "").trim();
}

/** Markdown body of `resources/skills/<name>/SKILL.md`, without frontmatter. */
export function loadSkillBody(name: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  const file = path.join(SKILLS_ROOT, name, "SKILL.md");
  const body = skillBody(readFileSync(file, "utf8"));
  cache.set(name, body);
  return body;
}
