/**
 * Builds the system model: scan the repo, read the live schema, reconcile the
 * two, then index the decision records on top.
 *
 * Reconciliation is the interesting step. Code says `FROM trait_user_result`;
 * the database says whether that table is real. Only confirmed tables get a
 * `queries` edge. Everything else is reported, so a typo, a dropped table, or
 * a table living in another schema surfaces as a finding instead of quietly
 * becoming a node nobody can verify.
 *
 * Run directly:  bun run agents/model/build.ts [path-to-repo]
 */
import { backendEnvLoaded } from "../../load-env";
import { allDecisions, indexDecisions, loadDecisions } from "./decisions";
import { scanRepo } from "./scan";
import { columnId, scanSchema, tableId } from "./schema";
import {
  countByKind,
  countEdges,
  openModel,
  productRoot,
  replaceDerived,
  setBuildMeta,
  type ModelStore,
} from "./store";
import { layerOf, type ModelEdge, type ModelNode } from "./types";

void backendEnvLoaded;

export interface BuildReport {
  root: string;
  path: string;
  filesScanned: number;
  nodes: number;
  edges: number;
  byKind: Record<string, number>;
  tablesConfirmed: number;
  /** Tables referenced in code that the live schema does not have. */
  unknownTables: { name: string; refs: number; example: string }[];
  decisions: number;
  unresolvedDecisionRefs: { id: string; ref: string }[];
  warnings: string[];
  durationMs: number;
}

export async function buildSystemModel(explicitRoot?: string): Promise<BuildReport> {
  const started = Date.now();
  const root = productRoot(explicitRoot);

  const scan = scanRepo(root);
  const schema = await scanSchema();

  const nodes: ModelNode[] = [...scan.nodes, ...schema.nodes];
  const edges: ModelEdge[] = [...scan.edges, ...schema.edges];
  const warnings = [...scan.warnings, ...schema.warnings];

  const haveLiveSchema = schema.tables.size > 0;
  const unknownTables: BuildReport["unknownTables"] = [];

  for (const [name, refs] of scan.tableRefs) {
    const confirmed = schema.tables.has(name);

    if (!confirmed) {
      if (haveLiveSchema) {
        unknownTables.push({ name, refs: refs.length, example: refs[0].file });
        continue;
      }
      // With no database to check against, a SQL reference is the only
      // evidence there is. Keep it, but mark where it came from.
      nodes.push({
        id: tableId(name),
        kind: "table",
        name,
        file: null,
        line: null,
        source: "scan",
        meta: { unverified: true },
      });
    }

    for (const ref of refs) {
      edges.push({
        from: `code:${ref.file}`,
        to: tableId(name),
        kind: "queries",
        file: ref.file,
        line: ref.line,
        source: "scan",
      });
    }
  }

  // Docs that name a real table document it.
  for (const [file, words] of scan.docWords) {
    let linked = 0;
    for (const table of schema.tables) {
      if (linked >= 30) break;
      if (!words.has(table)) continue;
      edges.push({
        from: `code:${file}`,
        to: tableId(table),
        kind: "documents",
        file,
        line: null,
        source: "scan",
      });
      linked++;
    }
  }

  const store = openModel(root, true);
  try {
    replaceDerived(store, nodes, edges);

    const records = loadDecisions(root);
    const { unresolved } = indexDecisions(store, records);

    setBuildMeta(store, "built_at", new Date().toISOString());
    setBuildMeta(store, "files_scanned", String(scan.filesScanned));
    setBuildMeta(store, "live_schema", haveLiveSchema ? "yes" : "no");
    setBuildMeta(store, "unknown_tables", String(unknownTables.length));

    return {
      root,
      path: store.path,
      filesScanned: scan.filesScanned,
      nodes: Object.values(countByKind(store)).reduce((a, b) => a + b, 0),
      edges: countEdges(store),
      byKind: countByKind(store),
      tablesConfirmed: schema.tables.size,
      unknownTables: unknownTables.sort((a, b) => b.refs - a.refs).slice(0, 20),
      decisions: allDecisions(store).length,
      unresolvedDecisionRefs: unresolved,
      warnings,
      durationMs: Date.now() - started,
    };
  } finally {
    store.close();
  }
}

export function formatBuildReport(report: BuildReport): string {
  const lines: string[] = [];
  lines.push(`System model built: ${report.path}`);
  lines.push(
    `${report.filesScanned} files scanned, ${report.nodes} nodes, ${report.edges} edges, ${report.durationMs}ms`,
  );

  const byLayer = new Map<string, number>();
  for (const [kind, count] of Object.entries(report.byKind)) {
    const layer = layerOf(kind as Parameters<typeof layerOf>[0]);
    byLayer.set(layer, (byLayer.get(layer) ?? 0) + count);
  }
  lines.push("");
  lines.push("Nodes by kind:");
  for (const [kind, count] of Object.entries(report.byKind).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${kind}: ${count}`);
  }

  lines.push("");
  lines.push(
    report.tablesConfirmed > 0
      ? `Live schema: ${report.tablesConfirmed} tables confirmed.`
      : "Live schema: not reachable — table nodes come from SQL in the code and are unverified.",
  );

  if (report.unknownTables.length > 0) {
    lines.push("");
    lines.push("Referenced in code but absent from the live schema:");
    for (const t of report.unknownTables) {
      lines.push(`- ${t.name} (${t.refs} refs, e.g. ${t.example})`);
    }
    lines.push(
      "These may be views in another schema, aliases, or stale code. They were not added as tables.",
    );
  }

  lines.push("");
  lines.push(`Decisions indexed: ${report.decisions}`);
  if (report.unresolvedDecisionRefs.length > 0) {
    lines.push("Decision references that match no node:");
    for (const ref of report.unresolvedDecisionRefs) {
      lines.push(`- decision ${ref.id} -> "${ref.ref}"`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of report.warnings.slice(0, 20)) lines.push(`- ${warning}`);
  }

  return lines.join("\n");
}

/** Convenience for callers that already hold a store open. */
export function summarise(store: ModelStore): string {
  const byKind = countByKind(store);
  const total = Object.values(byKind).reduce((a, b) => a + b, 0);
  return `${total} nodes, ${countEdges(store)} edges`;
}

if (import.meta.main) {
  const report = await buildSystemModel(process.argv[2]);
  console.log(formatBuildReport(report));
  const { closePostgres } = await import("../../database/postgres");
  await closePostgres();
}
