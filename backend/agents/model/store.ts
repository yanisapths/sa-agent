/// <reference types="bun" />
/**
 * SQLite storage for the system model, in the product repo it describes.
 *
 * `bun:sqlite` ships with the runtime, so this adds no dependency, and the
 * recursive CTE in `reverseReachable` is what makes impact analysis one query
 * instead of a hand-rolled traversal.
 *
 * TypeScript 6 no longer pulls in `@types/*` automatically, hence the explicit
 * reference above — without it `bun:sqlite` has no declaration.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { DecisionRecord, ModelEdge, ModelNode, NodeKind, Source } from "./types";

/** Directory holding the model, relative to the product repo root. */
export const MODEL_DIR = ".sa";
export const MODEL_FILE = "system-model.db";
export const DECISIONS_DIR = "decisions";

/**
 * The MCP servers are spawned with the product repo as cwd, so cwd is the
 * right starting point. Walk up to the enclosing git repo so the model lands
 * at the root no matter which subdirectory a command was run from.
 */
export function productRoot(explicit?: string): string {
  if (explicit) return resolve(explicit);
  if (process.env.SA_PRODUCT_ROOT) return resolve(process.env.SA_PRODUCT_ROOT);

  let dir = process.cwd();
  for (let i = 0; i < 40; i++) {
    if (existsSync(join(dir, ".git")) || existsSync(join(dir, MODEL_DIR))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export function modelPath(root: string): string {
  return join(root, MODEL_DIR, MODEL_FILE);
}

export function decisionsPath(root: string): string {
  return join(root, MODEL_DIR, DECISIONS_DIR);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
  id     TEXT PRIMARY KEY,
  kind   TEXT NOT NULL,
  name   TEXT NOT NULL,
  file   TEXT,
  line   INTEGER,
  source TEXT NOT NULL,
  meta   TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS nodes_kind ON nodes(kind);
CREATE INDEX IF NOT EXISTS nodes_name ON nodes(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS nodes_file ON nodes(file);

CREATE TABLE IF NOT EXISTS edges (
  from_id TEXT NOT NULL,
  to_id   TEXT NOT NULL,
  kind    TEXT NOT NULL,
  file    TEXT,
  line    INTEGER,
  source  TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, kind)
);
CREATE INDEX IF NOT EXISTS edges_from ON edges(from_id);
CREATE INDEX IF NOT EXISTS edges_to   ON edges(to_id);

CREATE TABLE IF NOT EXISTS decisions (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  context      TEXT NOT NULL DEFAULT '',
  decision     TEXT NOT NULL DEFAULT '',
  alternatives TEXT NOT NULL DEFAULT '',
  reason       TEXT NOT NULL DEFAULT '',
  consequences TEXT NOT NULL DEFAULT '',
  decided_on   TEXT NOT NULL DEFAULT '',
  path         TEXT NOT NULL DEFAULT '',
  related      TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS build_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export interface ModelStore {
  db: Database;
  root: string;
  path: string;
  close(): void;
}

export function openModel(root: string, create = false): ModelStore {
  const path = modelPath(root);
  if (!create && !existsSync(path)) {
    throw new Error(
      `No system model at ${MODEL_DIR}/${MODEL_FILE}. Run build_system_model (or \`bun run model:build\`) first.`,
    );
  }
  if (create) mkdirSync(dirname(path), { recursive: true });

  // Bun requires an explicit access mode; `create` alone opens with no flags.
  const db = new Database(path, { readwrite: true, create });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);

  return { db, root, path, close: () => db.close() };
}

/** True when a model exists, without the cost of opening it. */
export function modelExists(root: string): boolean {
  return existsSync(modelPath(root));
}

// --- writing -------------------------------------------------------------

interface NodeRow {
  id: string;
  kind: string;
  name: string;
  file: string | null;
  line: number | null;
  source: string;
  meta: string;
}

function toNode(row: NodeRow): ModelNode {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(row.meta) as Record<string, unknown>;
  } catch {
    meta = {};
  }
  return {
    id: row.id,
    kind: row.kind as NodeKind,
    name: row.name,
    file: row.file,
    line: row.line,
    source: row.source as Source,
    meta,
  };
}

/**
 * Replaces everything derived from a scan or the database in one transaction,
 * so a failed build never leaves a half-written graph behind. Manual nodes
 * (decisions, features) survive — they are not reproducible from source.
 */
export function replaceDerived(
  store: ModelStore,
  nodes: ModelNode[],
  edges: ModelEdge[],
): void {
  const { db } = store;

  const insertNode = db.prepare(
    `INSERT INTO nodes (id, kind, name, file, line, source, meta)
     VALUES ($id, $kind, $name, $file, $line, $source, $meta)
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind, name = excluded.name, file = excluded.file,
       line = excluded.line, source = excluded.source, meta = excluded.meta`,
  );
  const insertEdge = db.prepare(
    `INSERT OR REPLACE INTO edges (from_id, to_id, kind, file, line, source)
     VALUES ($from, $to, $kind, $file, $line, $source)`,
  );

  const known = new Set(nodes.map((n) => n.id));

  db.transaction(() => {
    db.run("DELETE FROM edges WHERE source IN ('scan','database')");
    db.run("DELETE FROM nodes WHERE source IN ('scan','database')");

    for (const node of nodes) {
      insertNode.run({
        $id: node.id,
        $kind: node.kind,
        $name: node.name,
        $file: node.file,
        $line: node.line,
        $source: node.source,
        $meta: JSON.stringify(node.meta ?? {}),
      });
    }

    for (const edge of edges) {
      // A dangling edge would make impact traversal report ids that resolve to
      // nothing, which reads as a bug in the report rather than in the scan.
      if (!known.has(edge.from) || !known.has(edge.to)) continue;
      insertEdge.run({
        $from: edge.from,
        $to: edge.to,
        $kind: edge.kind,
        $file: edge.file,
        $line: edge.line,
        $source: edge.source,
      });
    }

    // Manual `decides` edges can point at code that has since been deleted.
    db.run(
      `DELETE FROM edges
        WHERE source = 'manual'
          AND (from_id NOT IN (SELECT id FROM nodes) OR to_id NOT IN (SELECT id FROM nodes))`,
    );
  })();
}

export function putNode(store: ModelStore, node: ModelNode): void {
  store.db
    .prepare(
      `INSERT INTO nodes (id, kind, name, file, line, source, meta)
       VALUES ($id, $kind, $name, $file, $line, $source, $meta)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind, name = excluded.name, file = excluded.file,
         line = excluded.line, source = excluded.source, meta = excluded.meta`,
    )
    .run({
      $id: node.id,
      $kind: node.kind,
      $name: node.name,
      $file: node.file,
      $line: node.line,
      $source: node.source,
      $meta: JSON.stringify(node.meta ?? {}),
    });
}

export function putEdge(store: ModelStore, edge: ModelEdge): void {
  if (!getNode(store, edge.from) || !getNode(store, edge.to)) return;
  store.db
    .prepare(
      `INSERT OR REPLACE INTO edges (from_id, to_id, kind, file, line, source)
       VALUES ($from, $to, $kind, $file, $line, $source)`,
    )
    .run({
      $from: edge.from,
      $to: edge.to,
      $kind: edge.kind,
      $file: edge.file,
      $line: edge.line,
      $source: edge.source,
    });
}

export function putDecision(store: ModelStore, record: DecisionRecord): void {
  store.db
    .prepare(
      `INSERT INTO decisions
         (id, title, context, decision, alternatives, reason, consequences, decided_on, path, related)
       VALUES ($id, $title, $context, $decision, $alternatives, $reason, $consequences, $on, $path, $related)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, context = excluded.context, decision = excluded.decision,
         alternatives = excluded.alternatives, reason = excluded.reason,
         consequences = excluded.consequences, decided_on = excluded.decided_on,
         path = excluded.path, related = excluded.related`,
    )
    .run({
      $id: record.id,
      $title: record.title,
      $context: record.context,
      $decision: record.decision,
      $alternatives: record.alternatives,
      $reason: record.reason,
      $consequences: record.consequences,
      $on: record.decidedOn,
      $path: record.path,
      $related: JSON.stringify(record.related),
    });
}

export function setBuildMeta(store: ModelStore, key: string, value: string): void {
  store.db
    .prepare(
      `INSERT INTO build_meta (key, value) VALUES ($k, $v)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run({ $k: key, $v: value });
}

export function getBuildMeta(store: ModelStore, key: string): string | null {
  const row = store.db
    .prepare<{ value: string }, [string]>(`SELECT value FROM build_meta WHERE key = ?`)
    .get(key);
  return row?.value ?? null;
}

// --- reading -------------------------------------------------------------

export function getNode(store: ModelStore, id: string): ModelNode | null {
  const row = store.db
    .prepare<NodeRow, [string]>(`SELECT * FROM nodes WHERE id = ?`)
    .get(id);
  return row ? toNode(row) : null;
}

export function getNodes(store: ModelStore, ids: string[]): ModelNode[] {
  if (ids.length === 0) return [];
  const marks = ids.map(() => "?").join(",");
  return store.db
    .prepare<NodeRow, string[]>(`SELECT * FROM nodes WHERE id IN (${marks})`)
    .all(...ids)
    .map(toNode);
}

export function countByKind(store: ModelStore): Record<string, number> {
  const rows = store.db
    .prepare<{ kind: string; n: number }, []>(
      `SELECT kind, count(*) AS n FROM nodes GROUP BY kind ORDER BY kind`,
    )
    .all();
  return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
}

export function countEdges(store: ModelStore): number {
  return (
    store.db
      .prepare<{ n: number }, []>(`SELECT count(*) AS n FROM edges`)
      .get()?.n ?? 0
  );
}

/**
 * Turn whatever the human or the model typed into concrete nodes.
 *
 * Accepts an id, a bare name, `table.column`, `GET /path`, or a file path
 * fragment, in that order of confidence, and only falls back to a substring
 * match when nothing exact hit. Returning several candidates is fine — the
 * caller reports the ambiguity rather than guessing.
 */
export function resolveNodes(store: ModelStore, ref: string, limit = 12): ModelNode[] {
  const q = ref.trim();
  if (!q) return [];
  const { db } = store;
  const all = (sql: string, ...params: (string | number)[]) =>
    db.prepare<NodeRow, (string | number)[]>(sql).all(...params).map(toNode);

  const exactId = getNode(store, q);
  if (exactId) return [exactId];

  // `orders` and `orders.user_id` are the two shapes people type for the DB.
  const dotted = /^([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)$/.exec(q);
  if (dotted) {
    const column = getNode(store, `column:${dotted[1].toLowerCase()}.${dotted[2].toLowerCase()}`);
    if (column) return [column];
  }

  const method = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)$/i.exec(q);
  if (method) {
    const hit = getNode(store, `endpoint:${method[1].toUpperCase()} ${method[2]}`);
    if (hit) return [hit];
  }

  const byName = all(
    `SELECT * FROM nodes WHERE name = ? COLLATE NOCASE ORDER BY kind, name LIMIT ?`,
    q,
    limit,
  );
  if (byName.length > 0) return byName;

  const byFile = all(
    `SELECT * FROM nodes WHERE file = ? OR file LIKE ? ORDER BY length(file) LIMIT ?`,
    q,
    `%/${q}`,
    limit,
  );
  if (byFile.length > 0) return byFile;

  return all(
    `SELECT * FROM nodes
      WHERE name LIKE ? COLLATE NOCASE OR id LIKE ? COLLATE NOCASE OR file LIKE ? COLLATE NOCASE
      ORDER BY length(name), name LIMIT ?`,
    `%${q}%`,
    `%${q}%`,
    `%${q}%`,
    limit,
  );
}

export interface Neighbour {
  node: ModelNode;
  kind: string;
  direction: "out" | "in";
}

/** One hop in both directions: what this depends on, and what depends on it. */
export function neighbours(store: ModelStore, id: string, limit = 40): Neighbour[] {
  const rows = store.db
    .prepare<NodeRow & { edge_kind: string; direction: string }, [string, string, number]>(
      `SELECT n.*, e.kind AS edge_kind, 'out' AS direction
         FROM edges e JOIN nodes n ON n.id = e.to_id
        WHERE e.from_id = ?
       UNION ALL
       SELECT n.*, e.kind AS edge_kind, 'in' AS direction
         FROM edges e JOIN nodes n ON n.id = e.from_id
        WHERE e.to_id = ?
        LIMIT ?`,
    )
    .all(id, id, limit);

  return rows.map((row) => ({
    node: toNode(row),
    kind: row.edge_kind,
    direction: row.direction as "out" | "in",
  }));
}

export interface Reached {
  node: ModelNode;
  depth: number;
  /** The edge kind that pulled this node in, for a legible "why". */
  via: string;
  /** Id of the node one step closer to the target. */
  from: string;
}

/**
 * Everything that (transitively) depends on `id`, i.e. the blast radius.
 *
 * Edges point dependent -> dependency, so this walks them backwards. The
 * `depth` column is what stops a cycle, and the row cap keeps a hub node
 * (a shared util imported everywhere) from returning the whole repo.
 */
export function reverseReachable(
  store: ModelStore,
  id: string,
  maxDepth = 4,
  maxRows = 400,
): Reached[] {
  const rows = store.db
    .prepare<
      NodeRow & { depth: number; via: string; parent: string },
      [string, number, number]
    >(
      `WITH RECURSIVE impact(id, depth, via, parent) AS (
         SELECT ?, 0, '', ''
         UNION
         SELECT e.from_id, i.depth + 1, e.kind, i.id
           FROM edges e
           JOIN impact i ON e.to_id = i.id
          WHERE i.depth < ?
       )
       SELECT n.*, i.depth AS depth, i.via AS via, i.parent AS parent
         FROM impact i
         JOIN nodes n ON n.id = i.id
        WHERE i.depth > 0
        ORDER BY i.depth, n.kind, n.name
        LIMIT ?`,
    )
    .all(id, maxDepth, maxRows);

  // The CTE can reach a node by several routes; keep the shallowest.
  const best = new Map<string, Reached>();
  for (const row of rows) {
    const existing = best.get(row.id);
    if (existing && existing.depth <= row.depth) continue;
    best.set(row.id, {
      node: toNode(row),
      depth: row.depth,
      via: row.via,
      from: row.parent,
    });
  }
  return [...best.values()].sort(
    (a, b) => a.depth - b.depth || a.node.kind.localeCompare(b.node.kind),
  );
}

export function relativise(root: string, path: string): string {
  const abs = isAbsolute(path) ? path : join(root, path);
  return abs.startsWith(root) ? abs.slice(root.length).replace(/^[/\\]/, "") : path;
}
