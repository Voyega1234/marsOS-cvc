import { createHash } from "crypto";
import type { XAdsConfig } from "@/lib/line-tracking/connectors";
import type { SendContext, SendResult } from "./senderTypes";

/**
 * X (Twitter) Ads conversion payload. Matches via twclid captured on landing.
 */
export function buildXPayload(config: XAdsConfig, ctx: SendContext) {
  const { lead, eventName, value, currency } = ctx;
  const identifiers: Record<string, unknown>[] = [];
  if (lead.twclid) identifiers.push({ twclid: lead.twclid });
  if (lead.lineUserId) {
    identifiers.push({ hashed_external_id: createHash("sha256").update(lead.lineUserId).digest("hex") });
  }
  return {
    pixelId: config.pixelId ?? "MOCK_PIXEL",
    conversions: [
      {
        event_id: config.eventId || eventName,
        conversion_time: new Date().toISOString(),
        identifiers,
        value,
        currency,
        conversion_id: lead.purchaseId || lead.id,
      },
    ],
  };
}

/**
 * Send to X Ads. MVP: mock unless credentials present.
 * TODO(real): X Ads Conversions API (Web Events) with OAuth2 + pixel/event id.
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

  // REAL: X Ads Conversion API. NOTE(verify): X historically requires OAuth 1.0a
  // signing; if your token is a bearer (OAuth2 app-only) this works, otherwise
  // we'll adjust the auth header on first live connect.
  try {
    const res = await fetch(`https://ads-api.x.com/12/measurement/conversions/${config.pixelId}`, {
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
      error: ok ? undefined : `X Ads responded ${res.status}`,
    };
  } catch (err) {
    return { ok: false, mock: false, request, response: null, error: err instanceof Error ? err.message : String(err) };
  }
}
