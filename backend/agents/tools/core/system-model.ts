/**
 * Runtime-agnostic system-model tools.
 *
 * Same contract as the other tool cores: return text, never throw, so an
 * unbuilt or unreachable model degrades into an instruction the agent can act
 * on rather than a failed run.
 */
import {
  buildSystemModel,
  formatBuildReport,
} from "../../model/build";
import {
  indexDecisions,
  loadDecisions,
  searchDecisions as searchDecisionsCore,
  writeDecision,
  type NewDecision,
} from "../../model/decisions";
import { formatImpact, formatNode, simulateImpact } from "../../model/impact";
import {
  countByKind,
  countEdges,
  getBuildMeta,
  modelExists,
  openModel,
  productRoot,
  resolveNodes,
  type ModelStore,
} from "../../model/store";
import { NODE_KINDS, type NodeKind } from "../../model/types";
import { orToolError } from "../errors";

const SOURCE = "The system model";

const NOT_BUILT =
  "No system model has been built for this repository yet. " +
  "Run build_system_model (or `bun run model:build` in the sa-agent checkout) first.";

/** Opens the model, runs `use`, and always closes it. */
async function withModel(
  root: string | undefined,
  use: (store: ModelStore) => string | Promise<string>,
): Promise<string> {
  return orToolError(SOURCE, async () => {
    const resolved = productRoot(root);
    if (!modelExists(resolved)) return NOT_BUILT;

    const store = openModel(resolved);
    try {
      return await use(store);
    } finally {
      store.close();
    }
  });
}

export async function buildModel(root?: string): Promise<string> {
  return orToolError(SOURCE, async () =>
    formatBuildReport(await buildSystemModel(root)),
  );
}

export async function queryModel(
  query: string,
  kind?: string,
  limit = 5,
  root?: string,
): Promise<string> {
  return withModel(root, (store) => {
    const trimmed = query.trim();

    if (!trimmed || trimmed === "*") return overview(store);

    let matches = resolveNodes(store, trimmed, Math.max(limit, 12));
    if (kind && (NODE_KINDS as readonly string[]).includes(kind)) {
      const filtered = matches.filter((n) => n.kind === (kind as NodeKind));
      if (filtered.length > 0) matches = filtered;
    }

    if (matches.length === 0) {
      return (
        `Nothing in the system model matches "${trimmed}".\n` +
        `The model has ${describeCounts(store)}. ` +
        `Try a file path, a table name, a class name, or "GET /path". ` +
        `If the code is new, rebuild the model first.`
      );
    }

    const shown = matches.slice(0, limit);
    const header =
      matches.length > shown.length
        ? `${matches.length} matches for "${trimmed}", showing ${shown.length}:\n`
        : `${shown.length} match(es) for "${trimmed}":\n`;

    return header + "\n" + shown.map((node) => formatNode(store, node)).join("\n\n---\n\n");
  });
}

export async function simulate(
  target: string,
  depth = 4,
  root?: string,
): Promise<string> {
  return withModel(root, (store) => {
    const bounded = Math.min(8, Math.max(1, Math.trunc(depth)));
    const result = simulateImpact(store, target, bounded);
    if ("error" in result) {
      return (
        `${result.error}\nThe model has ${describeCounts(store)}. ` +
        `Use query_system_model to find the right node name first.`
      );
    }
    return formatImpact(result);
  });
}

export interface RecordDecisionInput extends NewDecision {
  root?: string;
}

/**
 * Writes the markdown record first, then re-indexes. If the index write fails
 * the record is still on disk and the next build picks it up, which is the
 * right way round for something whose whole point is to outlive the tooling.
 */
export async function recordDecision(input: RecordDecisionInput): Promise<string> {
  return orToolError(SOURCE, async () => {
    const resolved = productRoot(input.root);
    const record = writeDecision(resolved, input);

    const store = openModel(resolved, true);
    try {
      const { unresolved } = indexDecisions(store, loadDecisions(resolved));
      const mine = unresolved.filter((u) => u.id === record.id);

      const lines = [
        `Recorded decision ${record.id}: ${record.title}`,
        `Written to ${record.path} — commit it with the change it explains.`,
      ];

      const linked = record.related.filter(
        (ref) => !mine.some((u) => u.ref === ref),
      );
      if (linked.length > 0) {
        lines.push(`Linked to: ${linked.join(", ")}`);
      }
      if (mine.length > 0) {
        lines.push(
          `Not linked (no node matches): ${mine.map((u) => u.ref).join(", ")}. ` +
            `Fix the \`related\` list in the file, or rebuild the model if the code is new.`,
        );
      }
      return lines.join("\n");
    } finally {
      store.close();
    }
  });
}

export async function searchDecisions(
  query: string,
  limit = 5,
  root?: string,
): Promise<string> {
  return withModel(root, (store) => {
    const hits = searchDecisionsCore(store, query, limit);
    if (hits.length === 0) {
      return `No decision records match "${query}". Records live in .sa/decisions/.`;
    }

    return hits
      .map(({ record }) => {
        const parts = [
          `[${record.id}] ${record.title}${record.decidedOn ? ` (${record.decidedOn})` : ""}`,
          `file: ${record.path}`,
        ];
        if (record.related.length > 0) parts.push(`about: ${record.related.join(", ")}`);
        if (record.context) parts.push(`Context: ${record.context}`);
        if (record.decision) parts.push(`Decision: ${record.decision}`);
        if (record.alternatives) parts.push(`Alternatives: ${record.alternatives}`);
        if (record.reason) parts.push(`Reason: ${record.reason}`);
        if (record.consequences) parts.push(`Consequences: ${record.consequences}`);
        return parts.join("\n");
      })
      .join("\n\n---\n\n");
  });
}

// --- helpers -------------------------------------------------------------

function describeCounts(store: ModelStore): string {
  const byKind = countByKind(store);
  const total = Object.values(byKind).reduce((a, b) => a + b, 0);
  return `${total} nodes and ${countEdges(store)} edges`;
}

function overview(store: ModelStore): string {
  const byKind = countByKind(store);
  const lines = [
    `System model: ${describeCounts(store)}.`,
    `Built at: ${getBuildMeta(store, "built_at") ?? "unknown"}`,
    `Live schema used: ${getBuildMeta(store, "live_schema") ?? "unknown"}`,
    "",
    "Nodes by kind:",
  ];
  for (const [kind, count] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${kind}: ${count}`);
  }

  const busiest = store.db
    .prepare<{ name: string; kind: string; n: number }, []>(
      `SELECT n.name, n.kind, count(*) AS n
         FROM edges e JOIN nodes n ON n.id = e.to_id
        GROUP BY e.to_id ORDER BY n DESC LIMIT 10`,
    )
    .all();

  if (busiest.length > 0) {
    lines.push("");
    lines.push("Most depended-on nodes (change these carefully):");
    for (const row of busiest) lines.push(`- ${row.name} [${row.kind}] — ${row.n} dependents`);
  }

  return lines.join("\n");
}
