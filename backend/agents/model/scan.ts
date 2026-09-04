/**
 * Deterministic repo scan: files, imports, HTTP endpoints, and table access.
 *
 * This is pattern matching, not a compiler. That is a deliberate trade: it
 * costs nothing, runs in seconds, works on a polyglot repo, and — crucially —
 * produces the same graph every time, so the agent can trust it the way it
 * trusts `describe_tables`. The cost is recall: a route registered through a
 * factory, or a table name assembled at runtime, is invisible here.
 *
 * Anything uncertain is reported as a warning by the build rather than being
 * guessed into an edge.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, posix, resolve } from "node:path";
import type { EdgeKind, ModelEdge, ModelNode, NodeKind } from "./types";

const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "target",
  "bin",
  "obj",
  "tmp",
  "generated",
  "__pycache__",
  "graphify-out",
  "migrations_lock",
]);

const CODE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".java",
  ".kt",
  ".go",
  ".rb",
  ".php",
  ".cs",
]);

const DOC_EXT = new Set([".md", ".mdx"]);

const RESOLVE_EXT = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
];

const MAX_FILES = 25_000;
const MAX_FILE_BYTES = 1_000_000;

/** Paths under these roots describe the browser, whatever the file is called. */
const FRONTEND_ROOTS =
  /^(frontend|web|client|ui|www|apps\/(web|frontend|client)|packages\/(web|ui))\//;

export interface ScanResult {
  nodes: ModelNode[];
  edges: ModelEdge[];
  /** Table names referenced in code, lowercased — reconciled against the DB later. */
  tableRefs: Map<string, { file: string; line: number }[]>;
  /** Lowercased word set per documentation file, for linking docs to DB tables. */
  docWords: Map<string, Set<string>>;
  warnings: string[];
  filesScanned: number;
}

// --- file discovery ------------------------------------------------------

function walk(root: string): string[] {
  const files: string[] = [];

  const visit = (dir: string, rel: string): void => {
    if (files.length >= MAX_FILES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      // Dot-directories are tooling, caches, and the model's own `.sa`.
      if (name.startsWith(".")) continue;
      const childRel = rel ? posix.join(rel, name) : name;

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(name)) continue;
        visit(join(dir, name), childRel);
      } else if (entry.isFile()) {
        const ext = extname(name).toLowerCase();
        if (!CODE_EXT.has(ext) && !DOC_EXT.has(ext)) continue;
        files.push(childRel);
      }
    }
  };

  visit(root, "");
  return files;
}

// --- classification ------------------------------------------------------

export function roleOf(path: string): NodeKind {
  const p = path.toLowerCase();

  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /(^|\/)(tests?|__tests__|e2e|cypress)\//.test(p)) {
    return "test";
  }
  if (/_test\.(go|py)$/.test(p) || /(^|\/)test_[^/]+\.py$/.test(p)) return "test";
  if (DOC_EXT.has(extname(p))) return "doc";

  const frontend = FRONTEND_ROOTS.test(p);

  if (!frontend) {
    // Both `order.repository.ts` and a bare `repository.ts` in a feature folder.
    if (
      /(^|[./])(repository|repo|dao|entity)\.[cm]?[jt]s$/.test(p) ||
      /(^|\/)(repositor(y|ies)|daos?|entities|database|db)\//.test(p)
    ) {
      return "repository";
    }
    if (/(^|[./])services?\.[cm]?[jt]s$/.test(p) || /(^|\/)services?\//.test(p)) {
      return "service";
    }
  }

  if (
    /\.(tsx|jsx|vue|svelte)$/.test(p) ||
    /(^|\/)(components?|pages?|features?|views?|screens?|widgets?)\//.test(p)
  ) {
    return "component";
  }

  return frontend ? "component" : "module";
}

const COMMENT_STRIPPABLE = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".java",
  ".kt",
  ".go",
  ".cs",
  ".php",
]);

