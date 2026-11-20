import type { MicrosoftAdsConfig } from "@/lib/line-tracking/connectors";
import type { SendContext, SendResult } from "./senderTypes";

/**
 * Microsoft (Bing) Ads offline conversion payload. Matches via msclkid captured
 * on the landing page (same idea as Google Ads gclid).
 */
export function buildMicrosoftPayload(config: MicrosoftAdsConfig, ctx: SendContext) {
  const { lead, eventName, value, currency } = ctx;
  return {
    customerId: config.customerId ?? "MOCK_CUSTOMER",
    offlineConversions: [
      {
        microsoftClickId: lead.msclkid ?? null,
        conversionName: config.conversionName || eventName,
        conversionTime: new Date().toISOString(),
        conversionValue: value,
        conversionCurrencyCode: currency,
      },
    ],
  };
}

/**
 * Send to Microsoft Ads. MVP: mock unless credentials present.
 * TODO(real): Bing Ads Campaign Management API ApplyOfflineConversions with
 * OAuth2 + developer token; requires msclkid on the lead.
 */
export async function sendMicrosoft(
  config: MicrosoftAdsConfig,
  ctx: SendContext
): Promise<SendResult> {
  const request = buildMicrosoftPayload(config, ctx);
  const real = !!(config.developerToken && config.customerId && config.accessToken);

  if (!real) {
    return {
      ok: true,
      mock: true,
      request,
      response: { note: "Microsoft/Bing Ads mock mode — no credentials", accepted: true },
    };
  }
  if (!ctx.lead.msclkid) {
    return {
      ok: false, mock: true, request, response: null,
      error: "ไม่มี msclkid สำหรับ Lead นี้ ส่ง Microsoft Ads ไม่ได้",
    };
  }

  // REAL: Bing Ads Campaign Management — ApplyOfflineConversions.
  // NOTE(verify): Bing Ads API needs OAuth2 (MSA) + developer token headers;
  // provide the OAuth access token as `accessToken`. Endpoint/format confirmed
  // on first live connect.
  try {
    const res = await fetch(
      `https://campaign.api.bingads.microsoft.com/CampaignManagement/v13/OfflineConversions/Apply`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.accessToken}`,
          DeveloperToken: config.developerToken!,
          CustomerAccountId: config.customerId!,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          OfflineConversions: (request as { offlineConversions: unknown[] }).offlineConversions,
        }),
      }
    );
    const json = (await res.json().catch(() => ({}))) as { PartialErrors?: unknown[] };
    const ok = res.ok && !(json.PartialErrors && json.PartialErrors.length);
    return {
      ok, mock: false, request,
      response: { status: res.status, ...json },
      error: ok ? undefined : `Microsoft Ads responded ${res.status}`,
    };
  } catch (err) {
    return { ok: false, mock: false, request, response: null, error: err instanceof Error ? err.message : String(err) };
  }
}
