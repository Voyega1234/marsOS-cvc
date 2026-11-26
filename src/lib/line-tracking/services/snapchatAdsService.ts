import { createHash } from "crypto";
import type { SnapchatAdsConfig } from "@/lib/line-tracking/connectors";
import { absoluteHttpUrl } from "@/lib/line-tracking/browserIds";
import type { SendContext, SendResult } from "./senderTypes";

/**
 * Snapchat Conversions API payload. Matches via sc_click_id (scclid) captured
 * on the landing page.
 */
export function buildSnapchatPayload(config: SnapchatAdsConfig, ctx: SendContext) {
  const { lead, eventName, value, currency, click } = ctx;
  // http(s) only, and capped: these values came from the visitor's browser.
  const sourceUrl = absoluteHttpUrl(click?.landingUrl);
  return {
    pixelId: config.pixelId ?? "MOCK_PIXEL",
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        // A visit with a known landing page is a web event; without one it stays offline.
        action_source: sourceUrl ? "WEB" : "OFFLINE",
        event_source_url: sourceUrl,
        user_data: {
          sc_click_id: lead.scclid ?? undefined,
          // _scid = the browser id Snapchat's pixel set on the customer's website.
          sc_cookie1: click?.scid ?? undefined,
          client_user_agent: click?.userAgent ? click.userAgent.slice(0, 500) : undefined,
          external_id: lead.lineUserId
            ? createHash("sha256").update(lead.lineUserId).digest("hex")
            : undefined,
        },
        custom_data: { currency, value, order_id: lead.purchaseId || lead.id },
      },
    ],
  };
}

/**
 * Send to Snapchat. REAL when a pixel id + access token are configured.
 */
export async function sendSnapchat(
  config: SnapchatAdsConfig,
  ctx: SendContext
): Promise<SendResult> {
  const request = buildSnapchatPayload(config, ctx);
  const real = !!(config.pixelId && config.accessToken);

  if (!real) {
    return {
      ok: true, mock: true, request,
      response: { note: "Snapchat Ads mock mode — no credentials", accepted: true },
    };
  }

  // REAL: Snapchat Conversions API v3.
  // https://developers.snap.com/marketing-api/Conversions-API/UsingTheAPI
  // The access token is a QUERY PARAMETER on this API, not a bearer header,
  // and a successful response is {"status":"VALID"}.
  try {
    const url =
      `https://tr.snapchat.com/v3/${encodeURIComponent(config.pixelId!)}/events` +
      `?access_token=${encodeURIComponent(config.accessToken!)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: (request as { data: unknown[] }).data }),
    });
    const json = (await res.json().catch(() => ({}))) as { status?: string; reason?: string };
    const ok = res.ok && json.status !== "ERROR" && json.status !== "INVALID";
    return {
      ok, mock: false, request,
      response: { status: res.status, ...json },
      error: ok
        ? undefined
        : res.status === 401 || res.status === 403
          ? "Snapchat ปฏิเสธ Access Token ออก token ใหม่ใน Snapchat Business (Events Manager)"
          : json.reason || `Snapchat ตอบกลับ ${res.status}`,
    };
  } catch (err) {
    return { ok: false, mock: false, request, response: null, error: err instanceof Error ? err.message : String(err) };
  }
}
