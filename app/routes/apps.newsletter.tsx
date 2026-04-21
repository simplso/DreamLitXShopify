import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { ingestNewsletter } from "../lib/ingest.server";
import { rateLimit, keyFor } from "../lib/rate-limit.server";
import { clientIp, headersToObject, readAnyBody } from "../lib/request.server";
import { log } from "../lib/logger.server";

// App Proxy endpoint.
//
// Shopify rewrites storefront requests like
//   https://{shop}.myshopify.com/apps/dreamlit/newsletter
// to this app's URL, appending the signed query params (shop, timestamp,
// path_prefix, signature, ...). `authenticate.public.appProxy` verifies the
// signature for us — the request is rejected before the handler body runs if
// it's not legit.
//
// Why a POST (action) AND a GET (loader): loader lets you sanity-check the
// route is reachable from the storefront; action is the real work.
//
// Why the file is called `apps.newsletter.tsx`: Remix flat-routes maps this
// to `/apps/newsletter`, which matches the default app-proxy `subpath_prefix`
// of `apps` in shopify.app.toml. The storefront-facing URL ends up as
// `/apps/<your_subpath>/newsletter` (merchant-configurable), and Shopify
// proxies it here as `/apps/newsletter`.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  return json({ ok: true, endpoint: "app-proxy:newsletter" });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // `authenticate.public.appProxy` throws a 401 Response if HMAC fails. If it
  // returns, we can trust `session?.shop` or `url.searchParams.get("shop")`.
  const { session } = await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const shop = session?.shop ?? url.searchParams.get("shop");
  if (!shop) {
    return json({ error: "missing_shop" }, { status: 400 });
  }

  const ip = clientIp(request);
  const rl = rateLimit(keyFor(shop, ip), { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    log.warn("rate limited", { shop, ip, route: "app-proxy" });
    return json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
  }

  const body = await readAnyBody(request);
  const outcome = await ingestNewsletter({
    shop,
    route: "app-proxy",
    ip,
    headers: headersToObject(request.headers),
    raw: body,
  });

  switch (outcome.kind) {
    case "created":
    case "updated":
      return json({ ok: true, status: outcome.kind, id: outcome.id }, { status: 200 });
    case "empty_payload":
      return json({ ok: false, error: "empty_payload" }, { status: 400 });
    case "invalid_email":
      return json({ ok: false, error: "invalid_email" }, { status: 400 });
    case "honeypot_tripped":
      // Deliberately lie — we don't want bots to learn whether the honeypot
      // fired. 200 + fake ID is enough to make them stop retrying.
      return json({ ok: true, status: "created", id: "noop" }, { status: 200 });
  }
};
