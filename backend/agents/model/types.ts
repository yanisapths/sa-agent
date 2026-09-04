/**
 * The system model: a typed graph of how this product actually hangs together.
 *
 * It is the third grounding source, next to the live database and the Chroma
 * index. Where those answer "what columns exist" and "what did we write down",
 * this one answers "what is connected to what" and "why is it like this".
 *
 * Two rules keep it trustworthy:
 *
 * 1. Every node and edge is either scanned deterministically from the repo,
 *    read from the live database, or written by a human. Nothing is inferred
 *    by a model, so a rebuild of an unchanged repo produces an identical graph.
 * 2. Edges always point **from the dependent to the dependency**. Impact is
 *    therefore reverse reachability, one recursive query, no special cases.
 */

export type NodeKind =
  | "endpoint"
  | "service"
  | "repository"
  | "component"
  | "module"
  | "test"
  | "doc"
  | "table"
  | "column"
  | "decision"
  /**
   * Reserved. A feature is a human grouping ("checkout", "trait quiz") that no
   * scan can infer, so nothing produces these yet — grouping tools are the
   * next increment. Kept in the taxonomy so the id namespace stays stable.
   */
  | "feature";

export const NODE_KINDS: readonly NodeKind[] = [
  "endpoint",
  "service",
  "repository",
  "component",
  "module",
  "test",
  "doc",
  "table",
  "column",
  "decision",
  "feature",
];

/**
 * `A -kind-> B` always reads "A depends on B", so changing B may break A.
 * `handled_by` is the one that looks backwards in prose (an endpoint is
 * handled by a file) and is deliberately stored that way: the endpoint is the
 * thing that breaks when its handler changes.
 */
export type EdgeKind =
  | "imports"
  | "handled_by"
  | "calls"
  | "queries"
  | "has_column"
  | "references"
  | "tests"
  | "documents"
  | "decides"
  /** Reserved, with `feature` above. */
  | "belongs_to";

export const EDGE_KINDS: readonly EdgeKind[] = [
  "imports",
  "handled_by",
  "calls",
  "queries",
  "has_column",
  "references",
  "tests",
  "documents",
  "decides",
  "belongs_to",
];

/** Where a fact came from. Reported in tool output so the agent can weigh it. */
export type Source = "scan" | "database" | "manual";

export interface ModelNode {
  /** Stable, namespaced: `code:backend/x.ts`, `table:orders`, `endpoint:GET /orders`. */
  id: string;
  kind: NodeKind;
  /** Display name — the principal export for code, the bare name otherwise. */
  name: string;
  /** Repo-relative path, when the node is anchored in a file. */
  file: string | null;
  line: number | null;
  source: Source;
  meta: Record<string, unknown>;
}

export interface ModelEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  file: string | null;
  line: number | null;
  source: Source;
}

export interface DecisionRecord {
  id: string;
  title: string;
  context: string;
  decision: string;
  alternatives: string;
  reason: string;
  consequences: string;
  decidedOn: string;
  /** Repo-relative path of the markdown record. */
  path: string;
  /** Node refs this decision constrains, as written by the human. */
  related: string[];
}

/** Layer a node belongs to, used to group an impact report the way people think. */
export function layerOf(kind: NodeKind): string {
  switch (kind) {
    case "table":
    case "column":
      return "Database";
    case "endpoint":
      return "API";
    case "service":
    case "repository":
    case "module":
      return "Backend";
    case "component":
      return "Frontend";
    case "test":
      return "Tests";
    case "doc":
      return "Documentation";
    case "decision":
      return "Decisions";
    case "feature":
      return "Features";
  }
}

export const LAYER_ORDER = [
  "API",
  "Backend",
  "Database",
  "Frontend",
  "Tests",
  "Documentation",
  "Decisions",
  "Features",
] as const;

export function nodeRef(node: ModelNode): string {
  const where = node.file ? ` (${node.file}${node.line ? `:${node.line}` : ""})` : "";
  return `${node.name} [${node.kind}]${where}`;
}
