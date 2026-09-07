import { AGENT_API, VAULT_TOKEN } from "@/lib/api";
import { type GatewayModel, type GatewayQuota } from "./types";

interface GatewayEnvelope {
  ok: boolean;
  error?: string;
  models?: GatewayModel[];
  quota?: GatewayQuota;
}

/**
 * Same optional bearer the chat and vault calls send. These routes accept an
 * anonymous read today, but passing it keeps them working if the backend ever
 * puts the quota route behind `requireAuth`.
 */
async function gatewayRequest(path: string): Promise<GatewayEnvelope> {
  const headers = new Headers();
  if (VAULT_TOKEN) headers.set("Authorization", `Bearer ${VAULT_TOKEN}`);

  const res = await fetch(`${AGENT_API}/v1/gateway${path}`, {
    headers,
    cache: "no-store",
  });

  let json: GatewayEnvelope;
  try {
    json = (await res.json()) as GatewayEnvelope;
  } catch {
    throw new Error(`Gateway request failed (${res.status})`);
  }
  if (!json.ok) {
    throw new Error(json.error || `Gateway request failed (${res.status})`);
  }
  return json;
}

export const gatewayService = {
  listModels: async (): Promise<GatewayModel[]> => {
    return (await gatewayRequest("/models")).models ?? [];
  },

  getQuota: async (): Promise<GatewayQuota | null> => {
    return (await gatewayRequest("/quota")).quota ?? null;
  },
};
