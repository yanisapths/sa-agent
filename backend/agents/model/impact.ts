/**
 * Change simulation: "what happens if I change this?"
 *
 * The graph stores every edge as dependent -> dependency, so the blast radius
 * is one reverse-reachability query. What this module adds on top is judgement
 * the traversal cannot give you: which layers are hit, what is exposed
 * externally, what has no test behind it, and which past decisions the change
 * would walk into.
 *
 * The risk score is deliberately a small, printed rubric rather than a model
 * call. A number nobody can audit is worse than no number.
 */
import { decisionsFor } from "./decisions";
import {
  getNode,
  resolveNodes,
  reverseReachable,
  type ModelStore,
  type Reached,
} from "./store";
import { LAYER_ORDER, layerOf, type DecisionRecord, type ModelNode } from "./types";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ImpactReport {
  target: ModelNode;
  /** Other nodes the reference also matched, if it was ambiguous. */
  alsoMatched: ModelNode[];
  depth: number;
  reached: Reached[];
  byLayer: Map<string, Reached[]>;
  endpoints: Reached[];
  untested: Reached[];
  decisions: DecisionRecord[];
  risk: RiskLevel;
  score: number;
  reasons: string[];
  truncated: boolean;
}

const CODE_KINDS = new Set(["service", "repository", "module", "component"]);

/** Which of these ids has at least one test pointing at it. */
function testedIds(store: ModelStore, ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const marks = ids.map(() => "?").join(",");
  const rows = store.db
    .prepare<{ to_id: string }, string[]>(
      `SELECT DISTINCT to_id FROM edges WHERE kind = 'tests' AND to_id IN (${marks})`,
    )
    .all(...ids);
  return new Set(rows.map((r) => r.to_id));
}

const MAX_ROWS = 400;

export function simulateImpact(
  store: ModelStore,
  ref: string,
  depth = 4,
): ImpactReport | { error: string; candidates: ModelNode[] } {
  const matches = resolveNodes(store, ref);
  if (matches.length === 0) {
    return {
      error: `Nothing in the system model matches "${ref}".`,
      candidates: [],
    };
  }

  const target = matches[0];
  const reached = reverseReachable(store, target.id, depth, MAX_ROWS);

  const byLayer = new Map<string, Reached[]>();
  for (const hit of reached) {
    const layer = layerOf(hit.node.kind);
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), hit]);
  }

  const endpoints = reached.filter((r) => r.node.kind === "endpoint");
  const codeHits = reached.filter((r) => CODE_KINDS.has(r.node.kind));
  const tested = testedIds(
    store,
    codeHits.map((r) => r.node.id),
  );
  const untested = codeHits.filter((r) => !tested.has(r.node.id));

  const decisions = decisionsFor(store, [target.id, ...reached.map((r) => r.node.id)]);

  const { risk, score, reasons } = assessRisk({
    target,
    reached,
    endpoints,
    codeHits,
    untested,
    decisions,
  });

  return {
    target,
    alsoMatched: matches.slice(1),
    depth,
    reached,
    byLayer,
    endpoints,
    untested,
    decisions,
    risk,
    score,
    reasons,
    truncated: reached.length >= MAX_ROWS,
  };
}

function assessRisk(input: {
  target: ModelNode;
  reached: Reached[];
  endpoints: Reached[];
  codeHits: Reached[];
  untested: Reached[];
  decisions: DecisionRecord[];
}): { risk: RiskLevel; score: number; reasons: string[] } {
  const { target, reached, endpoints, codeHits, untested, decisions } = input;
  const reasons: string[] = [];
  let score = 0;

  if (endpoints.length > 0) {
    const points = Math.min(4, 2 + endpoints.length);
    score += points;
    reasons.push(
      `+${points} — ${endpoints.length} HTTP endpoint(s) affected; this is an external contract, so callers you do not control may break.`,
    );
  }

  if (target.kind === "column" || target.kind === "table") {
    score += 2;
    reasons.push(
      "+2 — the change starts in the database, where a migration is needed and old rows already exist.",
    );
  }

  const spread = new Set(reached.map((r) => layerOf(r.node.kind))).size;
  if (spread >= 3) {
    score += 2;
    reasons.push(`+2 — the change crosses ${spread} layers, so it cannot ship as one isolated edit.`);
  }

  if (reached.length > 30) {
    score += 3;
    reasons.push(`+3 — ${reached.length} nodes affected.`);
  } else if (reached.length > 10) {
    score += 2;
    reasons.push(`+2 — ${reached.length} nodes affected.`);
  } else if (reached.length > 3) {
    score += 1;
    reasons.push(`+1 — ${reached.length} nodes affected.`);
  } else {
    reasons.push(`+0 — ${reached.length} node(s) affected.`);
  }

  if (codeHits.length > 0 && untested.length > 0) {
    const ratio = untested.length / codeHits.length;
    const points = ratio > 0.6 ? 2 : 1;
    score += points;
    reasons.push(
      `+${points} — ${untested.length} of ${codeHits.length} affected code file(s) have no test pointing at them.`,
    );
  }

  if (decisions.length > 0) {
    score += 1;
    reasons.push(
      `+1 — ${decisions.length} recorded decision(s) constrain this area; read them before changing it.`,
    );
  }

  const risk: RiskLevel = score >= 7 ? "HIGH" : score >= 4 ? "MEDIUM" : "LOW";
  return { risk, score, reasons };
}

