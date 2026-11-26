import { createHash } from "crypto";
import type { MicrosoftAdsConfig } from "@/lib/line-tracking/connectors";
import type { SendContext, SendResult } from "./senderTypes";

// Microsoft Advertising Conversions API (CAPI).
// Docs: https://learn.microsoft.com/en-us/advertising/guides/uet-conversion-api-integration
//   POST https://capi.uet.microsoft.com/v1/{tagId}/events
//   Authorization: Bearer <UET tag API token>
// NOT the Campaign Management ApplyOfflineConversions operation — that one is
// SOAP-only and cannot be called with a JSON body.
const MICROSOFT_CAPI = "https://capi.uet.microsoft.com/v1";

/**
 * CAPI only takes an msclkid that is a UUID, written WITHOUT hyphens — which is how
 * Microsoft puts it on the landing URL (32 hex characters). Accept both spellings
 * and always send the bare 32 characters.
 */
export function cleanMsclkid(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const bare = raw.trim().replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(bare) ? bare : undefined;
}

/**
 * Build a Microsoft CAPI custom event. Matches on msclkid (Microsoft's click
 * id, the Bing equivalent of gclid); externalId carries the pseudonymous LINE
 * user id so events from the same person can be tied together.
 */
export function buildMicrosoftPayload(config: MicrosoftAdsConfig, ctx: SendContext) {
  const { lead, eventName, value, currency } = ctx;
  const lineUserId = lead.lineUserId;
  const msclkid = cleanMsclkid(lead.msclkid);
  return {
    data: [
      {
        eventType: "custom",
        // Shared with any UET JavaScript event for the same conversion so
        // Microsoft can de-duplicate instead of counting it twice.
        eventId: `lead.${lead.id}.${eventName}`.slice(0, 256),
        eventName: config.conversionName || eventName,
        eventTime: Math.floor(Date.now() / 1000),
        userData: {
          msclkid,
          externalId: lineUserId
            ? createHash("sha256").update(lineUserId).digest("hex")
            : undefined,
        },
        customData: {
          value,
          currency,
          transactionId: lead.purchaseId || lead.id,
        },
      },
    ],
    continueOnValidationError: false,
    dataProvider: "marsos",
  };
}

/**
 * Send to Microsoft Ads. REAL when a UET Tag ID + CAPI token are configured.
 * Every event needs at least one identifier, so a lead with neither an msclkid
 * nor a LINE user id is reported as a failure rather than sent and dropped.
 */
export async function sendMicrosoft(
  config: MicrosoftAdsConfig,
  ctx: SendContext
): Promise<SendResult> {
  const request = buildMicrosoftPayload(config, ctx);
  const real = !!(config.tagId && config.apiToken);

  // A project that still holds the old offline-conversion keys had real credentials:
  // never fall back to mock for it, tell the team to reconnect.
  if (!real && (config.customerId || config.developerToken || config.accessToken)) {
    return {
      ok: false,
      mock: false,
      request,
      response: null,
      error: "Microsoft Ads เปลี่ยนวิธีเชื่อมต่อแล้ว ใส่ UET Tag ID และ Conversions API Token ใหม่ในหน้าเชื่อมต่อ",
    };
  }

  if (!real) {
    return {
      ok: true,
      mock: true,
      request,
      response: { note: "Microsoft Ads mock mode · ยังไม่ได้ใส่ UET Tag ID / Conversions API Token", accepted: true },
    };
  }

  const userData = request.data[0].userData;
  if (!userData.msclkid && !userData.externalId) {
    return {
      ok: false,
      mock: false,
      request,
      response: null,
      error: ctx.lead.msclkid
        ? "msclkid ของ Lead นี้ไม่ใช่รูปแบบ UUID (ตัวเลขฐานสิบหก 32 ตัว) Microsoft CAPI ไม่รับ"
        : "Lead นี้ไม่มี msclkid และไม่มี LINE user id Microsoft CAPI ต้องมี identifier อย่างน้อย 1 ตัว",
    };
  }

  try {
    const res = await fetch(`${MICROSOFT_CAPI}/${encodeURIComponent(config.tagId!)}/events`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    return {
      ok: res.ok,
      mock: false,
      request,
      response: { status: res.status, ...json },
      error: res.ok
        ? undefined
        : res.status === 401
          ? "Microsoft ปฏิเสธ token ตรวจว่า Conversions API Token ออกมาจาก UET Tag ID เดียวกันนี้"
          : json.error?.message || `Microsoft CAPI ตอบกลับ ${res.status}`,
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
