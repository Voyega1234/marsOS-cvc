import type { LineAdsConfig } from "@/lib/line-tracking/connectors";
import type { SendContext, SendResult } from "./senderTypes";

/**
 * LINE Ads Platform (LAP) conversion payload. LAP matches conversions via the
 * LINE Tag / click; server-side we key off the pseudonymous LINE user id.
 */
export function buildLineAdsPayload(config: LineAdsConfig, ctx: SendContext) {
  const { lead, eventName, value, currency } = ctx;
  return {
    tagId: config.tagId ?? "MOCK_LINE_TAG",
    events: [
      {
        event: eventName,
        line_user_id: lead.lineUserId ?? null,
        value,
        currency,
        order_id: lead.purchaseId || lead.id,
        event_time: Math.floor(Date.now() / 1000),
      },
    ],
  };
}

/**
 * Send to LINE Ads Platform. MVP: mock unless credentials present.
 * TODO(real): LAP Conversion API — POST with tagId + access token. Requires the
 * LINE Ads account + LINE Tag set up and the user matched via LINE Tag click id.
 */
export async function sendLineAds(
  config: LineAdsConfig,
  ctx: SendContext
): Promise<SendResult> {
  const request = buildLineAdsPayload(config, ctx);
  const real = !!(config.tagId && config.accessToken);

  if (!real) {
    return {
      ok: true,
      mock: true,
      request,
      response: { note: "LINE Ads (LAP) mock mode — no credentials", accepted: true },
    };
  }

  // REAL: LINE Ads Platform Conversion API. NOTE(verify): LAP's server-side
  // conversion endpoint/format is confirmed on first live connect (tagId +
  // access token). Sends the built events payload.
  try {
    const res = await fetch("https://conversion.line-apps.com/v1/conversion", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const ok = res.ok;
    return {
      ok, mock: false, request,
      response: { status: res.status, ...json },
      error: ok ? undefined : `LINE Ads responded ${res.status}`,
    };
  } catch (err) {
    return { ok: false, mock: false, request, response: null, error: err instanceof Error ? err.message : String(err) };
  }
}