// --- rendering -----------------------------------------------------------

function describe(hit: Reached): string {
  const where = hit.node.file
    ? ` — ${hit.node.file}${hit.node.line ? `:${hit.node.line}` : ""}`
    : "";
  return `  - ${hit.node.name}${where}  (via ${hit.via}, depth ${hit.depth})`;
}

export function formatImpact(report: ImpactReport): string {
  const lines: string[] = [];
  const t = report.target;

  lines.push(
    `Impact of changing: ${t.name} [${t.kind}]${t.file ? ` — ${t.file}` : ""}`,
  );
  if (t.source === "scan" && (t.kind === "table" || t.kind === "column")) {
    lines.push(
      "Note: this table was read from SQL in the code, not confirmed against the live database.",
    );
  }
  if (report.alsoMatched.length > 0) {
    // Several nodes share a name (every repo has four README.md), so print the
    // ids — they are what you paste back in to pick a different one.
    lines.push("");
    lines.push(`Ambiguous reference. Re-run with one of these ids instead:`);
    for (const node of report.alsoMatched) {
      lines.push(`  - ${node.id}${node.file ? ` — ${node.file}` : ""}`);
    }
  }

  lines.push("");
  lines.push(`Risk: ${report.risk} (score ${report.score}; HIGH >= 7, MEDIUM >= 4)`);
  for (const reason of report.reasons) lines.push(`  ${reason}`);

  lines.push("");
  if (report.reached.length === 0) {
    lines.push("Nothing depends on this node in the current model.");
    lines.push(
      "That is either genuinely safe, or the dependency is dynamic and the scan cannot see it.",
    );
    return lines.join("\n");
  }

  lines.push(`Affected (${report.reached.length} nodes, depth <= ${report.depth}):`);
  for (const layer of LAYER_ORDER) {
    const hits = report.byLayer.get(layer);
    if (!hits || hits.length === 0) continue;
    lines.push("");
    lines.push(`${layer} (${hits.length}):`);
    for (const hit of hits.slice(0, 25)) lines.push(describe(hit));
    if (hits.length > 25) lines.push(`  ... and ${hits.length - 25} more`);
  }

  if (report.untested.length > 0) {
    lines.push("");
    lines.push("No test points at these affected files:");
    for (const hit of report.untested.slice(0, 15)) {
      lines.push(`  - ${hit.node.file ?? hit.node.name}`);
    }
  }

  if (report.decisions.length > 0) {
    lines.push("");
    lines.push("Decisions that constrain this area:");
    for (const decision of report.decisions) {
      lines.push(`  - [${decision.id}] ${decision.title} (${decision.path})`);
      if (decision.reason) {
        lines.push(`      why: ${decision.reason.split("\n")[0].slice(0, 200)}`);
      }
    }
  }

  if (report.truncated) {
    lines.push("");
    lines.push(
      `Truncated at ${MAX_ROWS} nodes. This node is a hub — narrow the change or lower the depth.`,
    );
  }

  return lines.join("\n");
}

/** One-hop context for a node: what it needs, and what needs it. */
export function formatNode(store: ModelStore, node: ModelNode, limit = 25): string {
  const lines: string[] = [];
  lines.push(
    `${node.name} [${node.kind}]${node.file ? ` — ${node.file}${node.line ? `:${node.line}` : ""}` : ""}`,
  );
  lines.push(`id: ${node.id}   source: ${node.source}`);

  const meta = Object.entries(node.meta ?? {}).filter(([, v]) => v !== undefined && v !== false);
  if (meta.length > 0) {
    lines.push(meta.map(([k, v]) => `${k}=${String(v)}`).join("  "));
  }

  const rows = store.db
    .prepare<
      { id: string; name: string; kind: string; file: string | null; edge: string; dir: string },
      [string, string, number]
    >(
      `SELECT n.id, n.name, n.kind, n.file, e.kind AS edge, 'depends on' AS dir
         FROM edges e JOIN nodes n ON n.id = e.to_id WHERE e.from_id = ?
       UNION ALL
       SELECT n.id, n.name, n.kind, n.file, e.kind AS edge, 'used by' AS dir
         FROM edges e JOIN nodes n ON n.id = e.from_id WHERE e.to_id = ?
        LIMIT ?`,
    )
    .all(node.id, node.id, limit * 2);

  for (const direction of ["depends on", "used by"] as const) {
    const group = rows.filter((r) => r.dir === direction);
    lines.push("");
    lines.push(`${direction} (${group.length}):`);
    if (group.length === 0) lines.push("  (none)");
    for (const row of group.slice(0, limit)) {
      lines.push(`  - ${row.name} [${row.kind}] via ${row.edge}${row.file ? ` — ${row.file}` : ""}`);
    }
    if (group.length > limit) lines.push(`  ... and ${group.length - limit} more`);
  }

  const decisions = decisionsFor(store, [node.id]);
  if (decisions.length > 0) {
    lines.push("");
    lines.push("Why it is like this:");
    for (const decision of decisions) {
      lines.push(`  - [${decision.id}] ${decision.title} — ${decision.path}`);
    }
  }

  return lines.join("\n");
}

export { getNode };
