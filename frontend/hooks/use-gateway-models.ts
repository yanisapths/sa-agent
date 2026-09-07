"use client";

import { useEffect, useState } from "react";
import { gatewayService } from "@/features/gateway/service";
import { type GatewayModel } from "@/features/gateway/types";

/**
 * The models this virtual key can reach. An empty list means the gateway is
 * unreachable or unconfigured; the picker hides itself and `/chat` falls back
 * to the backend's configured default, which is the behaviour before this
 * existed.
 */
export function useGatewayModels(): GatewayModel[] {
  const [models, setModels] = useState<GatewayModel[]>([]);

  useEffect(() => {
    let cancelled = false;
    void gatewayService
      .listModels()
      .then((data) => {
        if (!cancelled) setModels(data);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return models;
}
