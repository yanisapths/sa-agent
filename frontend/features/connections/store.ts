import {
  CONNECTION_KINDS,
  MAX_CONNECTIONS_HEADER_BYTES,
  type Connection,
  type ConnectionKind,
} from "@/lib/connection";

/**
 * Browser-held credentials for one product, under `sa-conn:<productId>`.
 *
 * - `device`: AES-GCM with a non-extractable key kept in IndexedDB. Stops a
 *   storage dump or copy-paste; a script on the page can still decrypt.
 * - `session`: sessionStorage, gone when the tab closes.
 * - `passphrase`: AES-GCM with a PBKDF2 key that is never stored. Unlocked
 *   once per tab; a forgotten passphrase means entering the values again.
 *
 * Connector kinds are stored in clear so the UI can say "DB locked" without
 * decrypting. Values never are.
 */
export type StorageMode = "device" | "session" | "passphrase";

export const STORAGE_MODES: readonly { id: StorageMode; label: string }[] = [
  { id: "device", label: "This device" },
  { id: "session", label: "This session only" },
  { id: "passphrase", label: "This device + passphrase" },
];

export type StoredConnections =
  | { status: "empty" }
  | { status: "locked"; mode: "passphrase"; kinds: ConnectionKind[] }
  | { status: "ready"; mode: StorageMode; connections: Connection[] };

type Sealed = { iv: string; data: string };
type Entry =
  | { v: 1; mode: "device"; kinds: ConnectionKind[]; sealed: Sealed }
  | { v: 1; mode: "passphrase"; kinds: ConnectionKind[]; salt: string; sealed: Sealed }
  | { v: 1; mode: "session"; kinds: ConnectionKind[]; connections: Connection[] };

const PREFIX = "sa-conn:";
const PBKDF2_ITERATIONS = 310_000;
const DB_NAME = "sa-connections";
const DB_STORE = "keys";
const DEVICE_KEY = "device";

const storageKey = (productId: string) => `${PREFIX}${productId}`;

/** Passphrase keys live only in memory for this tab. */
const unlocked = new Map<string, { key: CryptoKey; salt: string }>();
const listeners = new Set<(productId: string) => void>();

export function subscribeConnections(listener: (productId: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(productId: string): void {
  for (const listener of listeners) listener(productId);
}

// --- encoding -----------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

// --- keys ---------------------------------------------------------------------

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}

function idb<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(DB_STORE, mode).objectStore(DB_STORE));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

let deviceKeyPromise: Promise<CryptoKey> | null = null;

/** Generated once, non-extractable: the raw key bytes never reach script. */
function deviceKey(): Promise<CryptoKey> {
  deviceKeyPromise ??= (async () => {
    const db = await openKeyDb();
    try {
      const existing = await idb<CryptoKey | undefined>(db, "readonly", (store) => store.get(DEVICE_KEY));
      if (existing) return existing;
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]);
      await idb(db, "readwrite", (store) => store.put(key, DEVICE_KEY));
      return key;
    } finally {
      db.close();
    }
  })().catch((err: unknown) => {
    deviceKeyPromise = null;
    throw err;
  });
  return deviceKeyPromise;
}

async function passphraseKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function seal(key: CryptoKey, connections: readonly Connection[]): Promise<Sealed> {
  const iv = randomBytes(12);
  const plain = new TextEncoder().encode(JSON.stringify(connections));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  return { iv: toBase64(iv), data: toBase64(data) };
}

async function open(key: CryptoKey, sealed: Sealed): Promise<Connection[]> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(sealed.iv) },
    key,
    fromBase64(sealed.data),
  );
  return parseConnectionArray(JSON.parse(new TextDecoder().decode(plain)));
}

// --- storage --------------------------------------------------------------------

function isKind(value: unknown): value is ConnectionKind {
  return typeof value === "string" && (CONNECTION_KINDS as readonly string[]).includes(value);
}

function parseConnectionArray(value: unknown): Connection[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Connection =>
      typeof item === "object" && item !== null && isKind((item as { kind?: unknown }).kind),
  );
}

