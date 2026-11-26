"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { type Connection, type ConnectionKind } from "@/lib/connection";

import {
  clearConnections,
  loadConnections,
  saveConnections,
  subscribeConnections,
  unlockConnections,
  type StorageMode,
  type StoredConnections,
} from "./store";

export type ConnectionsState = StoredConnections | { status: "loading" };

export interface UseConnections {
  state: ConnectionsState;
  /** Decrypted connections, empty while loading or locked. */
  connections: Connection[];
  /** Kinds present, known even while locked. */
  kinds: ConnectionKind[];
  isLocked: boolean;
  save: (connections: readonly Connection[], mode: StorageMode, passphrase?: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  clear: () => void;
}

/** Every instance for the same product stays in sync through the store's change events. */
export function useConnections(productId: string | null): UseConnections {
  const [loaded, setLoaded] = useState<{ productId: string; state: StoredConnections } | null>(null);

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    const load = () => {
      void loadConnections(productId).then((next) => {
        if (!cancelled) setLoaded({ productId, state: next });
      });
    };
    load();
    const unsubscribe = subscribeConnections((changed) => {
      if (changed === productId) load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [productId]);

  const save = useCallback(
    async (connections: readonly Connection[], mode: StorageMode, passphrase?: string) => {
      if (!productId) return;
      await saveConnections(productId, connections, mode, passphrase);
    },
    [productId],
  );

  const unlock = useCallback(
    async (passphrase: string) => {
      if (!productId) return;
      await unlockConnections(productId, passphrase);
    },
    [productId],
  );

  const clear = useCallback(() => {
    if (productId) clearConnections(productId);
  }, [productId]);

  // State loaded for another product is never returned, so a switch cannot leak its connections.
  const effective: ConnectionsState = useMemo(
    () =>
      !productId
        ? { status: "empty" }
        : loaded?.productId === productId
          ? loaded.state
          : { status: "loading" },
    [productId, loaded],
  );
  return useMemo(() => {
    const connections = effective.status === "ready" ? effective.connections : [];
    const kinds =
      effective.status === "ready"
        ? effective.connections.map((conn) => conn.kind)
        : effective.status === "locked"
          ? effective.kinds
          : [];
    return {
      state: effective,
      connections,
      kinds,
      isLocked: effective.status === "locked",
      save,
      unlock,
      clear,
    };
  }, [effective, save, unlock, clear]);
}
