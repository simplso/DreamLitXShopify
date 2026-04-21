// Best-effort IP + raw-body helpers. Node runtime only.

export function clientIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || null;
  return request.headers.get("x-real-ip") || null;
}

export function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    // Drop Shopify-internal auth headers — we log, not leak.
    if (k.toLowerCase() === "authorization") return;
    if (k.toLowerCase() === "cookie") return;
    out[k] = v;
  });
  return out;
}

// Parse a request body that may be JSON, form-urlencoded, or multipart form.
// Returns a plain object — route code never has to branch on Content-Type.
export async function readAnyBody(request: Request): Promise<Record<string, unknown>> {
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const txt = await request.text();
    if (!txt) return {};
    try {
      const parsed = JSON.parse(txt);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { value: parsed };
    } catch {
      return {};
    }
  }
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const fd = await request.formData();
    const out: Record<string, unknown> = {};
    fd.forEach((v, k) => {
      const existing = out[k];
      const val = typeof v === "string" ? v : v.name;
      if (existing === undefined) out[k] = val;
      else if (Array.isArray(existing)) (existing as unknown[]).push(val);
      else out[k] = [existing, val];
    });
    return out;
  }
  // Fallback: try JSON.
  const txt = await request.text();
  if (!txt) return {};
  try {
    const parsed = JSON.parse(txt);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return {};
  }
}
