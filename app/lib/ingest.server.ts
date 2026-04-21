import prisma from "../db.server";
import { flattenContactFields, sanitize, type Json } from "./sanitize.server";
import { isValidEmail } from "./validate.server";
import { log } from "./logger.server";

export type IngestOutcome =
  | { kind: "created"; id: string; email: string | null }
  | { kind: "updated"; id: string; email: string | null }
  | { kind: "empty_payload" }
  | { kind: "honeypot_tripped" }
  | { kind: "invalid_email" };

export interface IngestArgs {
  shop: string;
  route: string;
  ip: string | null;
  headers: Record<string, string>;
  raw: unknown;
}

// Single entry point used by every route (app proxy, direct API, customer
// webhook fallback). Handles:
//   - honeypot field (theme snippet sets `website` as a hidden input — any
//     value present = bot, drop silently)
//   - email extraction (optional; if absent we still record the submission)
//   - flatten nested `contact[*]` shapes
//   - upsert on (shop, email) when email is present, otherwise always insert
//   - writes a RawPayloadLog row for every call (success or reject) so we can
//     replay anything
export async function ingestNewsletter(args: IngestArgs): Promise<IngestOutcome> {
  const { shop, route, ip, headers, raw } = args;

  const sanitized = sanitize(raw) as Json;
  const payload = (sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)) ? (sanitized as Record<string, Json>) : {};

  const flat = flattenContactFields(payload);

  if (Object.keys(flat).length === 0) {
    await writeRawLog({ shop, route, ip, headers, body: payload, status: 400, errorCode: "empty_payload" });
    return { kind: "empty_payload" };
  }

  // Honeypot: a field the user can't see should never be filled.
  const honeypot = (flat["website"] ?? flat["url"] ?? flat["hp"]) as Json | undefined;
  if (typeof honeypot === "string" && honeypot.length > 0) {
    await writeRawLog({ shop, route, ip, headers, body: payload, status: 200, errorCode: "honeypot" });
    log.warn("honeypot tripped", { shop, route, ip });
    return { kind: "honeypot_tripped" };
  }

  const rawEmail = flat["email"];
  let email: string | null = null;
  if (typeof rawEmail === "string" && rawEmail.length > 0) {
    if (!isValidEmail(rawEmail)) {
      await writeRawLog({ shop, route, ip, headers, body: payload, status: 400, errorCode: "invalid_email" });
      return { kind: "invalid_email" };
    }
    email = rawEmail.toLowerCase();
  }

  // `meta` is everything minus email and honeypot; we retain unknowns on
  // purpose — any future Shopify form field lands here without migration.
  const meta = { ...flat };
  delete meta["email"];
  delete meta["website"];
  delete meta["url"];
  delete meta["hp"];
  delete meta["form_type"];
  delete meta["utf8"];

  const source = typeof flat["source"] === "string" ? (flat["source"] as string) : null;

  if (email) {
    const row = await prisma.newsletterSubmission.upsert({
      where: { shop_email_unique: { shop, email } },
      create: { shop, email, source, meta: meta as never, rawPayload: payload as never },
      update: {
        source: source ?? undefined,
        meta: meta as never,
        rawPayload: payload as never,
      },
    });
    await writeRawLog({ shop, route, ip, headers, body: payload, status: 200 });
    log.info("newsletter captured", { shop, route, id: row.id, hasEmail: true });
    return { kind: row.createdAt.getTime() === row.updatedAt.getTime() ? "created" : "updated", id: row.id, email };
  }

  const row = await prisma.newsletterSubmission.create({
    data: { shop, email: null, source, meta: meta as never, rawPayload: payload as never },
  });
  await writeRawLog({ shop, route, ip, headers, body: payload, status: 200 });
  log.info("newsletter captured", { shop, route, id: row.id, hasEmail: false });
  return { kind: "created", id: row.id, email: null };
}

async function writeRawLog(args: {
  shop: string | null;
  route: string;
  ip: string | null;
  headers: Record<string, string>;
  body: Record<string, Json>;
  status: number;
  errorCode?: string;
}) {
  try {
    await prisma.rawPayloadLog.create({
      data: {
        shop: args.shop,
        route: args.route,
        headers: args.headers as never,
        body: args.body as never,
        ip: args.ip,
        status: args.status,
        errorCode: args.errorCode,
      },
    });
  } catch (err) {
    log.error("raw log write failed", { err: (err as Error).message });
  }
}
