"use client";

import { useCallback, useEffect, useState } from "react";
import { gatewayService } from "@/features/gateway/service";
import { type GatewayQuota } from "@/features/gateway/types";

interface UseQuota {
  quota: GatewayQuota | null;
  /** Re-read the budget, e.g. once a chat turn has settled. */
  refresh: () => void;
}

/**
 * The virtual key's budget. The backend caches this for 30s, so calling
 * `refresh` after every turn is cheap; a turn that costs less than a cent may
 * not move the number until the cache expires.
 */
export function useQuota(): UseQuota {
  const [quota, setQuota] = useState<GatewayQuota | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    void gatewayService
      .getQuota()
      .then((data) => {
        if (!cancelled) setQuota(data);
      })
      .catch(() => {
        if (!cancelled) setQuota(null);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { quota, refresh };
}
