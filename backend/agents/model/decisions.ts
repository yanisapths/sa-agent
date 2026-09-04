/**
 * Engineering memory: the "why" the graph cannot derive.
 *
 * A decision lives as markdown in `.sa/decisions/` so it reviews in a pull
 * request, survives a rebuild, and is readable without any tooling. SQLite
 * only holds an index of it, plus `decides` edges into the graph so that a
 * decision shows up in the blast radius of the thing it constrains.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import {
  decisionsPath,
  DECISIONS_DIR,
  MODEL_DIR,
  putDecision,
  putEdge,
  putNode,
  resolveNodes,
  type ModelStore,
} from "./store";
import type { DecisionRecord } from "./types";

export function decisionId(id: string): string {
  return `decision:${id}`;
}

const SECTIONS = [
  ["context", "Context"],
  ["decision", "Decision"],
  ["alternatives", "Alternatives"],
  ["reason", "Reason"],
  ["consequences", "Consequences"],
] as const;

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "decision"
  );
}

/**
 * Frontmatter is deliberately hand-rolled and tiny: five known keys and a
 * list. Pulling in a YAML parser for this would be the only reason the
 * package needs one.
 */
function parseFrontmatter(raw: string): { data: Record<string, string[]>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { data: {}, body: raw };

  const data: Record<string, string[]> = {};
  let currentKey: string | null = null;

  for (const line of match[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && currentKey) {
      data[currentKey] = [...(data[currentKey] ?? []), unquote(item[1])];
      continue;
    }
    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    currentKey = pair[1];
    const value = pair[2].trim();
    data[currentKey] = value ? [unquote(value)] : [];
  }

  return { data, body: match[2] };
}

function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function parseSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const parts = body.split(/^##\s+/m);
  for (const part of parts.slice(1)) {
    const newline = part.indexOf("\n");
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim().toLowerCase();
    const content = (newline === -1 ? "" : part.slice(newline + 1)).trim();
    sections[heading] = content;
  }
  return sections;
}

export function parseDecision(raw: string, path: string): DecisionRecord | null {
  const { data, body } = parseFrontmatter(raw);
  const sections = parseSections(body);
  const id = data.id?.[0] ?? posix.basename(path).replace(/\.md$/, "").split("-")[0];
  const title = data.title?.[0] ?? sections.decision?.split("\n")[0] ?? "";
  if (!id || !title) return null;

  const record: DecisionRecord = {
    id,
    title,
    context: "",
    decision: "",
    alternatives: "",
    reason: "",
    consequences: "",
    decidedOn: data.date?.[0] ?? "",
    path,
    related: data.related ?? [],
  };

  for (const [key, heading] of SECTIONS) {
    record[key] = sections[heading.toLowerCase()] ?? "";
  }

  return record;
}

export function renderDecision(record: DecisionRecord): string {
  const related = record.related.length
    ? `related:\n${record.related.map((r) => `  - ${JSON.stringify(r)}`).join("\n")}\n`
    : "related: []\n";

  const sections = SECTIONS.map(
    ([key, heading]) => `## ${heading}\n\n${record[key].trim() || "_Not recorded._"}\n`,
  ).join("\n");

  return (
    `---\n` +
    `id: ${record.id}\n` +
    `title: ${JSON.stringify(record.title)}\n` +
    `date: ${record.decidedOn}\n` +
    related +
    `---\n\n` +
    `# ${record.title}\n\n` +
    sections
  );
}

export function loadDecisions(root: string): DecisionRecord[] {
  const dir = decisionsPath(root);
  if (!existsSync(dir)) return [];

  const records: DecisionRecord[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".md")) continue;
    const rel = posix.join(MODEL_DIR, DECISIONS_DIR, name);
    const parsed = parseDecision(readFileSync(join(dir, name), "utf-8"), rel);
    if (parsed) records.push(parsed);
  }
  return records;
}

function nextId(root: string): string {
  const existing = loadDecisions(root)
    .map((d) => Number.parseInt(d.id, 10))
    .filter((n) => Number.isFinite(n));
  const next = (existing.length ? Math.max(...existing) : 0) + 1;
  return String(next).padStart(4, "0");
}

/**
 * Index every decision and wire it into the graph.
 *
 * A `related` entry that resolves to nothing is not dropped silently — it is
 * returned as an unresolved ref so the human can fix the record instead of
 * believing the link exists.
 */
