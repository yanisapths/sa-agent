"use client";

import { useGateway } from "@/features/gateway/GatewayProvider";
import { type GatewayQuota } from "@/features/gateway/types";

interface UseQuota {
  quota: GatewayQuota | null;
  status: "loading" | "ready" | "error";
  error: string | null;
  /** Re-read the budget, e.g. once a chat turn has settled. */
  refresh: () => void;
}

/**
 * The virtual key's budget. The backend caches this for 30s, so calling
 * `refresh` after every turn is cheap; a turn that costs less than a cent may
 * not move the number until the cache expires.
 */
export function useQuota(): UseQuota {
  const { quota, quotaState, quotaError, refreshQuota } = useGateway();
  return {
    quota,
    status: quotaState,
    error: quotaError,
    refresh: refreshQuota,
  };
}
