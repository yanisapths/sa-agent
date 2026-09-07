import { AGENT_API, VAULT_TOKEN } from "@/lib/api";

export type NotificationSoundKind = "pending" | "ready";

export async function fetchNotificationSound(
  kind: NotificationSoundKind,
): Promise<string> {
  const headers = new Headers();
  if (VAULT_TOKEN) headers.set("Authorization", `Bearer ${VAULT_TOKEN}`);

  const res = await fetch(`${AGENT_API}/v1/sounds/${kind}`, {
    headers,
    cache: "no-store",
  });

  if (!res.ok) {
    let message = `Sound request failed (${res.status})`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      // Keep the status message.
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