function readEntry(productId: string): Entry | null {
  try {
    const raw =
      window.sessionStorage.getItem(storageKey(productId)) ??
      window.localStorage.getItem(storageKey(productId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry;
    return entry && entry.v === 1 ? entry : null;
  } catch {
    return null;
  }
}

function removeEntry(productId: string): void {
  try {
    window.localStorage.removeItem(storageKey(productId));
  } catch {
    // Storage disabled: nothing was persisted.
  }
  try {
    window.sessionStorage.removeItem(storageKey(productId));
  } catch {
    // Storage disabled: nothing was persisted.
  }
}

export async function loadConnections(productId: string): Promise<StoredConnections> {
  const entry = readEntry(productId);
  if (!entry) return { status: "empty" };
  try {
    if (entry.mode === "session") {
      return { status: "ready", mode: "session", connections: parseConnectionArray(entry.connections) };
    }
    if (entry.mode === "device") {
      return { status: "ready", mode: "device", connections: await open(await deviceKey(), entry.sealed) };
    }
    const held = unlocked.get(productId);
    if (!held || held.salt !== entry.salt) {
      return { status: "locked", mode: "passphrase", kinds: entry.kinds.filter(isKind) };
    }
    return { status: "ready", mode: "passphrase", connections: await open(held.key, entry.sealed) };
  } catch {
    // A key that no longer matches (cleared IndexedDB) cannot be recovered.
    return entry.mode === "passphrase"
      ? { status: "locked", mode: "passphrase", kinds: entry.kinds.filter(isKind) }
      : { status: "empty" };
  }
}

/** Throws "Wrong passphrase." when decryption fails. */
export async function unlockConnections(productId: string, passphrase: string): Promise<Connection[]> {
  const entry = readEntry(productId);
  if (!entry || entry.mode !== "passphrase") return [];
  const key = await passphraseKey(passphrase, fromBase64(entry.salt));
  let connections: Connection[];
  try {
    connections = await open(key, entry.sealed);
  } catch {
    throw new Error("Wrong passphrase.");
  }
  unlocked.set(productId, { key, salt: entry.salt });
  notify(productId);
  return connections;
}

export async function saveConnections(
  productId: string,
  connections: readonly Connection[],
  mode: StorageMode,
  passphrase?: string,
): Promise<void> {
  if (connections.length === 0) {
    clearConnections(productId);
    return;
  }
  const kinds = connections.map((conn) => conn.kind);
  let entry: Entry;
  if (mode === "session") {
    entry = { v: 1, mode, kinds, connections: [...connections] };
  } else if (mode === "device") {
    entry = { v: 1, mode, kinds, sealed: await seal(await deviceKey(), connections) };
  } else {
    const current = readEntry(productId);
    let held = unlocked.get(productId);
    if (passphrase) {
      const salt = randomBytes(16);
      held = { key: await passphraseKey(passphrase, salt), salt: toBase64(salt) };
    } else if (!held || current?.mode !== "passphrase" || held.salt !== current.salt) {
      throw new Error("Enter a passphrase to encrypt these connections.");
    }
    entry = { v: 1, mode, kinds, salt: held.salt, sealed: await seal(held.key, connections) };
    unlocked.set(productId, held);
  }

  removeEntry(productId);
  const target = mode === "session" ? window.sessionStorage : window.localStorage;
  try {
    target.setItem(storageKey(productId), JSON.stringify(entry));
  } catch {
    throw new Error("This browser blocks storage, so connections cannot be saved.");
  }
  notify(productId);
}

export function clearConnections(productId: string): void {
  removeEntry(productId);
  unlocked.delete(productId);
  notify(productId);
}

// --- transport ----------------------------------------------------------------------

/** Plain HTTP is fine only on this machine; anything else must be HTTPS. */
export function canSendConnections(apiUrl: string): boolean {
  try {
    const url = new URL(apiUrl);
    if (url.protocol === "https:") return true;
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

/** base64url(JSON), the format `parseConnections` on the backend expects. */
export function encodeConnectionsHeader(connections: readonly Connection[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(connections));
  const encoded = toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (encoded.length > MAX_CONNECTIONS_HEADER_BYTES) {
    throw new Error("These connections are too large to send. Remove one and try again.");
  }
  return encoded;
}
