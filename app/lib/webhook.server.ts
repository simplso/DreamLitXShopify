import crypto from "node:crypto";

// Verify a Shopify webhook HMAC.
//
// Differs from app-proxy verification in two critical ways:
//   - Digest is BASE64 (app-proxy is hex).
//   - HMAC input is the raw request body bytes, NOT a query string.
// The raw body must be captured BEFORE any JSON parsing. See
// https://shopify.dev/docs/apps/build/webhooks/subscribe/https
export function verifyWebhookHmac(
  rawBody: Buffer | string,
  hmacHeader: string | null,
  appSecret: string,
): boolean {
  if (!hmacHeader) return false;
  const bodyBuf = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const computed = crypto.createHmac("sha256", appSecret).update(bodyBuf).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, "base64"), Buffer.from(hmacHeader, "base64"));
  } catch {
    return false;
  }
}
