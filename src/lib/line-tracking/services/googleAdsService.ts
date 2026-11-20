import type { GoogleAdsConfig } from "@/lib/line-tracking/connectors";
import type { SendContext, SendResult } from "./senderTypes";

const GOOGLE_ADS_API_VERSION = "v17";

/** Format a Date as Google Ads expects: "yyyy-MM-dd HH:mm:ss+00:00" (UTC). */
function adsDateTime(d: Date): string {
  const iso = d.toISOString(); // 2026-07-01T10:20:30.000Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}+00:00`;
}

/**
 * Build a Google Ads Offline Conversion Import payload (Click Conversions).
 * Uses gclid captured on the tracking page.
 */
export function buildGoogleAdsPayload(config: GoogleAdsConfig, ctx: SendContext) {
  const { lead, eventName, value, currency } = ctx;
  const conversionAction =
    config.customerId && config.conversionActionId
      ? `customers/${config.customerId}/conversionActions/${config.conversionActionId}`
      : "MOCK_CONVERSION_ACTION";
  return {
    customerId: config.customerId ?? "MOCK_CUSTOMER",
    conversions: [
      {
        gclid: lead.gclid ?? null,
        conversionAction,
        conversionActionName: eventName,
        conversionDateTime: adsDateTime(new Date()),
        conversionValue: value,
        currencyCode: currency,
        orderId: lead.purchaseId || lead.id,
      },
    ],
    partialFailure: true,
  };
}

/** Exchange an OAuth2 refresh token for a short-lived access token. */
async function refreshAccessToken(config: GoogleAdsConfig): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.oauthClientId!,
      client_secret: config.oauthClientSecret!,
      refresh_token: config.refreshToken!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google Ads OAuth refresh failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("No access_token from Google OAuth");
  return json.access_token;
}

function hasFullOAuth(config: GoogleAdsConfig): boolean {
  return !!(
    config.developerToken &&
    config.customerId &&
    config.conversionActionId &&
    config.oauthClientId &&
    config.oauthClientSecret &&
    config.refreshToken
  );
}

/**
 * Send to Google Ads. REAL upload when full OAuth2 credentials are present,
 * otherwise mock. Requires a gclid on the lead for click-conversion upload.
 */
export async function sendGoogleAds(
  config: GoogleAdsConfig,
  ctx: SendContext
): Promise<SendResult> {
  const request = buildGoogleAdsPayload(config, ctx);

  // Not enough credentials for a real upload → mock (payload still logged).
  if (!hasFullOAuth(config)) {
    return {
      ok: true,
      mock: true,
      request,
      response: {
        note: config.developerToken
          ? "Google Ads mock — เพิ่ม OAuth Client/Secret/RefreshToken เพื่อยิงจริง"
          : "Google Ads mock mode — no credentials",
        accepted: true,
      },
    };
  }

  if (!ctx.lead.gclid) {
    return {
      ok: false,
      mock: false,
      request,
      response: null,
      error: "ไม่มี gclid สำหรับ Lead นี้ ส่ง Google Ads ไม่ได้",
    };
  }

  try {
    const accessToken = await refreshAccessToken(config);
    const url =
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}` +
      `/customers/${config.customerId}:uploadClickConversions`;

    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
      "developer-token": config.developerToken!,
    };
    if (config.loginCustomerId) headers["login-customer-id"] = config.loginCustomerId;

    const body = {
      conversions: [
        {
          gclid: ctx.lead.gclid,
          conversionAction: `customers/${config.customerId}/conversionActions/${config.conversionActionId}`,
          conversionDateTime: adsDateTime(new Date()),
          conversionValue: ctx.value,
          currencyCode: ctx.currency,
          orderId: ctx.lead.purchaseId || ctx.lead.id,
        },
      ],
      partialFailure: true,
    };

    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as {
      partialFailureError?: { message?: string };
      error?: { message?: string };
    };
    const failMsg = json.partialFailureError?.message || json.error?.message;
    const ok = res.ok && !failMsg;
    return {
      ok,
      mock: false,
      request: body,
      response: { status: res.status, ...json },
      error: ok ? undefined : failMsg || `Google Ads responded ${res.status}`,
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