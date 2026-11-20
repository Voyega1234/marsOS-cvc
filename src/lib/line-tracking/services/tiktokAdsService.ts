import { createHash } from "crypto";
import type { TiktokAdsConfig } from "@/lib/line-tracking/connectors";
import type { SendContext, SendResult } from "./senderTypes";

/**
 * Build a TikTok Events API payload. Uses ttclid captured on the tracking page.
 * No raw PII: external_id is the hashed pseudonymous LINE user id.
 */
export function buildTiktokPayload(config: TiktokAdsConfig, ctx: SendContext) {
  const { lead, eventName, value, currency } = ctx;
  const externalId = lead.lineUserId
    ? createHash("sha256").update(lead.lineUserId).digest("hex")
    : undefined;

  return {
    event_source: "web",
    event_source_id: config.pixelId ?? "MOCK_EVENT_SET",
    data: [
      {
        event: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: `lead.${lead.id}.${eventName}`,
        user: {
          ttclid: lead.ttclid ?? undefined,
          external_id: externalId ? [externalId] : undefined,
        },
        properties: {
          currency,
          value,
          order_id: lead.purchaseId || lead.id,
        },
      },
    ],
  };
}

const TIKTOK_TRACK_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

/**
 * Send to TikTok Events API. REAL send when pixelId + accessToken present;
 * otherwise mock. TikTok returns { code: 0 } on success (non-zero = error).
 */
export async function sendTiktok(
  config: TiktokAdsConfig,
  ctx: SendContext
): Promise<SendResult> {
  const request = buildTiktokPayload(config, ctx);
  const real = !!(config.pixelId && config.accessToken);

  if (!real) {
    return {
      ok: true,
      mock: true,
      request,
      response: { note: "TikTok Events API mock mode — no credentials", code: 0 },
    };
  }

  try {
    const res = await fetch(TIKTOK_TRACK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Access-Token": config.accessToken!,
      },
      body: JSON.stringify(request),
    });
    const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
    const ok = res.ok && json.code === 0;
    return {
      ok,
      mock: false,
      request,
      response: { status: res.status, ...json },
      error: ok ? undefined : json.message || `TikTok responded code ${json.code} (${res.status})`,
    };
  } catch (err) {
    return {
      ok: false,
      mock: false,
      request,
      response: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
