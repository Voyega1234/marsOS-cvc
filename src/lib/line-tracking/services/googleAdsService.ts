import type { GoogleAdsConfig } from "@/lib/line-tracking/connectors";
import type { SendContext, SendResult } from "./senderTypes";

// Google Ads sunsets each API version about a year after release, and a call to
// a sunset version fails outright. Override via env when Google moves on, so a
// version bump never needs a code deploy.
export const GOOGLE_ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v25";

/** Format a Date as Google Ads expects: "yyyy-MM-dd HH:mm:ss+00:00" (UTC). */
function adsDateTime(d: Date): string {
  const iso = d.toISOString(); // 2026-07-01T10:20:30.000Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}+00:00`;
}

/**
 * The click id the conversion is keyed on. Google rejects a conversion that carries more
 * than one of gclid / gbraid / wbraid, so exactly one is returned (gclid first).
 */
function googleClickId(ctx: SendContext): { gclid: string } | { gbraid: string } | { wbraid: string } | null {
  if (ctx.lead.gclid) return { gclid: ctx.lead.gclid };
  if (ctx.click?.gbraid) return { gbraid: ctx.click.gbraid };
  if (ctx.click?.wbraid) return { wbraid: ctx.click.wbraid };
  return null;
}

/**
 * Build a Google Ads Offline Conversion Import payload (Click Conversions).
 * Uses gclid (else gbraid, else wbraid) captured on the tracking page.
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
        ...(googleClickId(ctx) ?? { gclid: null }),
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
 * Read-only credential check. Asks Google Ads to look up the configured
 * conversion action — that single call exercises every credential a real
 * upload needs (OAuth refresh, developer token, customer id, conversion
 * action id, MCC header) without spending a conversion.
 */
export async function testGoogleAds(
  config: GoogleAdsConfig
): Promise<{ ok: boolean; message: string }> {
  if (!hasFullOAuth(config)) {
    return { ok: false, message: "ยังกรอก credentials ไม่ครบ ต้องมี Customer ID, Conversion Action ID, Developer Token และ OAuth ทั้ง 3 ค่า" };
  }
  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(config);
  } catch (err) {
    // Google's OAuth error body can carry client detail — log it, don't show it.
    console.error("[googleAdsService] testGoogleAds refresh failed", err);
    return { ok: false, message: "OAuth ใช้ไม่ได้ ตรวจ Client ID / Client Secret / Refresh Token (refresh token หมดอายุถ้าไม่ได้ใช้นาน)" };
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
    "developer-token": config.developerToken!,
  };
  if (config.loginCustomerId) headers["login-customer-id"] = config.loginCustomerId;

  try {
    const url =
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}` +
      `/customers/${encodeURIComponent(config.customerId!)}/googleAds:searchStream`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query:
          "SELECT conversion_action.id, conversion_action.name, conversion_action.status " +
          `FROM conversion_action WHERE conversion_action.id = ${Number(config.conversionActionId)}`,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error("[googleAdsService] testGoogleAds search failed", { status: res.status, body: text.slice(0, 500) });
      if (res.status === 404) {
        return { ok: false, message: `Google Ads ไม่รู้จัก API version ${GOOGLE_ADS_API_VERSION} · ตั้ง env GOOGLE_ADS_API_VERSION เป็นเวอร์ชันที่ยังรองรับ` };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "Google Ads ปฏิเสธสิทธิ์ ตรวจ Developer Token, Customer ID และถ้าเข้าผ่าน MCC ต้องใส่ Login Customer ID" };
      }
      return { ok: false, message: `Google Ads ตอบกลับ ${res.status} ตรวจ Customer ID และ Conversion Action ID` };
    }
    // searchStream returns an array of chunks; an empty result means the
    // conversion action id does not exist in this account.
    const name = /"name"\s*:\s*"([^"]+)"/.exec(text)?.[1];
    if (!name) {
      return { ok: false, message: `เชื่อมบัญชีได้ แต่ไม่พบ Conversion Action ID ${config.conversionActionId} ในบัญชีนี้` };
    }
    return { ok: true, message: `เชื่อม Google Ads สำเร็จ Conversion Action: ${name}` };
  } catch (err) {
    console.error("[googleAdsService] testGoogleAds threw", err);
    return { ok: false, message: "เชื่อม Google Ads ไม่สำเร็จ ตรวจ Customer ID, Developer Token และการเชื่อมต่อเครือข่าย" };
  }
}

/**
 * Send to Google Ads. REAL upload when full OAuth2 credentials are present,
 * otherwise mock. Requires a gclid / gbraid / wbraid on the lead for click-conversion upload.
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

  const clickId = googleClickId(ctx);
  if (!clickId) {
    return {
      ok: false,
      mock: false,
      request,
      response: null,
      error: "ไม่มี gclid / gbraid / wbraid สำหรับ Lead นี้ ส่ง Google Ads ไม่ได้",
    };
  }

  try {
    const accessToken = await refreshAccessToken(config);
    const url =
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}` +
      `/customers/${encodeURIComponent(config.customerId!)}:uploadClickConversions`;

    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
      "developer-token": config.developerToken!,
    };
    if (config.loginCustomerId) headers["login-customer-id"] = config.loginCustomerId;

    const body = {
      conversions: [
        {
          ...clickId,
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