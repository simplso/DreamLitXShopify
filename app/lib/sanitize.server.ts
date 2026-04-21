// Input hygiene for dynamic form payloads.
//
// Newsletter forms can carry anything merchants add. We don't try to validate
// schema — that defeats the point. We just:
//   - trim strings
//   - cap string length so a bad actor can't shove a novel into our DB
//   - drop non-JSON-serializable values
//   - block known footgun keys (prototype pollution)
//   - recursively apply to nested objects/arrays (depth-limited)
//
// This runs BEFORE we split into (email, meta, rawPayload). The rawPayload
// is sanitized too — it's meant for debugging, not a forensic byte-mirror.

const MAX_STRING_LEN = 2048;
const MAX_DEPTH = 4;
const MAX_KEYS_PER_OBJECT = 64;
const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export function sanitize(value: unknown, depth = 0): Json {
  if (depth > MAX_DEPTH) return null;

  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > MAX_STRING_LEN ? trimmed.slice(0, MAX_STRING_LEN) : trimmed;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.slice(0, MAX_KEYS_PER_OBJECT).map((v) => sanitize(v, depth + 1));
  }

  if (typeof value === "object") {
    const out: { [k: string]: Json } = {};
    let count = 0;
    for (const [k, v] of Object.entries(value)) {
      if (BLOCKED_KEYS.has(k)) continue;
      if (count >= MAX_KEYS_PER_OBJECT) break;
      out[k] = sanitize(v, depth + 1);
      count += 1;
    }
    return out;
  }

  return null;
}

// Shopify forms arrive as `contact[first_name]=Jane&contact[tags]=vip&...`.
// After form-decoding we end up with either nested { contact: { first_name } }
// or flat { "contact[first_name]": "Jane" }. This collapses both shapes into
// a flat, snake_case map so downstream code doesn't have to branch.
export function flattenContactFields(input: Record<string, Json>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(input)) {
    const bracket = k.match(/^([a-z_]+)\[([a-z0-9_]+)\]$/i);
    if (bracket) {
      out[bracket[2].toLowerCase()] = v;
      continue;
    }
    if (k === "contact" && v && typeof v === "object" && !Array.isArray(v)) {
      for (const [ik, iv] of Object.entries(v)) out[ik.toLowerCase()] = iv as Json;
      continue;
    }
    out[k.toLowerCase()] = v;
  }
  return out;
}
