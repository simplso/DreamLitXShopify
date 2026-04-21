import crypto from "node:crypto";

// Verify a Shopify App Proxy signature.
//
// Algorithm (per shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies):
//   1. Pull `signature` out of the query params.
//   2. For each remaining param: `key=value` (multi-values joined by `,`).
//   3. Sort entries lexicographically by the joined string.
//   4. Concatenate with EMPTY delimiter (unlike OAuth, which uses `&`).
//   5. HMAC-SHA256(appSecret, message) → HEX digest.
//   6. Constant-time compare against `signature`.
//
// `@shopify/shopify-app-remix` exposes `authenticate.public.appProxy(request)`
// which does this for us. We keep this module because the direct-API route
// (which does NOT flow through Shopify's proxy) still needs a way to assert
// that the caller knows the shared secret, and because being able to verify
// manually is useful for tests and for any non-Remix runtime.
export function verifyAppProxySignature(
  url: URL,
  appSecret: string,
): { valid: boolean; shop: string | null } {
  const params = new URLSearchParams(url.search);
  const signature = params.get("signature");
  if (!signature) return { valid: false, shop: null };
  params.delete("signature");

  const grouped = new Map<string, string[]>();
  for (const [k, v] of params.entries()) {
    const arr = grouped.get(k) ?? [];
    arr.push(v);
    grouped.set(k, arr);
  }

  const message = [...grouped.entries()]
    .map(([k, vs]) => `${k}=${vs.join(",")}`)
    .sort()
    .join("");

  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(message)
    .digest("hex");

  const valid = safeEqualHex(expected, signature);
  return { valid, shop: params.get("shop") };
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
