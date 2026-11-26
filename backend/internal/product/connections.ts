import { AsyncLocalStorage } from "node:async_hooks";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { config } from "../../config";
import {
  connectionListSchema,
  type Connection,
  type ConnectionKind,
  type ConnectionOf,
} from "../../contract/connection";
import { HttpError } from "../httpError";
import { resolveEnvRef } from "./env-ref";
import type { ResolvedProduct } from "./types";

export const CONNECTIONS_HEADER = "x-sa-connections";
/** Node allows 16 KB for all headers combined; one header must leave room for the rest. */
export const MAX_CONNECTIONS_HEADER_BYTES = 8 * 1024;
export const MAX_CONNECTIONS = 4;

// --- parsing ---------------------------------------------------------------

/**
 * `X-SA-Connections` is `base64url(JSON array)`. Validation errors never echo
 * the payload: it is the user's credentials.
 */
export function parseConnections(header: string | string[] | undefined): Connection[] {
  if (header === undefined) return [];
  if (Array.isArray(header)) {
    throw new HttpError(400, "Send X-SA-Connections once.");
  }
  const raw = header.trim();
  if (!raw) return [];
  if (Buffer.byteLength(raw, "utf8") > MAX_CONNECTIONS_HEADER_BYTES) {
    throw new HttpError(400, `X-SA-Connections is over ${MAX_CONNECTIONS_HEADER_BYTES / 1024} KB.`);
  }
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(raw)) {
    throw new HttpError(400, "X-SA-Connections must be base64url JSON.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(400, "X-SA-Connections must be base64url JSON.");
  }
  return parseConnectionList(parsed);
}

export function parseConnectionList(value: unknown): Connection[] {
  if (Array.isArray(value) && value.length > MAX_CONNECTIONS) {
    throw new HttpError(400, `At most ${MAX_CONNECTIONS} connections per request.`);
  }
  const result = connectionListSchema.safeParse(value ?? []);
  if (!result.success) {
    const where = result.error.issues
      .map((issue) => `${issue.path.join(".") || "connections"}: ${issue.message}`)
      .slice(0, 3)
      .join("; ");
    throw new HttpError(400, `Invalid connection: ${where}`);
  }
  if (result.data.length > MAX_CONNECTIONS) {
    throw new HttpError(400, `At most ${MAX_CONNECTIONS} connections per request.`);
  }
  return result.data;
}

// --- request context ---------------------------------------------------------

const store = new AsyncLocalStorage<readonly Connection[]>();

/** Connections live here for the request only: never in tool args, checkpoints or Supabase. */
export function withConnections<T>(
  conns: readonly Connection[] | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return store.run(conns ?? [], fn);
}

export function currentConnections(): readonly Connection[] {
  return store.getStore() ?? [];
}

export function currentConnection<K extends ConnectionKind>(
  kind: K,
): ConnectionOf<K> | undefined {
  return currentConnections().find((conn) => conn.kind === kind) as
    | ConnectionOf<K>
    | undefined;
}

// --- resolution --------------------------------------------------------------

export type ConnectionOrigin = "browser" | "env" | "default";

export type ResolvedConnection<K extends ConnectionKind> = {
  source: ConnectionOrigin;
  connection: ConnectionOf<K>;
};

function envConnection<K extends ConnectionKind>(
  product: ResolvedProduct,
  kind: K,
  env: NodeJS.ProcessEnv,
): ConnectionOf<K> | undefined {
  if (kind === "postgres") {
    const url = resolveEnvRef(product.db.urlEnv, env);
    if (!url) return undefined;
    return { kind: "postgres", url, schema: product.db.schema } as ConnectionOf<K>;
  }
  if (kind === "confluence") {
    const docs = product.docs;
    if (docs.provider !== "confluence" || !docs.baseUrl || !docs.spaceKey) return undefined;
    const token = resolveEnvRef(docs.tokenEnv, env);
    const username = token ? resolveEnvRef(docs.usernameEnv, env) : undefined;
    return {
      kind: "confluence",
      baseUrl: docs.baseUrl,
      spaceKey: docs.spaceKey,
      ...(username ? { username } : {}),
      ...(token ? { token } : {}),
    } as ConnectionOf<K>;
  }
  return undefined;
}

