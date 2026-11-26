import { type ConnectionKind } from "@/lib/connection";

import { type CapabilityKey, type Product } from "./types";

export type CapabilityState = "on" | "off" | "locked";

export type EffectiveCapabilities = Record<CapabilityKey, CapabilityState>;

const BROWSER_BACKED: Partial<Record<CapabilityKey, ConnectionKind>> = {
  db: "postgres",
  docs: "confluence",
};

/**
 * The server only knows env-backed connectors; a browser connection turns the
 * capability on for this tab. A locked passphrase entry is shown as locked,
 * not off, so the user knows to unlock rather than reconnect.
 */
export function effectiveCapabilities(
  product: Product | null,
  browserKinds: readonly ConnectionKind[],
  isLocked: boolean,
): EffectiveCapabilities {
  const result: EffectiveCapabilities = { db: "off", docs: "off", schemaIndex: "off", repos: "off" };
  if (!product) return result;
  for (const key of Object.keys(result) as CapabilityKey[]) {
    if (product.capabilities[key]) {
      result[key] = "on";
      continue;
    }
    const kind = BROWSER_BACKED[key];
    if (!kind || product.connectionSources[kind] === "env") continue;
    if (browserKinds.includes(kind)) result[key] = isLocked ? "locked" : "on";
  }
  return result;
}
