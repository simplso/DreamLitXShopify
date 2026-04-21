import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { ingestNewsletter } from "../lib/ingest.server";
import { headersToObject } from "../lib/request.server";
import { log } from "../lib/logger.server";

// Optional: `customers/create` webhook.
//
// Shopify fires this when a customer is created by ANY path — storefront
// signup, admin, draft order, another app. Because newsletter signups with
// `{% form 'customer' %}` also materialize as customers (with
// accepts_marketing=true), this webhook is a belt-and-suspenders capture for
// the case where the app proxy route isn't wired up yet but the merchant
// still wants the data in our DB.
//
// To enable, subscribe in shopify.app.toml:
//   [[webhooks.subscriptions]]
//   topics = ["customers/create"]
//   uri = "/webhooks/customers/create"
//
// HMAC verification is handled by `authenticate.webhook(request)` — no need
// to manually use our verifyWebhookHmac helper.

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  log.info("webhook received", { topic, shop });

  // Payload shape: the full Customer REST resource.
  // Fields we care about today: email, first_name, last_name, phone, tags,
  // accepts_marketing, email_marketing_consent, sms_marketing_consent,
  // marketing_opt_in_level. Everything else rides in rawPayload.
  const p = payload as Record<string, unknown>;

  // Skip customers who don't have marketing consent — they came in via admin
  // or checkout, not via a newsletter form. Merchants can flip this rule by
  // removing the check.
  const consented =
    p.accepts_marketing === true ||
    (typeof p.email_marketing_consent === "object" &&
      p.email_marketing_consent !== null &&
      (p.email_marketing_consent as Record<string, unknown>).state === "subscribed");

  if (!consented) {
    return new Response(null, { status: 200 });
  }

  await ingestNewsletter({
    shop,
    route: "webhook:customers/create",
    ip: null,
    headers: headersToObject(request.headers),
    raw: p,
  });

  return new Response(null, { status: 200 });
};