function defaultConnection<K extends ConnectionKind>(
  product: ResolvedProduct,
  kind: K,
  env: NodeJS.ProcessEnv,
): ConnectionOf<K> | undefined {
  if (kind === "postgres") {
    const url = env.DATABASE_URL?.trim();
    if (!url) return undefined;
    return { kind: "postgres", url, schema: product.db.schema } as ConnectionOf<K>;
  }
  if (kind === "confluence") {
    if (product.docs.provider !== "confluence") return undefined;
    const docs = config.confluence;
    const token = docs.accessToken || docs.personalToken || undefined;
    return {
      kind: "confluence",
      baseUrl: docs.baseUrl,
      spaceKey: docs.spaceKey,
      ...(docs.username && docs.accessToken ? { username: docs.username } : {}),
      ...(token ? { token } : {}),
    } as ConnectionOf<K>;
  }
  if (kind === "jira") {
    const jira = config.jira;
    if (!jira.url) return undefined;
    if (jira.personalToken) {
      return { kind: "jira", baseUrl: jira.url, token: jira.personalToken } as ConnectionOf<K>;
    }
    if (jira.username && jira.apiToken) {
      return {
        kind: "jira",
        baseUrl: jira.url,
        username: jira.username,
        token: jira.apiToken,
      } as ConnectionOf<K>;
    }
  }
  return undefined;
}

/**
 * One resolver, three sources, in order: the browser's request connections,
 * the product's env reference, and for Default only the global `.env`.
 * Undefined means the capability is off. Never cached: credentials are read
 * per call so they cannot end up in an agent closure or cache key.
 */
export function resolveConnection<K extends ConnectionKind>(
  product: ResolvedProduct,
  kind: K,
  conns: readonly Connection[] = currentConnections(),
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConnection<K> | undefined {
  const browser = conns.find((conn) => conn.kind === kind) as ConnectionOf<K> | undefined;
  if (browser) return { source: "browser", connection: browser };

  if (!product.isDefault) {
    if (product.connectionSources[kind] === "browser") return undefined;
    const fromEnv = envConnection(product, kind, env);
    return fromEnv ? { source: "env", connection: fromEnv } : undefined;
  }

  const fromDefault = defaultConnection(product, kind, env);
  return fromDefault ? { source: "default", connection: fromDefault } : undefined;
}

// --- outbound safety ---------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLoopbackName(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase()) || /^127\./.test(host);
}

/** Bound to a public address or running as production: browser connections need an allowlist. */
export function isLocalDeployment(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return !config.host || isLoopbackName(config.host);
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inV4Range(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/**
 * Link-local and cloud metadata stay blocked everywhere. Private ranges are
 * allowed on purpose: real internal databases live there.
 */
export function isBlockedAddress(address: string): boolean {
  const lower = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  const v4 = mapped ? mapped[1] : isIP(lower) === 4 ? lower : undefined;
  if (v4) {
    return inV4Range(v4, "169.254.0.0", 16) || inV4Range(v4, "0.0.0.0", 8);
  }
  if (isIP(lower) === 6) {
    if (lower === "fd00:ec2::254") return true;
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
    if (lower === "::") return true;
  }
  return false;
}

export class OutboundBlockedError extends HttpError {
  constructor(message: string) {
    super(400, `Connection rejected: ${message}`);
    this.name = "OutboundBlockedError";
  }
}

export type PinnedHost = { hostname: string; address: string; family: 4 | 6 };

type Lookup = (hostname: string) => Promise<{ address: string; family: number }[]>;

const systemLookup: Lookup = (hostname) => lookup(hostname, { all: true, verbatim: true });

function allowedSchemes(kind: ConnectionKind, hostname: string): string[] {
  if (kind === "postgres") return ["postgres:", "postgresql:"];
  const dev = process.env.NODE_ENV !== "production" && isLoopbackName(hostname);
  return dev ? ["https:", "http:"] : ["https:"];
}

/** Exact names, or `*.example.com` for any subdomain (not the apex itself). */
export function hostAllowed(hostname: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) =>
    entry.startsWith("*.") ? hostname.endsWith(entry.slice(1)) : entry === hostname,
  );
}

