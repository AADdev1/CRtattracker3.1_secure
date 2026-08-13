import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// Applied to every response this server returns, on any host (Node,
// Vercel, Cloudflare, on-prem, ...) — set here rather than in
// platform-specific config since the deployment target isn't fixed.
// script-src/connect-src are deliberately narrow: the app loads no
// external fonts/scripts/CDNs, the only outside origin it ever talks to
// is this project's own Supabase instance.
const SUPABASE_ORIGIN = process.env.SUPABASE_URL ?? "";

function securityHeaders(): Record<string, string> {
  const wsOrigin = SUPABASE_ORIGIN.replace(/^http/, "ws");
  return {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    // M6 — pages render CR/KPI/test-case/security-report data; browser
    // disk cache and back-forward cache must not retain it on a shared
    // device. withSecurityHeaders() below only sets a header when the
    // response doesn't already have one, so a static asset response that
    // already carries its own long-lived Cache-Control (hashed filenames)
    // is untouched — this only lands on responses with none set.
    "Cache-Control": "no-store, must-revalidate",
    Pragma: "no-cache",
    "Content-Security-Policy": [
      "default-src 'self'",
      // 'unsafe-inline' is required here: TanStack Start emits an inline
      // hydration bootstrap script ($tsr-stream-barrier) directly in the
      // document — without this, the browser refuses to run it and the
      // app never hydrates (blank page). connect-src/frame-ancestors etc.
      // below stay fully restrictive; this is the one necessary loosening.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      // Storage origin added for test result screenshots — signed URLs
      // served from this project's own Supabase Storage bucket
      // (test-result-screenshots), the first feature that ever needed to
      // render an image from outside the app's own origin.
      `img-src 'self' data: ${SUPABASE_ORIGIN}`,
      "font-src 'self' data:",
      `connect-src 'self' ${SUPABASE_ORIGIN} ${wsOrigin}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  };
}

// Additive only — never overrides a header the app already set on this
// specific response.
function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(securityHeaders())) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
