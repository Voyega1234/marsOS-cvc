import { createHash } from "crypto";
import type { MetaAdsConfig } from "@/lib/line-tracking/connectors";
import type { SendContext, SendResult } from "./senderTypes";
import { fbcFor } from "@/lib/line-tracking/browserIds";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/**
 * Meta ต้องการเบอร์แบบ "ตัวเลขล้วน + รหัสประเทศ ไม่มีเครื่องหมาย" ก่อน hash
 * ไม่งั้นจับคู่ไม่ติด — เบอร์ไทยที่ทีมกรอก (08x-xxx-xxxx) ต้องกลายเป็น 66xxxxxxxxx
 * คืน undefined เมื่อเบอร์สั้นเกินจนไม่น่าใช่เบอร์จริง จะได้ไม่ส่งขยะออกไป
 */
export function normalizePhoneForMeta(raw: string, defaultCountry = "66"): string | undefined {
  let d = raw.replace(/\D/g, "");
  if (!d) return undefined;
  if (raw.trim().startsWith("+")) return d.length >= 8 ? d : undefined;
  if (d.startsWith("0")) d = defaultCountry + d.slice(1); // 0812345678 → 66812345678
  else if (!d.startsWith(defaultCountry)) d = defaultCountry + d;
  return d.length >= 10 ? d : undefined;
}

/**
 * Build a Meta Conversions API (CAPI) payload. Uses fbclid → fbc format.
 * ไม่ส่งข้อมูลดิบ: external_id คือ LINE user id ที่ hash แล้ว และเบอร์โทร (ถ้าเปิด
 * สวิตช์ sendHashedPhone ของโปรเจกต์นั้น) จะถูก normalize + SHA-256 ก่อนส่งเสมอ
 */
export function buildMetaPayload(config: MetaAdsConfig, ctx: SendContext) {
  const { lead, eventName, value, currency, click } = ctx;
  const eventTime = Math.floor(Date.now() / 1000);
  // fbc ต้องใส่ "เวลาที่คลิกโฆษณา" ไม่ใช่เวลาที่ยิง event เข้ามา — ใช้เวลาที่คลิกถูกบันทึก
  // (ไม่มีคลิกก็ใช้เวลาที่ lead ถูกสร้าง) ถ้าใส่เวลาส่ง Meta จะอ่าน recency ของคลิกผิดและ match แย่ลง
  // หน่วยต้องเป็น "มิลลิวินาที" ตามเอกสาร Meta — ของเดิมส่งเป็นวินาที Meta อ่านเป็นปี 1970
  // ถ้าเว็บลูกค้ามี cookie _fbc ของคลิกเดียวกันอยู่แล้ว ใช้ค่านั้นตรง ๆ (เวลาที่ Pixel จดไว้เอง)
  const fbc = fbcFor(lead.fbclid, click?.fbc, new Date(click?.clickedAt ?? lead.createdAt));
  // http(s) เท่านั้น และตัดความยาว: ค่านี้มาจากเบราว์เซอร์ของผู้เข้าชม
  const sourceUrl =
    click?.landingUrl && /^https?:\/\//i.test(click.landingUrl) ? click.landingUrl.slice(0, 2000) : undefined;
  const externalId = lead.lineUserId ? sha256(lead.lineUserId) : undefined;
  // ปิดไว้เป็นค่าเริ่มต้น — ต้องเลือก "ส่ง" ในการ์ด Meta Ads ของโปรเจกต์นั้นก่อน
  // lead ที่ไม่มีเบอร์ (คนทักเฉย ๆ) ก็ไม่มีอะไรถูกส่งเพิ่ม payload เท่าเดิมทุกอย่าง
  const normalizedPhone =
    config.sendHashedPhone === "on" && lead.phone
      ? normalizePhoneForMeta(lead.phone)
      : undefined;
  const ph = normalizedPhone ? [sha256(normalizedPhone)] : undefined;

  return {
    pixelId: config.pixelId ?? "MOCK_PIXEL",
    data: [
      {
        event_name: eventName,
        event_time: eventTime,
        action_source: "chat",
        event_id: `lead.${lead.id}.${eventName}`,
        event_source_url: sourceUrl,
        user_data: {
          fbc,
          // _fbp = รหัสเบราว์เซอร์ที่ Pixel ของเว็บลูกค้าตั้งไว้ — ตัวจับคู่หลักเมื่อไม่มี fbclid
          fbp: click?.fbp,
          client_user_agent: click?.userAgent ? click.userAgent.slice(0, 500) : undefined,
          external_id: externalId ? [externalId] : undefined,
          ph,
        },
        custom_data: {
          currency,
          value,
          order_id: lead.purchaseId || lead.id,
        },
      },
    ],
  };
}

export const META_API_VERSION = "v23.0";

/**
 * ยิง test event เข้า Pixel เพื่อพิสูจน์ว่า access token ส่งเข้า dataset ตัวนี้ได้จริง
 * — เป็นสิทธิ์เดียวที่ token ของ Conversions API มี (อ่าน node ของ Pixel ไม่ได้)
 * event ที่แนบ test_event_code จะโผล่เฉพาะแท็บ Test Events ของ Events Manager
 * ไม่เข้า reporting และไม่ถูกนำไป optimize แคมเปญ จึงยิงกับบัญชีลูกค้าจริงได้ปลอดภัย
 */
export async function sendMetaTestEvent(
  pixelId: string,
  accessToken: string,
  testEventCode: string
): Promise<{ ok: boolean; received: number; error?: string }> {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: [
          {
            event_name: "Lead",
            event_time: Math.floor(Date.now() / 1000),
            action_source: "chat",
            event_id: `marsos.connection-test.${pixelId}.${Date.now()}`,
            user_data: {
              external_id: [
                createHash("sha256").update(`marsos-connection-test-${pixelId}`).digest("hex"),
              ],
            },
          },
        ],
        test_event_code: testEventCode,
        access_token: accessToken,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      events_received?: number;
      error?: { message?: string };
    };
    if (!res.ok || json.error) {
      return { ok: false, received: 0, error: json.error?.message || `Meta ตอบ ${res.status}` };
    }
    return { ok: true, received: json.events_received ?? 0 };
  } catch (err) {
    return { ok: false, received: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Send to Meta Conversions API. REAL send when pixelId + accessToken present;
 * otherwise mock. The `data` array is posted; access_token goes as a form field.
 */
export async function sendMeta(
  config: MetaAdsConfig,
  ctx: SendContext
): Promise<SendResult> {
  const request = buildMetaPayload(config, ctx);
  const real = !!(config.pixelId && config.accessToken);

  if (!real) {
    return {
      ok: true,
      mock: true,
      request,
      response: { note: "Meta CAPI mock mode — no credentials", events_received: 1 },
    };
  }

  const url = `https://graph.facebook.com/${META_API_VERSION}/${config.pixelId}/events`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: (request as { data: unknown[] }).data,
        access_token: config.accessToken,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      events_received?: number;
      error?: { message?: string };
    };
    const ok = res.ok && !json.error;
    return {
      ok,
      mock: false,
      request,
      response: { status: res.status, ...json },
      error: ok ? undefined : json.error?.message || `Meta responded ${res.status}`,
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