/**
 * Checks a user-entered URL and resolves its host once. Callers connect to
 * the returned address, not the name: checking and then letting the driver
 * resolve again is open to DNS rebinding.
 */
export async function pinOutbound(
  rawUrl: string,
  kind: ConnectionKind,
  resolve: Lookup = systemLookup,
): Promise<PinnedHost> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OutboundBlockedError("not a valid URL.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname) throw new OutboundBlockedError("the URL has no host.");
  if (!allowedSchemes(kind, hostname).includes(url.protocol)) {
    throw new OutboundBlockedError(
      kind === "postgres"
        ? "use a postgresql:// URL."
        : "use https:// (http:// is allowed for localhost in development only).",
    );
  }

  const allowed = config.connections.allowedHosts;
  if (!isLocalDeployment() && allowed.length === 0) {
    throw new OutboundBlockedError(
      "browser connections are off on a hosted backend. Set SA_CONNECTION_ALLOWED_HOSTS.",
    );
  }
  if (allowed.length > 0 && !hostAllowed(hostname, allowed)) {
    throw new OutboundBlockedError(`${hostname} is not in SA_CONNECTION_ALLOWED_HOSTS.`);
  }

  const literal = isIP(hostname);
  const addresses = literal
    ? [{ address: hostname, family: literal }]
    : await resolve(hostname).catch(() => {
        throw new OutboundBlockedError(`${hostname} does not resolve.`);
      });
  if (addresses.length === 0) throw new OutboundBlockedError(`${hostname} does not resolve.`);
  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new OutboundBlockedError(`${hostname} points at a link-local or metadata address.`);
  }
  const first = addresses[0];
  return { hostname, address: first.address, family: first.family === 6 ? 6 : 4 };
}

function outboundUrl(conn: Connection): string | undefined {
  if (conn.kind === "postgres") return conn.url;
  if (conn.kind === "confluence" || conn.kind === "jira") return conn.baseUrl;
  return undefined;
}

/**
 * Rejects a request whose connections point anywhere the outbound rules
 * forbid, before any agent work starts. Each call site pins again at connect
 * time, so this is an early 400, not the only check.
 */
export async function assertConnectionsAllowed(
  conns: readonly Connection[],
  resolve: Lookup = systemLookup,
): Promise<void> {
  for (const conn of conns) {
    const url = outboundUrl(conn);
    if (url) await pinOutbound(url, conn.kind, resolve);
  }
}

// --- scrubbing ---------------------------------------------------------------

export function secretValues(conns: readonly Connection[]): string[] {
  const values: string[] = [];
  for (const conn of conns) {
    if (conn.kind === "postgres") {
      values.push(conn.url);
      try {
        const url = new URL(conn.url);
        if (url.password) {
          values.push(url.password, decodeURIComponent(url.password));
        }
      } catch {
        /* the URL itself is already in the list */
      }
    } else if ("token" in conn && conn.token) {
      values.push(conn.token);
    }
  }
  return [...new Set(values.filter((value) => value.length >= 4))].sort(
    (a, b) => b.length - a.length,
  );
}

/**
 * Removes every secret value and every URL userinfo from text that leaves the
 * process: tool errors, connection-test details, log lines.
 */
export function scrubSecrets(
  text: string,
  conns: readonly Connection[] = currentConnections(),
): string {
  let out = text;
  for (const value of secretValues(conns)) {
    out = out.split(value).join("[redacted]");
  }
  return out.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*(?::[^\s/@]*)?@/gi, "$1[redacted]@");
}
