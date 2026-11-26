import { NextResponse, type NextRequest } from "next/server";

const AGENT_API = process.env.NEXT_PUBLIC_AGENT_API ?? "http://localhost:5001";

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Browser-held connections live in this origin's storage, so scripts are
 * nonce-only: an injected script cannot run and read them. Styles keep
 * 'unsafe-inline' for framer-motion's inline styles. `headers()` in
 * next.config.ts only adds the static headers; a static export host must
 * serve an equivalent policy itself.
 */
function connectSources(apiUrl: string, isDev: boolean): string {
  const origins = new Set<string>(["'self'"]);
  const origin = originOf(apiUrl);
  if (origin) {
    origins.add(origin);
    try {
      const url = new URL(origin);
      const port = url.port ? `:${url.port}` : "";
      if (url.hostname === "localhost") origins.add(`${url.protocol}//127.0.0.1${port}`);
      if (url.hostname === "127.0.0.1") origins.add(`${url.protocol}//localhost${port}`);
    } catch {
      // Keep the parsed origin only.
    }
  }
  if (isDev) {
    origins.add("ws:");
    origins.add("wss:");
  }
  return [...origins].join(" ");
}

export function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  const connect = connectSources(AGENT_API, isDev);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|assets|logo).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
