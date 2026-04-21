// Minimal sliding-window rate limiter.
//
// Uses an in-process Map so it works on a single serverless instance without
// Redis. Good enough for a newsletter-capture endpoint that sees bursty-but-
// modest traffic. If you deploy to multiple concurrent instances, swap this
// for Upstash Ratelimit (@upstash/ratelimit) — the call site only needs the
// same { allowed, remaining, resetAt } shape.
//
// Why a sliding window and not a token bucket: submissions are human-paced;
// a 60-second window with a low cap is both easy to reason about and a decent
// spam damper.

type Hit = { count: number; windowStart: number };

const buckets = new Map<string, Hit>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  bucket.count += 1;
  const allowed = bucket.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.windowStart + windowMs,
  };
}

// Derive a rate-limit key from what the proxy gave us. IP is best-effort —
// behind Shopify's proxy `X-Forwarded-For` is populated but multiple clients
// behind a single NAT would share a bucket. Combining with shop domain keeps
// buckets per-store.
export function keyFor(shop: string | null, ip: string | null): string {
  return `${shop ?? "unknown"}:${ip ?? "unknown"}`;
}
