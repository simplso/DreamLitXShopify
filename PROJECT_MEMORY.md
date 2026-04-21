# DreamLitxSimplSo — Project Memory

Local, project-scoped notes. Keep this in sync as the code evolves. This file
is for humans and future AI sessions reopening the repo — it captures the
"why" behind the code, not the what (the code itself is the what).

---

## What this app does

A Shopify-installed app that captures newsletter form submissions — from any
storefront, from any form, with any set of fields — into a Supabase Postgres
database via Prisma. Future-proof to Shopify adding new fields because
everything beyond `(shop, email)` is stored in a Json column.

## How data flows

```
┌───────────────────────────┐   POST /apps/dreamlit/newsletter  (signed by Shopify)
│ Storefront theme snippet  │ ──────────────────────────────────▶  App Proxy route
│ theme/snippets/           │                                      app/routes/apps.newsletter.tsx
│  dreamlit-newsletter.liquid                                              │
└───────────────────────────┘                                              ▼
                                                                    ingestNewsletter()
                                                                    app/lib/ingest.server.ts
                                                                           │
                                            ┌──────────────────────────────┼───────────────────────────┐
                                            ▼                              ▼                           ▼
                                  NewsletterSubmission              RawPayloadLog                  stdout log
                                  (shop, email UNIQUE)              (every request,                (structured JSON)
                                  meta: Json                         success or reject)
                                  rawPayload: Json
```

Parallel paths that land on the same ingest:

- **App Proxy** (preferred) — `/apps/dreamlit/newsletter`, Shopify signs the
  request. Route: `apps.newsletter.tsx`.
- **Direct API** (fallback) — `/api/newsletter`, bearer-token auth. For
  headless storefronts, separate landing pages, server-to-server. Route:
  `api.newsletter.tsx`.
- **Webhook fallback** — `customers/create` fires whenever a customer
  materializes with marketing consent. Route: `webhooks.customers.create.tsx`.
  Belt-and-suspenders: even if the theme snippet isn't installed, anyone who
  signs up via Shopify's native `{% form 'customer' %}` is still captured.

## Schema decisions (why it looks the way it does)

- `NewsletterSubmission.meta: Json` holds known-but-not-columnized fields
  (first_name, last_name, phone, tags, accepts_marketing, custom_*). Not a
  column per field because Shopify's contact form accepts arbitrary
  `contact[any_field]` inputs and we never want a migration for a new one.
- `NewsletterSubmission.rawPayload: Json` is the whole request body after
  sanitization. Separate from `meta` so we can replay or forensic-inspect
  what the theme actually sent.
- `(shop, email)` unique constraint — repeat signups update the row rather
  than duplicate. If email is missing (some custom forms allow this), we
  insert a new row every time since dedupe has no key.
- `RawPayloadLog` is a separate table on purpose. Retention differs
  (submissions are business data, raw logs are debugging) and we don't want
  a rejected submission to fail the whole request cycle or pollute the main
  table.

## Shopify MCP facts used to build this

Verified against shopify-dev-mcp on 2026-04-21. Cite these when changing
anything — don't re-derive from memory.

- **Newsletter form canonical shape**: `{% form 'customer' %}` POSTs to
  `/contact#contact_form` with required `<input type="email"
  name="contact[email]">`. Hidden fields `form_type=customer` and `utf8=✓`
  are auto-added by Shopify. Custom `contact[*]` fields are forwarded.
  Source: https://shopify.dev/docs/storefronts/themes/customer-engagement/email-consent

- **App Proxy HMAC (hex, empty delimiter)**:
  1. Strip `signature` from query.
  2. Each remaining param: `key=value` (multi-values joined with `,`).
  3. Sort lexicographically.
  4. Concatenate with empty string (NOT `&` — this is the OAuth gotcha).
  5. HMAC-SHA256(app_secret, message) → hex digest.
  6. Constant-time compare.
  Source: https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies

- **Webhook HMAC (base64)**:
  - Header: `X-Shopify-Hmac-SHA256`
  - HMAC-SHA256(app_secret, raw request bytes) → base64 digest.
  - Raw body must be captured BEFORE JSON parse.
  Source: https://shopify.dev/docs/apps/build/webhooks/subscribe/https

