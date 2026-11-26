"use client";

import { useGateway } from "@/features/gateway/GatewayProvider";
import { type GatewayModel } from "@/features/gateway/types";

/**
 * The models this virtual key can reach. An empty list means the gateway is
 * unreachable or unconfigured; the picker still shows "Default model" so the
 * control does not vanish from the chrome.
 */
export function useGatewayModels(): GatewayModel[] {
  return useGateway().models;
}
