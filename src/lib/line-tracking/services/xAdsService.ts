import type { XAdsConfig } from "@/lib/line-tracking/connectors";
import type { SendContext, SendResult } from "./senderTypes";

// X Ads Conversion API: POST /{version}/measurement/conversions/{pixel_id}.
// Docs: https://docs.x.com/x-ads-api/measurement/web-conversions
// X bumps the Ads API version roughly yearly, so keep it overridable by env.
export const X_ADS_API_VERSION = process.env.X_ADS_API_VERSION || "12";

/**
 * X (Twitter) Ads conversion payload. Matches via twclid captured on landing.
 *
 * The documented identifiers are twclid, hashed_email, hashed_phone_number and
 * ip_address+user_agent. There is no external-id identifier, so a LINE user id
 * has nothing to map onto here — a lead without a twclid cannot be matched.
 */
export function buildXPayload(config: XAdsConfig, ctx: SendContext) {
  const { lead, eventName, value, currency } = ctx;
  const identifiers: Record<string, unknown>[] = [];
  if (lead.twclid) identifiers.push({ twclid: lead.twclid });
  return {
    pixelId: config.pixelId ?? "MOCK_PIXEL",
    conversions: [
      {
        event_id: config.eventId || eventName,
        conversion_time: new Date().toISOString(),
        identifiers,
        // X documents the amount as a string and the currency as `price_currency`.
        value: typeof value === "number" ? String(value) : undefined,
        price_currency: currency || undefined,
        conversion_id: lead.purchaseId || lead.id,
      },
    ],
  };
}

/**
 * Send to X Ads. REAL when a pixel id + access token are configured.
 */
export async function sendX(config: XAdsConfig, ctx: SendContext): Promise<SendResult> {
  const request = buildXPayload(config, ctx);
  const real = !!(config.pixelId && config.accessToken);

  if (!real) {
    return {
      ok: true, mock: true, request,
      response: { note: "X (Twitter) Ads mock mode — no credentials", accepted: true },
    };
  }

  // Every event needs at least one identifier and twclid is the only one we
  // can supply, so say that plainly instead of sending an unmatched event.
  if (!request.conversions[0].identifiers.length) {
    return {
      ok: false,
      mock: false,
      request,
      response: null,
      error: "Lead นี้ไม่มี twclid X Ads จับคู่ conversion ไม่ได้",
    };
  }

  // The Ads API authorises with OAuth 1.0a user context; a plain bearer token
  // works only for tokens minted for this endpoint, so a 401 says which.
  try {
    const res = await fetch(`https://ads-api.x.com/${X_ADS_API_VERSION}/measurement/conversions/${encodeURIComponent(config.pixelId!)}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ conversions: (request as { conversions: unknown[] }).conversions }),
    });
    const json = (await res.json().catch(() => ({}))) as { errors?: unknown };
    const ok = res.ok && !(json as { errors?: unknown }).errors;
    return {
      ok, mock: false, request,
      response: { status: res.status, ...json },
      error: ok
        ? undefined
        : res.status === 401 || res.status === 403
          ? "X ปฏิเสธ Access Token X Ads API ต้องใช้ OAuth 1.0a user context และผู้ใช้ต้องมีสิทธิ์ AD_MANAGER ขึ้นไป"
          : `X Ads ตอบกลับ ${res.status}`,
    };
  } catch (err) {
    return { ok: false, mock: false, request, response: null, error: err instanceof Error ? err.message : String(err) };
  }
}
