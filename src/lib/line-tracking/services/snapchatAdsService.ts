import { createHash } from "crypto";
import type { SnapchatAdsConfig } from "@/lib/line-tracking/connectors";
import type { SendContext, SendResult } from "./senderTypes";

/**
 * Snapchat Conversions API payload. Matches via sc_click_id (scclid) captured
 * on the landing page.
 */
export function buildSnapchatPayload(config: SnapchatAdsConfig, ctx: SendContext) {
  const { lead, eventName, value, currency } = ctx;
  return {
    pixelId: config.pixelId ?? "MOCK_PIXEL",
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "OFFLINE",
        user_data: {
          sc_click_id: lead.scclid ?? undefined,
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
 * Send to Snapchat. MVP: mock unless credentials present.
 * TODO(real): Snapchat Conversions API v3 — POST /v3/{pixelId}/events with token.
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

  // REAL: Snapchat Conversions API (v3). Bearer token + { data: [...] }.
  try {
    const res = await fetch(`https://tr.snapchat.com/v3/${config.pixelId}/events`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ data: (request as { data: unknown[] }).data }),
    });
    const json = (await res.json().catch(() => ({}))) as { status?: string; error?: unknown };
    const ok = res.ok && json.status !== "ERROR";
    return {
      ok, mock: false, request,
      response: { status: res.status, ...json },
      error: ok ? undefined : `Snapchat responded ${res.status}`,
    };
  } catch (err) {
    return { ok: false, mock: false, request, response: null, error: err instanceof Error ? err.message : String(err) };
  }
}