export function indexDecisions(
  store: ModelStore,
  records: DecisionRecord[],
): { linked: number; unresolved: { id: string; ref: string }[] } {
  const unresolved: { id: string; ref: string }[] = [];
  let linked = 0;

  store.db.run("DELETE FROM edges WHERE kind = 'decides'");
  store.db.run("DELETE FROM nodes WHERE kind = 'decision'");
  store.db.run("DELETE FROM decisions");

  for (const record of records) {
    putDecision(store, record);
    putNode(store, {
      id: decisionId(record.id),
      kind: "decision",
      name: record.title,
      file: record.path,
      line: null,
      source: "manual",
      meta: { decidedOn: record.decidedOn, decisionId: record.id },
    });

    for (const ref of record.related) {
      const targets = resolveNodes(store, ref, 4);
      if (targets.length === 0) {
        unresolved.push({ id: record.id, ref });
        continue;
      }
      for (const target of targets) {
        // The decision is about that node: it must be revisited when the node
        // changes, which is exactly the dependent -> dependency direction.
        putEdge(store, {
          from: decisionId(record.id),
          to: target.id,
          kind: "decides",
          file: record.path,
          line: null,
          source: "manual",
        });
        linked++;
      }
    }
  }

  return { linked, unresolved };
}

export interface NewDecision {
  title: string;
  context: string;
  decision: string;
  alternatives?: string;
  reason: string;
  consequences?: string;
  related?: string[];
  decidedOn?: string;
}

export function writeDecision(root: string, input: NewDecision): DecisionRecord {
  const dir = decisionsPath(root);
  mkdirSync(dir, { recursive: true });

  const id = nextId(root);
  const filename = `${id}-${slugify(input.title)}.md`;
  const record: DecisionRecord = {
    id,
    title: input.title,
    context: input.context,
    decision: input.decision,
    alternatives: input.alternatives ?? "",
    reason: input.reason,
    consequences: input.consequences ?? "",
    decidedOn: input.decidedOn || new Date().toISOString().slice(0, 10),
    path: posix.join(MODEL_DIR, DECISIONS_DIR, filename),
    related: input.related ?? [],
  };

  writeFileSync(join(dir, filename), renderDecision(record), "utf-8");
  return record;
}

interface DecisionRow extends Record<string, unknown> {
  id: string;
  title: string;
  context: string;
  decision: string;
  alternatives: string;
  reason: string;
  consequences: string;
  decided_on: string;
  path: string;
  related: string;
}

function toRecord(row: DecisionRow): DecisionRecord {
  let related: string[] = [];
  try {
    related = JSON.parse(row.related) as string[];
  } catch {
    related = [];
  }
  return {
    id: row.id,
    title: row.title,
    context: row.context,
    decision: row.decision,
    alternatives: row.alternatives,
    reason: row.reason,
    consequences: row.consequences,
    decidedOn: row.decided_on,
    path: row.path,
    related,
  };
}

export function allDecisions(store: ModelStore): DecisionRecord[] {
  return store.db
    .prepare<DecisionRow, []>(`SELECT * FROM decisions ORDER BY id DESC`)
    .all()
    .map(toRecord);
}

export function decisionsFor(store: ModelStore, nodeIds: string[]): DecisionRecord[] {
  if (nodeIds.length === 0) return [];
  const marks = nodeIds.map(() => "?").join(",");
  return store.db
    .prepare<DecisionRow, string[]>(
      `SELECT DISTINCT d.* FROM decisions d
         JOIN edges e ON e.from_id = 'decision:' || d.id
        WHERE e.kind = 'decides' AND e.to_id IN (${marks})
        ORDER BY d.id DESC`,
    )
    .all(...nodeIds)
    .map(toRecord);
}

/**
 * Ranked keyword search. Every term must appear somewhere in the record, and
 * a hit in the title or the reason outranks one buried in the context — those
 * are the fields someone asking "why is this like this" actually wants.
 */
export function searchDecisions(
  store: ModelStore,
  query: string,
  limit = 5,
): { record: DecisionRecord; score: number }[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 2);
  if (terms.length === 0) return allDecisions(store).slice(0, limit).map((record) => ({ record, score: 0 }));

  const weights: [keyof DecisionRecord, number][] = [
    ["title", 5],
    ["reason", 4],
    ["decision", 3],
    ["consequences", 2],
    ["alternatives", 2],
    ["context", 1],
  ];

  const scored = allDecisions(store)
    .map((record) => {
      let score = 0;
      let matchedAll = true;
      for (const term of terms) {
        let hit = 0;
        for (const [field, weight] of weights) {
          if (String(record[field]).toLowerCase().includes(term)) hit += weight;
        }
        if (record.related.some((r) => r.toLowerCase().includes(term))) hit += 4;
        if (hit === 0) matchedAll = false;
        score += hit;
      }
      return { record, score: matchedAll ? score : score / 4 };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}
