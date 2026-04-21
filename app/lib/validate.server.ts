// RFC 5322-ish pragmatic regex. Shopify will do its own validation if this
// flows onward to a customer record; our job here is to reject garbage before
// it lands in the DB, not to be a mail-server.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 320 && EMAIL_RE.test(value);
}

export function isLikelyShopDomain(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(value);
}
