import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { ingestNewsletter } from "../lib/ingest.server";
import { rateLimit, keyFor } from "../lib/rate-limit.server";
import { clientIp, headersToObject, readAnyBody } from "../lib/request.server";
import { isLikelyShopDomain } from "../lib/validate.server";
import { log } from "../lib/logger.server";

// Direct API endpoint (fallback / non-storefront use).
//
// Use this when:
//   - The caller is NOT going through Shopify's app proxy (e.g. a headless
//     storefront, a landing page on a separate domain, a server job).
//   - You want to curl it for testing.
//
// Authentication model: shared bearer token (`INGEST_API_TOKEN`). App Proxy
// is preferred because Shopify signs requests for free; this endpoint exists
// for the cases the proxy can't cover.
//
// CORS is permissive on purpose: the goal is "any form on any domain can post
// here" for the store whose token is known. The token is the real gate.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Shop-Domain",
  "Access-Control-Max-Age": "86400",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return json({ ok: true, endpoint: "direct:newsletter" }, { headers: CORS_HEADERS });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const token = process.env.INGEST_API_TOKEN;
  if (!token) {
    log.error("INGEST_API_TOKEN not configured");
    return json({ error: "server_misconfigured" }, { status: 500, headers: CORS_HEADERS });
  }

  const authz = request.headers.get("authorization") || "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7) : null;
  if (!bearer || !timingSafeEqualStr(bearer, token)) {
    return json({ error: "unauthorized" }, { status: 401, headers: CORS_HEADERS });
  }

  // Caller is expected to identify the shop either via header or payload.
  const headerShop = request.headers.get("x-shop-domain");
  const body = await readAnyBody(request);
  const bodyShop = typeof body.shop === "string" ? body.shop : null;
  const shop = headerShop || bodyShop;
  if (!shop || !isLikelyShopDomain(shop)) {
    return json({ error: "missing_or_invalid_shop" }, { status: 400, headers: CORS_HEADERS });
  }

  const ip = clientIp(request);
  const rl = rateLimit(keyFor(shop, ip), { limit: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return json({ error: "rate_limited" }, { status: 429, headers: { ...CORS_HEADERS, "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
  }

  const outcome = await ingestNewsletter({
    shop,
    route: "direct-api",
    ip,
    headers: headersToObject(request.headers),
    raw: body,
  });

  switch (outcome.kind) {
    case "created":
    case "updated":
      return json({ ok: true, status: outcome.kind, id: outcome.id }, { headers: CORS_HEADERS });
    case "empty_payload":
      return json({ ok: false, error: "empty_payload" }, { status: 400, headers: CORS_HEADERS });
    case "invalid_email":
      return json({ ok: false, error: "invalid_email" }, { status: 400, headers: CORS_HEADERS });
    case "honeypot_tripped":
      return json({ ok: true, status: "created", id: "noop" }, { headers: CORS_HEADERS });
  }
};

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
