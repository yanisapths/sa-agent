import http from "node:http";
import https from "node:https";
import type { PinnedHost } from "./connections";

export type OutboundResponse = { status: number; statusText: string; body: string };

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

/**
 * HTTP(S) for user-entered hosts. With `pin`, the socket goes to the address
 * that passed the outbound checks while TLS SNI and certificate checks still
 * use the original hostname, so a DNS answer that changes after the check
 * cannot redirect the request. Redirects are not followed: a 3xx to another
 * host would carry the token somewhere it was never entered for.
 */
export function requestText(
  rawUrl: string,
  init: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    pin?: PinnedHost;
    rejectUnauthorized?: boolean;
  } = {},
): Promise<OutboundResponse> {
  const url = new URL(rawUrl);
  const secure = url.protocol === "https:";
  const transport = secure ? https : http;
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.pin) headers.Host = url.host;
  if (init.body !== undefined) {
    headers["Content-Length"] = String(Buffer.byteLength(init.body));
  }

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        host: init.pin?.address ?? url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: init.method ?? "GET",
        headers,
        ...(init.pin?.family ? { family: init.pin.family } : {}),
        ...(secure
          ? {
              servername: url.hostname,
              rejectUnauthorized: init.rejectUnauthorized ?? true,
            }
          : {}),
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            req.destroy(new Error("Response too large."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? "",
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Request to ${url.hostname} timed out.`)));
    req.on("error", reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}