- In Remix, `@shopify/shopify-app-remix` exposes
  `authenticate.public.appProxy(request)` and `authenticate.webhook(request)`
  which implement both verifications. Our code uses those; the hand-rolled
  helpers in `app/lib/app-proxy.server.ts` / `webhook.server.ts` exist as a
  reference and for non-Remix callers.

## Security posture

- App Proxy route: Shopify signs the request, we verify via
  `authenticate.public.appProxy`.
- Direct API route: bearer token (`INGEST_API_TOKEN`) + shop-domain
  allowlist (`*.myshopify.com`).
- Rate limit: 10/min per (shop, IP) on proxy, 20/min on direct API. In-proc
  Map; swap for Upstash if you scale horizontally.
- Honeypot: `website` hidden input. Populated → silent 200 (don't let bots
  learn they were caught).
- Sanitizer: cap string length, drop `__proto__`/`constructor` keys,
  depth-limited recursion. See `app/lib/sanitize.server.ts`.
- Scope: only `read_customers`. No write scopes — this app doesn't need them.

## Deploy checklist

Status as of 2026-04-21:

- [x] Supabase project created; pooled (6543) and direct (5432) URLs in `.env`.
  - Note: use `.env` (NOT `.env.local`) — Prisma and Remix both read `.env`;
    Shopify CLI also writes to `.env` on `shopify app dev`. Consolidating
    avoids split-brain config.
- [x] `npx prisma migrate dev --name init` applied. Migration
  `20260421085954_init` creates `Session`, `NewsletterSubmission`,
  `RawPayloadLog` in the Supabase `public` schema.
- [x] Prisma client regenerated (v6.19.3).
- [x] Supabase agent skills installed to `.claude/skills/` (`supabase`,
  `supabase-postgres-best-practices`) via `npx skills add
  supabase/agent-skills --agent claude-code`. Load after Claude Code reload.
- [ ] `INGEST_API_TOKEN` set in `.env` (only needed if using the direct-API
  route; `openssl rand -hex 32`).
- [ ] `shopify app dev` — first run links to Partner app, auto-populates
  `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL` in `.env`.
  Must run in a real terminal (interactive Partner login — this sandbox
  can't reach `accounts.shopify.com`).
- [ ] `shopify app deploy` — pushes `[app_proxy]` + webhook subs + scopes
  to the Partner dashboard.
- [ ] Install on test store; copy `theme/snippets/dreamlit-newsletter.liquid`
  into the theme; `{% render 'dreamlit-newsletter', source: 'footer' %}`.
- [ ] Smoke-test: submit form → check Supabase → `NewsletterSubmission` +
  `RawPayloadLog` rows appear.
- [ ] Vercel: set all env vars in project settings, `vercel --prod`. Remix 2
  runs on Vercel with the default preset.

## Known non-issues / diagnostics

- Prisma VS Code extension (v31+) flags `datasource.url` and
  `datasource.directUrl` as "no longer supported". This is a Prisma 7
  preview warning.
  - We can't move to Prisma 7 yet: `@shopify/shopify-app-session-storage-
    prisma` up through v9.0.0 still peer-depends on `prisma@^6.19.0` and
    `@prisma/client@^6.19.0`. Forcing Prisma 7 would break session storage
    at runtime (PrismaClient constructor signature change) — an override
    workaround doesn't exist for constructor-level API changes.
  - Prisma 6 (our pinned version, runtime 6.19.3) fully supports both
    fields. Proof: `prisma migrate dev --name init` applied successfully
    against Supabase on 2026-04-21.
  - Action when upstream ships: upgrade both packages together, migrate
    URLs to `prisma.config.ts` per https://pris.ly/d/config-datasource,
    switch to a driver adapter (`@prisma/adapter-pg` for Postgres).
  - Build + type-check are green today; this is purely an IDE squiggle.

## Open questions / decisions deferred

- Should the direct-API route require HMAC over the body (not just bearer)?
  Currently bearer-only because the use case is server-to-server with a
  shared secret. Upgrade to HMAC if we ever expose it on a public page.
- Should we push captures to Klaviyo / Mailchimp? Out of scope v1; the
  `NewsletterSubmission` table is designed so an outbound worker can stream
  rows to any ESP later.
- Retention on `RawPayloadLog`: not yet enforced. Suggest a scheduled
  Supabase function to delete rows older than 30 days once volume grows.