/**
 * Blanks out comments while preserving every byte offset, so line numbers stay
 * honest. Necessary because a route or a SQL snippet quoted in a doc comment
 * is otherwise indistinguishable from a real one — this scanner matched its
 * own documentation before this existed.
 *
 * String literals are tracked so that `https://…` survives untouched.
 */
function stripComments(source: string): string {
  const out = source.split("");
  const n = source.length;
  let state: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  let i = 0;

  while (i < n) {
    const c = source[i];
    const d = i + 1 < n ? source[i + 1] : "";

    if (state === "code") {
      if (c === "/" && d === "/") {
        state = "line";
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (c === "/" && d === "*") {
        state = "block";
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (c === "'") state = "sq";
      else if (c === '"') state = "dq";
      else if (c === "`") state = "tpl";
      i++;
      continue;
    }

    if (state === "line") {
      if (c === "\n") state = "code";
      else out[i] = " ";
      i++;
      continue;
    }

    if (state === "block") {
      if (c === "*" && d === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        state = "code";
        i += 2;
        continue;
      }
      if (c !== "\n") out[i] = " ";
      i++;
      continue;
    }

    if (c === "\\") {
      i += 2;
      continue;
    }
    if (
      (state === "sq" && (c === "'" || c === "\n")) ||
      (state === "dq" && (c === '"' || c === "\n")) ||
      (state === "tpl" && c === "`")
    ) {
      state = "code";
    }
    i++;
  }

  return out.join("");
}

const PRINCIPAL_EXPORT = [
  /\bexport\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /\bexport\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
  /\b(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /\bdef\s+([A-Za-z_][\w]*)/,
];

/**
 * A class name is the best label a file can have — `TraitResultService` is how
 * people talk about it. Failing that, an export named after the file, and
 * failing that the filename, which beats whichever helper happens to be
 * declared first.
 */
function principalName(source: string, path: string): string {
  const base = posix.basename(path).replace(/\.[^.]+$/, "");

  const klass = PRINCIPAL_EXPORT[0].exec(source);
  if (klass) return klass[1];

  const flattened = base.replace(/[-_.]/g, "").toLowerCase();
  for (const pattern of PRINCIPAL_EXPORT.slice(1)) {
    for (const match of source.matchAll(new RegExp(pattern.source, "g"))) {
      if (match[1].toLowerCase() === flattened) return match[1];
    }
  }

  return base;
}

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

// --- import resolution ---------------------------------------------------

/**
 * `@/x` is near-universal in TS projects and resolving it is the difference
 * between a connected frontend graph and a pile of orphans, so read whatever
 * `paths` the repo declares rather than hardcoding one convention.
 */
function loadAliases(root: string, files: string[]): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  const configs = files.filter(
    (f) =>
      (f.endsWith("tsconfig.json") || f.endsWith("jsconfig.json")) &&
      f.split("/").length <= 3,
  );

  // `walk` only collects code and docs, so pick the configs up directly.
  const candidates = new Set<string>(configs);
  for (const dir of ["", "backend", "frontend", "src", "app", "packages", "apps"]) {
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      candidates.add(dir ? posix.join(dir, name) : name);
    }
  }

  for (const rel of candidates) {
    let raw: string;
    try {
      raw = readFileSync(join(root, rel), "utf-8");
    } catch {
      continue;
    }
    // tsconfig is JSON-with-comments; strip the comments before parsing.
    const cleaned = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");

    let parsed: {
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
    };
    try {
      parsed = JSON.parse(cleaned) as typeof parsed;
    } catch {
      continue;
    }

    const dir = posix.dirname(rel) === "." ? "" : posix.dirname(rel);
    const baseUrl = parsed.compilerOptions?.baseUrl ?? ".";
    const base = posix.normalize(posix.join(dir, baseUrl)).replace(/^\.\/?/, "");
    const paths = parsed.compilerOptions?.paths ?? {};

    for (const [pattern, targets] of Object.entries(paths)) {
      const key = pattern.replace(/\*$/, "");
      const resolved = targets.map((t) =>
        posix.normalize(posix.join(base, t.replace(/\*$/, ""))).replace(/^\.\/?/, ""),
      );
      aliases.set(key, [...(aliases.get(key) ?? []), ...resolved]);
    }
  }

  return aliases;
}

function resolveImport(
  spec: string,
  fromFile: string,
  known: Set<string>,
  aliases: Map<string, string[]>,
): string | null {
  const attempt = (base: string): string | null => {
    const normalised = posix.normalize(base).replace(/^\.\//, "");
    if (known.has(normalised)) return normalised;
    for (const ext of RESOLVE_EXT) {
      const candidate = posix.normalize(normalised + ext);
      if (known.has(candidate)) return candidate;
    }
    return null;
  };

  if (spec.startsWith(".")) {
    return attempt(posix.join(posix.dirname(fromFile), spec));
  }

  for (const [prefix, targets] of aliases) {
    if (!prefix || !spec.startsWith(prefix)) continue;
    const rest = spec.slice(prefix.length);
    for (const target of targets) {
      const hit = attempt(posix.join(target, rest));
      if (hit) return hit;
    }
  }

  return null;
}

// --- endpoint extraction -------------------------------------------------

const HTTP_METHODS = "get|post|put|patch|delete|head|options|all";

const DEFAULT_RECEIVERS = ["router", "app", "server", "fastify", "routes", "api"];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Express, Fastify, Koa-router, Flask, and FastAPI all read the same way, but
 * the receiver is whatever the file called its router — `const vault =
 * Router()` is the norm, not the exception — so the pattern is built per file
 * from the router variables actually declared in it.
 */
function routeDeclPattern(receivers: readonly string[]): RegExp {
  const names = [...new Set([...DEFAULT_RECEIVERS, ...receivers])]
    .map(escapeRegex)
    .join("|");
  return new RegExp(
    String.raw`\b(?:${names})\s*\.\s*(${HTTP_METHODS})\s*\(\s*(['"\`])([^'"\`]+)\2`,
    "gi",
  );
}

/** `const vault = Router()`, `= express.Router()`, `= new Hono()`, `= APIRouter()`. */
const ROUTER_FACTORY =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]*)?=\s*(?:await\s+)?(?:new\s+)?(?:express\s*\.\s*)?(?:Router|APIRouter|Hono|Blueprint)\s*\(/g;

/** `app.use("/v1/vault", vault)` — the prefix the mounted router really lives at. */
const MOUNT = /\b[A-Za-z_$][\w$]*\s*\.\s*use\s*\(\s*(['"`])(\/[^'"`]*)\1\s*,\s*([A-Za-z_$][\w$]*)/g;

/** FastAPI's spelling of the same mount. */
const INCLUDE_ROUTER =
  /\binclude_router\s*\(\s*([A-Za-z_$][\w$.]*)\s*,\s*prefix\s*=\s*(['"])([^'"]*)\2/g;

/** NestJS: `@Get('sub')` under a `@Controller('base')`. */
const NEST_CONTROLLER = /@Controller\s*\(\s*(['"`])([^'"`]*)\1/;
const NEST_ROUTE = new RegExp(
  String.raw`@(Get|Post|Put|Patch|Delete|Head|Options|All)\s*\(\s*(?:(['"\`])([^'"\`]*)\2)?`,
  "g",
);

/** Spring: `@GetMapping("/x")`, plus a class-level `@RequestMapping("/base")`. */
const SPRING_BASE = /@RequestMapping\s*\(\s*(?:value\s*=\s*)?(['"])([^'"]*)\1/;
const SPRING_ROUTE =
  /@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*(?:value\s*=\s*)?(['"])([^'"]*)\2/g;

/** Calls made *to* an HTTP API from anywhere. */
const HTTP_CALL = new RegExp(
  String.raw`\b(?:fetch|\$fetch|useSWR|useQuery)\s*\(\s*(['"\`])([^'"\`]*\/[^'"\`]*)\1` +
    String.raw`|\b(?:axios|http|client|apiClient|instance|ky|request)\s*\.\s*(?:${HTTP_METHODS})\s*\(\s*(['"\`])([^'"\`]*\/[^'"\`]*)\2` +
    String.raw`|\baxios\s*\(\s*(['"\`])([^'"\`]*\/[^'"\`]*)\3`,
  "gi",
);

function normalisePath(raw: string): string {
  let path = raw.trim().split("?")[0];
  // `${id}` in a template literal, `[id]` in Next, `<int:id>` in Flask.
  path = path
    .replace(/\$\{[^}]*\}/g, ":param")
    .replace(/\[\.\.\.[^\]]+\]/g, "*")
    .replace(/\[([^\]]+)\]/g, ":$1")
    .replace(/<[^:>]*:?([^>]*)>/g, ":$1")
    .replace(/:[A-Za-z_][\w]*/g, ":param");
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/$/, "");
  return path;
}

/** `app/(marketing)/orders/[id]/route.ts` -> `/orders/:param`. */
function nextRoutePath(file: string): string | null {
  const app = /(?:^|\/)app\/(.*)\/route\.[cm]?[jt]s$/.exec(file);
  if (app) {
    const segments = app[1]
      .split("/")
      .filter((s) => s && !(s.startsWith("(") && s.endsWith(")")) && !s.startsWith("@"));
    return normalisePath(`/${segments.join("/")}`);
  }
  const pages = /(?:^|\/)pages\/api\/(.*)\.[cm]?[jt]sx?$/.exec(file);
  if (pages) {
    const trimmed = pages[1].replace(/\/index$/, "").replace(/^index$/, "");
    return normalisePath(`/api/${trimmed}`);
  }
  return null;
}

const NEXT_HANDLER =
  /\bexport\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;

interface FoundEndpoint {
  method: string;
  path: string;
  line: number;
}

function findEndpoints(source: string, file: string): FoundEndpoint[] {
  const found: FoundEndpoint[] = [];
  const add = (method: string, path: string, index: number) => {
    const normalised = normalisePath(path);
    found.push({
      method: method.toUpperCase() === "ALL" ? "ANY" : method.toUpperCase(),
      path: normalised,
      line: lineAt(source, index),
    });
  };

  const nextPath = nextRoutePath(file);
  if (nextPath) {
    for (const match of source.matchAll(NEXT_HANDLER)) {
      add(match[1], nextPath, match.index ?? 0);
    }
  }

  const receivers = [...source.matchAll(ROUTER_FACTORY)].map((m) => m[1]);
  for (const match of source.matchAll(routeDeclPattern(receivers))) {
    add(match[1], match[3], match.index ?? 0);
  }

  const nestBase = NEST_CONTROLLER.exec(source);
  if (nestBase) {
    for (const match of source.matchAll(NEST_ROUTE)) {
      add(match[1], posix.join("/", nestBase[2], match[3] ?? ""), match.index ?? 0);
    }
  }

  const springBase = SPRING_BASE.exec(source)?.[2] ?? "";
  for (const match of source.matchAll(SPRING_ROUTE)) {
    add(match[1], posix.join("/", springBase, match[3] ?? ""), match.index ?? 0);
  }

  return found;
}

function findHttpCalls(source: string): { path: string; line: number }[] {
  const calls: { path: string; line: number }[] = [];
  for (const match of source.matchAll(HTTP_CALL)) {
    const raw = match[2] ?? match[4] ?? match[6];
    if (!raw) continue;
    // Absolute URLs to third parties are not our endpoints.
    if (/^[a-z]+:\/\//i.test(raw) && !/^https?:\/\/localhost/i.test(raw)) continue;
    const path = normalisePath(raw.replace(/^https?:\/\/[^/]+/i, ""));
    if (path === "/") continue;
    calls.push({ path, line: lineAt(source, match.index ?? 0) });
  }
  return calls;
}

// --- table access --------------------------------------------------------

const SQL_KEYWORDS = new Set([
  "select",
  "where",
  "order",
  "group",
  "having",
  "limit",
  "offset",
  "union",
  "dual",
  "values",
  "set",
  "on",
  "as",
  "using",
  "inner",
  "left",
  "right",
  "full",
  "cross",
  "outer",
  "join",
  "lateral",
  "only",
  "table",
  "unnest",
  "generate_series",
  "returning",
  "into",
  "and",
  "or",
  "not",
  "null",
  "case",
  "when",
  "then",
  "else",
  "end",
  "with",
  "recursive",
]);

const SQL_TABLE = [
  /\bfrom\s+(?:only\s+)?([a-z_][\w]*(?:\.[a-z_][\w]*)?)/gi,
  /\bjoin\s+([a-z_][\w]*(?:\.[a-z_][\w]*)?)/gi,
  /\binsert\s+into\s+([a-z_][\w]*(?:\.[a-z_][\w]*)?)/gi,
  /\bupdate\s+([a-z_][\w]*(?:\.[a-z_][\w]*)?)\s+set\b/gi,
  /\bdelete\s+from\s+([a-z_][\w]*(?:\.[a-z_][\w]*)?)/gi,
];

/** Query-builder and ORM spellings of the same thing. */
const ORM_TABLE = [
  /\.(?:from|table|into|selectFrom|insertInto|updateTable|deleteFrom)\s*\(\s*(['"`])([a-z_][\w]*)\1/gi,
  /@(?:Entity|Table)\s*\(\s*(?:\{\s*name\s*:\s*)?(['"`])([a-z_][\w]*)\1/gi,
  /\b(?:knex|db|sql)\s*\(\s*(['"`])([a-z_][\w]*)\1/gi,
];

/** `prisma.orderItem` -> `order_item`, checked against the live schema later. */
const PRISMA_MODEL = /\bprisma\s*\.\s*([a-z][A-Za-z0-9]*)\s*\./g;

function snakeCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** Quoted strings, including multi-line template literals. */
const STRING_LITERAL =
  /`(?:\\[\s\S]|[^\\`])*`|'(?:\\.|[^\\'\n])*'|"(?:\\.|[^\\"\n])*"/g;

/** A literal is only treated as SQL if it contains a statement verb. */
const LOOKS_LIKE_SQL =
  /\b(?:select\s|insert\s+into\s|update\s+[\w."]+\s+set\b|delete\s+from\s|create\s+table\s|alter\s+table\s|truncate\s)/i;

function findTables(source: string): { name: string; line: number }[] {
  const hits: { name: string; line: number }[] = [];
  const push = (raw: string, index: number) => {
    const name = raw.includes(".") ? raw.slice(raw.lastIndexOf(".") + 1) : raw;
    const lower = name.toLowerCase();
    if (SQL_KEYWORDS.has(lower) || lower.length < 2) return;
    hits.push({ name: lower, line: lineAt(source, index) });
  };

  // Running the `FROM x` patterns over whole files reads English prose in tool
  // descriptions as SQL ("...from the indexed knowledge base" -> table `the`),
  // so only look inside literals that are actually queries.
  for (const literal of source.matchAll(STRING_LITERAL)) {
    const text = literal[0];
    if (text.length < 16 || !LOOKS_LIKE_SQL.test(text)) continue;
    const base = literal.index ?? 0;
    for (const pattern of SQL_TABLE) {
      for (const match of text.matchAll(pattern)) push(match[1], base + (match.index ?? 0));
    }
  }

  // Query-builder calls are specific enough to match anywhere.
  for (const pattern of ORM_TABLE) {
    for (const match of source.matchAll(pattern)) push(match[2], match.index ?? 0);
  }
  for (const match of source.matchAll(PRISMA_MODEL)) {
    push(snakeCase(match[1]), match.index ?? 0);
  }

  return hits;
}

// --- the scan ------------------------------------------------------------

const IMPORT_FROM = /\bfrom\s*(['"])([^'"\n]+)\1/g;
const IMPORT_REQUIRE = /\brequire\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;
const IMPORT_DYNAMIC = /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;

/** The whole clause between `import` and `from`, so bindings can be named. */
const IMPORT_CLAUSE = /\bimport\s+(?!type\b)([\s\S]{0,400}?)\s+from\s*(['"])([^'"\n]+)\2/g;
const REQUIRE_BINDING =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*(['"])([^'"\n]+)\2\s*\)/g;

/**
 * Which local name refers to which module, so `app.use("/v1/vault", vault)`
 * can be traced to the file that declares those routes.
 */
function importBindings(source: string): Map<string, string> {
  const bindings = new Map<string, string>();

  for (const match of source.matchAll(IMPORT_CLAUSE)) {
    const clause = match[1];
    const spec = match[3];

    const named = /\{([\s\S]*?)\}/.exec(clause);
    if (named) {
      for (const part of named[1].split(",")) {
        const alias = /(?:^|\s)([A-Za-z_$][\w$]*)\s*$/.exec(part.replace(/\btype\b/g, ""));
        if (alias) bindings.set(alias[1], spec);
      }
    }

    const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (namespace) bindings.set(namespace[1], spec);

    const fallback = clause.replace(/\{[\s\S]*?\}/g, "").replace(/\*\s+as\s+[\w$]+/g, "");
    const defaultName = /^\s*,?\s*([A-Za-z_$][\w$]*)\s*,?\s*$/.exec(fallback);
    if (defaultName) bindings.set(defaultName[1], spec);
  }

  for (const match of source.matchAll(REQUIRE_BINDING)) {
    bindings.set(match[1], match[3]);
  }

  return bindings;
}

interface FileScan {
  role: NodeKind;
  endpoints: FoundEndpoint[];
  /** `prefix` -> module specifier of the router mounted there. */
  mounts: { prefix: string; spec: string }[];
}

function findMounts(source: string, bindings: Map<string, string>): FileScan["mounts"] {
  const mounts: FileScan["mounts"] = [];

  for (const match of source.matchAll(MOUNT)) {
    const spec = bindings.get(match[3]);
    if (spec) mounts.push({ prefix: normalisePath(match[2]), spec });
  }
  for (const match of source.matchAll(INCLUDE_ROUTER)) {
    const spec = bindings.get(match[1].split(".")[0]);
    if (spec) mounts.push({ prefix: normalisePath(match[3]), spec });
  }

  return mounts;
}

/**
 * The path prefix each router file is reachable at, following `app.use` chains
 * back to whichever file mounts nothing else. A router mounted twice honestly
 * has two prefixes, so this returns a list; a router nobody mounts gets `""`
 * and its declared paths stand as written.
 */
function resolvePrefixes(
  scans: Map<string, FileScan>,
  known: Set<string>,
  aliases: Map<string, string[]>,
): Map<string, string[]> {
  const mountedFrom = new Map<string, { parent: string; prefix: string }[]>();

  for (const [file, scan] of scans) {
    for (const mount of scan.mounts) {
      const target = resolveImport(mount.spec, file, known, aliases);
      if (!target || target === file) continue;
      mountedFrom.set(target, [
        ...(mountedFrom.get(target) ?? []),
        { parent: file, prefix: mount.prefix },
      ]);
    }
  }

  const cache = new Map<string, string[]>();
  const visiting = new Set<string>();

  const prefixesOf = (file: string, depth: number): string[] => {
    const cached = cache.get(file);
    if (cached) return cached;

    const parents = mountedFrom.get(file);
    // A cycle or a very deep chain means the mount graph is not something this
    // scanner can read; fall back to the paths as declared.
    if (!parents?.length || depth >= 8 || visiting.has(file)) return [""];

    visiting.add(file);
    const found = new Set<string>();
    outer: for (const { parent, prefix } of parents) {
      for (const base of prefixesOf(parent, depth + 1)) {
        found.add(normalisePath(`${base}${prefix}`));
        if (found.size >= 4) break outer;
      }
    }
    visiting.delete(file);

    const result = found.size > 0 ? [...found] : [""];
    cache.set(file, result);
    return result;
  };

  const prefixes = new Map<string, string[]>();
  for (const file of scans.keys()) prefixes.set(file, prefixesOf(file, 0));
  return prefixes;
}

export function codeId(file: string): string {
  return `code:${file}`;
}

export function endpointId(method: string, path: string): string {
  return `endpoint:${method} ${path}`;
}

export function scanRepo(root: string): ScanResult {
  const absRoot = resolve(root);
  const files = walk(absRoot);
  const known = new Set(files);
  const aliases = loadAliases(absRoot, files);

  const nodes = new Map<string, ModelNode>();
  const edges: ModelEdge[] = [];
  const tableRefs = new Map<string, { file: string; line: number }[]>();
  const warnings: string[] = [];

  const addEdge = (
    from: string,
    to: string,
    kind: EdgeKind,
    file: string | null,
    line: number | null,
  ) => {
    edges.push({ from, to, kind, file, line, source: "scan" });
  };

  const sources = new Map<string, string>();
  const roles = new Map<string, NodeKind>();
  const scans = new Map<string, FileScan>();

  // Pass 1 — one node per file, and the raw route declarations it contains.
  for (const file of files) {
    let source: string;
    try {
      const stat = statSync(join(absRoot, file));
      if (stat.size > MAX_FILE_BYTES) {
        warnings.push(`skipped ${file}: ${Math.round(stat.size / 1024)}KB exceeds the scan limit`);
        continue;
      }
      const raw = readFileSync(join(absRoot, file), "utf-8");
      source = COMMENT_STRIPPABLE.has(extname(file).toLowerCase())
        ? stripComments(raw)
        : raw;
    } catch (err) {
      warnings.push(`could not read ${file}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    sources.set(file, source);
    const kind = roleOf(file);
    roles.set(file, kind);

    nodes.set(codeId(file), {
      id: codeId(file),
      kind,
      name: kind === "doc" ? posix.basename(file) : principalName(source, file),
      file,
      line: null,
      source: "scan",
      meta: { ext: extname(file), frontend: FRONTEND_ROOTS.test(file) },
    });

    if (kind === "doc") continue;

    scans.set(file, {
      role: kind,
      endpoints: findEndpoints(source, file),
      mounts: findMounts(source, importBindings(source)),
    });

    for (const table of findTables(source)) {
      tableRefs.set(table.name, [
        ...(tableRefs.get(table.name) ?? []),
        { file, line: table.line },
      ]);
    }
  }

  // Pass 1b — mount prefixes. A router declares `/folders`; the app mounts it
  // at `/v1/vault`; the endpoint that exists is `/v1/vault/folders`. Without
  // this the API layer of the model is confidently wrong.
  const prefixes = resolvePrefixes(scans, known, aliases);

  for (const [file, scan] of scans) {
    for (const endpoint of scan.endpoints) {
      for (const prefix of prefixes.get(file) ?? [""]) {
        const path = normalisePath(`${prefix}${endpoint.path === "/" ? "" : endpoint.path}`);
        if (path === "/") continue;
        const id = endpointId(endpoint.method, path);
        if (!nodes.has(id)) {
          nodes.set(id, {
            id,
            kind: "endpoint",
            name: `${endpoint.method} ${path}`,
            file,
            line: endpoint.line,
            source: "scan",
            meta: { method: endpoint.method, path, mountedAt: prefix || undefined },
          });
        }
        // The endpoint is what breaks when its handler changes, so it is the
        // dependent side of the edge.
        addEdge(id, codeId(file), "handled_by", file, endpoint.line);
      }
    }
  }

  // Pass 2 — imports, HTTP calls, and doc mentions, now that every node exists.
  const endpointsByPath = new Map<string, string[]>();
  for (const node of nodes.values()) {
    if (node.kind !== "endpoint") continue;
    const path = String(node.meta.path ?? "");
    endpointsByPath.set(path, [...(endpointsByPath.get(path) ?? []), node.id]);
  }

  const matchEndpoints = (path: string): string[] => {
    const direct = endpointsByPath.get(path);
    if (direct) return direct;
    // A client calls `/api/orders`; the server mounted `/orders` under a prefix.
    for (const [candidate, ids] of endpointsByPath) {
      if (candidate.length > 1 && path.endsWith(candidate)) return ids;
    }
    return [];
  };

  for (const [file, source] of sources) {
    const kind = roles.get(file);
    if (kind === "doc") continue;
    const self = codeId(file);

    const specs = new Set<string>();
    for (const pattern of [IMPORT_FROM, IMPORT_REQUIRE, IMPORT_DYNAMIC]) {
      for (const match of source.matchAll(pattern)) specs.add(match[2]);
    }

    for (const spec of specs) {
      const target = resolveImport(spec, file, known, aliases);
      if (!target || target === file) continue;
      // An import inside a test file is coverage, not a dependency.
      addEdge(self, codeId(target), kind === "test" ? "tests" : "imports", file, null);
    }

    for (const call of findHttpCalls(source)) {
      for (const id of matchEndpoints(call.path)) {
        addEdge(self, id, "calls", file, call.line);
      }
    }
  }

  // Pass 3 — documentation mentions.
  //
  // A bare word match is too loose: half the repo mentions "config" or
  // "store" in prose. A link is only made on evidence a human would accept —
  // the file path, the endpoint path, or a distinctive camelCase/PascalCase
  // identifier that is unlikely to be an English word.
  const byPath = new Map<string, string>();
  const byBasename = new Map<string, string[]>();
  for (const node of nodes.values()) {
    if (!node.file || node.kind === "doc") continue;
    byPath.set(node.file, node.id);
    const base = posix.basename(node.file);
    byBasename.set(base, [...(byBasename.get(base) ?? []), node.id]);
  }

  const distinctive = [...nodes.values()].filter(
    (n) =>
      ["service", "repository", "component", "module"].includes(n.kind) &&
      n.name.length >= 6 &&
      /[a-z][A-Z]/.test(n.name),
  );

  const PATH_TOKEN = /[\w@][\w./-]*\.[A-Za-z]{1,5}\b/g;
  const docWords = new Map<string, Set<string>>();

  for (const [file, source] of sources) {
    if (roles.get(file) !== "doc") continue;
    const self = codeId(file);
    const words = new Set(source.toLowerCase().match(/[a-z_][\w]*/g) ?? []);
    docWords.set(file, words);

    const linked = new Set<string>();
    const link = (id: string) => {
      if (id === self || linked.size >= 60 || linked.has(id)) return;
      linked.add(id);
      addEdge(self, id, "documents", file, null);
    };

    for (const token of source.match(PATH_TOKEN) ?? []) {
      const cleaned = token.replace(/^\.\//, "");
      const exact = byPath.get(cleaned);
      if (exact) {
        link(exact);
        continue;
      }
      // A bare filename only counts when it is unambiguous in the repo.
      const candidates = byBasename.get(posix.basename(cleaned));
      if (candidates?.length === 1) link(candidates[0]);
    }

    for (const node of distinctive) {
      if (words.has(node.name.toLowerCase())) link(node.id);
    }

    for (const [path, ids] of endpointsByPath) {
      if (path.length < 4 || !source.includes(path)) continue;
      for (const id of ids) link(id);
    }
  }

  return {
    nodes: [...nodes.values()],
    edges,
    tableRefs,
    docWords,
    warnings,
    filesScanned: sources.size,
  };
}
