import { prisma } from "@/lib/prisma";
import { isRealMode } from "@/lib/line-tracking/connectors";
import type { ConnectionType } from "@/lib/line-tracking/enums";
import { getEffectiveConfig } from "./connectionStore";
import { testGa4 } from "./ga4Service";
import { META_API_VERSION, sendMetaTestEvent } from "./metaAdsService";
import { getGoogleAccessToken, SHEETS_SCOPE } from "./googleAuth";
import { getTrackingBaseUrl } from "./trackingService";
import type { SheetConfig, Ga4Config, MetaAdsConfig, LineConfig } from "@/lib/line-tracking/connectors";

export interface TestResult {
  ok: boolean;
  message: string;
  mock: boolean;
  /**
   * "ยังยืนยันไม่ได้" ไม่เท่ากับ "ตั้งค่าพัง" — ใช้เมื่อ credential ถูกต้องแล้วแต่แพลตฟอร์ม
   * ไม่เปิดช่องให้ตรวจปลายทาง จะได้ไม่ขึ้นสถานะ ERROR ทั้งที่ไม่มีอะไรเสีย
   * connector อื่นไม่ได้ตั้งค่านี้ พฤติกรรมจึงเหมือนเดิมทุกประการ
   */
  warnOnly?: boolean;
}

/**
 * Test a connector. GA4 and Google Sheet run REAL checks when credentials are
 * present. Stub connectors (Google Ads / Meta / TikTok) and LINE validate that
 * required fields are present and report mock-pass.
 */
export async function testConnection(
  projectId: string,
  type: ConnectionType
): Promise<TestResult> {
  const config = await getEffectiveConfig(projectId, type);
  const real = isRealMode(type, config as Record<string, unknown>);
  let result: TestResult;

  switch (type) {
    case "GA4": {
      if (!real) {
        result = { ok: false, mock: true, message: "ยังไม่ได้กรอก Measurement ID / API Secret" };
      } else {
        const r = await testGa4(config as Ga4Config);
        result = { ok: r.ok, mock: false, message: r.message };
      }
      break;
    }
    case "GOOGLE_SHEET": {
      if (!real) {
        result = { ok: false, mock: true, message: "โหมด Mock — ยังไม่ได้ตั้งค่า Service Account / Sheet ID" };
      } else {
        result = await testSheet(config as SheetConfig);
      }
      break;
    }
    case "LINE": {
      const c = config as LineConfig;
      result = c.messagingAccessToken
        ? await testLine(c, projectId)
        : { ok: false, mock: false, message: "ยังไม่ได้กรอก Messaging Access Token (จำเป็น) — กรอกแล้วกด Test อีกครั้ง" };
      break;
    }
    case "META_ADS": {
      const c = config as MetaAdsConfig;
      if (c.pixelId && c.accessToken) {
        result = await testMeta(c);
      } else {
        result = { ok: true, mock: true, message: "โหมด Mock — payload พร้อมส่ง แต่ยังไม่ใส่ Pixel ID / Token" };
      }
      break;
    }
    case "TIKTOK_ADS":
    case "LINE_ADS":
    case "MICROSOFT_ADS":
    case "X_ADS":
    case "SNAPCHAT_ADS": {
      // Field-presence check (real API test-event pending). Reports pass only when the
      // required credentials are filled, so the team sees exactly what's still missing.
      result = real
        ? { ok: true, mock: false, message: "ใส่ Credentials ครบ — พร้อมยิง conversion (ยืนยันจริงครั้งแรกที่ส่ง)" }
        : { ok: false, mock: true, message: "ยังใส่ Credentials ไม่ครบ — เช็คช่องที่ต้องกรอกให้ครบ" };
      break;
    }
    default:
      result = { ok: false, mock: true, message: "Unknown connector" };
  }

  await prisma.projectConnection.update({
    where: { projectId_type: { projectId, type } },
    data: {
      lastTestStatus: result.ok ? "PASS" : "FAIL",
      lastTestAt: new Date(),
      lastError: result.ok ? null : result.message,
      // CONNECTED only when real credentials are present; mock/empty = NOT_CONNECTED.
      // warnOnly = credential ถูกแล้วแต่ยืนยันปลายทางไม่ได้ → ค้างที่ NOT_CONNECTED
      // ไม่ใช่ ERROR (connector อื่นไม่ส่ง warnOnly ผลลัพธ์จึงเท่าเดิม)
      status: result.ok
        ? real
          ? "CONNECTED"
          : "NOT_CONNECTED"
        : result.warnOnly
          ? "NOT_CONNECTED"
          : "ERROR",
    },
  });

  return result;
}

// REAL LINE test — เดิมเช็คแค่ว่า access token เรียก /v2/bot/info ผ่าน แล้วขึ้นเขียวทันที
// ซึ่งพิสูจน์แค่ "กรอก token ถูก" ไม่ได้พิสูจน์ว่า LINE จะส่ง event มาหาเราจริง ทีมจึงเห็น
// "เชื่อมต่อแล้ว" ทั้งที่ webhook ในคอนโซลยังชี้ไปที่อื่นอยู่ และไม่มี lead เข้าเลยสักราย
// (24 ส.ค. 2569 เจอพร้อมกัน 2 โปรเจกต์ ชี้ไป webhook.site กับ Google Apps Script)
// ตอนนี้เช็คของจริงครบสามด่าน: token ใช้ได้ / OA ตรงกับลิงก์แอดเพื่อน / LINE ชี้ webhook มาที่เรา
const LINE_API = "https://api.line.me";

function sameUrl(a: string, b: string): boolean {
  const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * ลิงก์แอดเพื่อนบอกว่า "คนที่กดจากโฆษณาจะไปแอด OA ตัวไหน" ส่วน access token บอกว่า
 * "เราฟัง OA ตัวไหนอยู่" ถ้าสองอันนี้คนละตัว ต่อ webhook ถูกแค่ไหนก็ได้ 0 lead ตลอดกาล
 * lin.ee เป็นลิงก์ย่อ ต้องตาม redirect ไปอ่าน line.me/R/ti/p/@xxxx ถึงจะรู้ปลายทางจริง
 */
async function resolveAddFriendOa(addFriendUrl: string): Promise<string | null> {
  const pick = (u: string) => {
    const m = u.match(/ti\/p\/(@?[A-Za-z0-9._~-]+)/);
    return m ? m[1].replace(/^@/, "").toLowerCase() : null;
  };
  try {
    const url = addFriendUrl.trim();
    const direct = pick(url);
    if (direct) return direct;
    if (!/^https?:\/\/lin\.ee\//i.test(url)) return null;
    const res = await fetch(url, { method: "HEAD", redirect: "manual" });
    return pick(res.headers.get("location") ?? "");
  } catch {
    return null;
  }
}

async function testLine(config: LineConfig, projectId: string): Promise<TestResult> {
  const token = config.messagingAccessToken!.trim();
  try {
    const infoRes = await fetch(`${LINE_API}/v2/bot/info`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const info = (await infoRes.json().catch(() => ({}))) as {
      basicId?: string; premiumId?: string; displayName?: string; message?: string;
    };
    if (!infoRes.ok) {
      return { ok: false, mock: false, message: `Access Token ใช้ไม่ได้ (${infoRes.status}) — ${info.message ?? "ตรวจ token ใน LINE Developers → Messaging API"}` };
    }

    const oaName = info.displayName ?? info.basicId ?? "OK";
    const expected = `${getTrackingBaseUrl()}/api/webhooks/line/${projectId}`;
    const relayToken = (config.relayToken ?? "").trim();
    const fail: string[] = [];
    const warn: string[] = [];

    if (!config.messagingChannelSecret?.trim()) warn.push("ยังไม่ใส่ Messaging Channel Secret (ยืนยันลายเซ็น webhook ไม่ได้)");

    // ด่าน 1 — OA ที่ถือ token ต้องเป็นตัวเดียวกับที่ลิงก์โฆษณาพาไปแอด
    const addFriendUrl = config.addFriendUrl?.trim();
    if (!addFriendUrl) {
      warn.push("ยังไม่ใส่ Add Friend URL");
    } else {
      const linkOa = await resolveAddFriendOa(addFriendUrl);
      const ids = [info.basicId, info.premiumId]
        .filter(Boolean)
        .map((v) => v!.replace(/^@/, "").toLowerCase());
      if (linkOa && ids.length > 0 && !ids.includes(linkOa)) {
        fail.push(`Add Friend URL เป็นของ OA คนละตัวกับ Access Token — ลิงก์พาไป @${linkOa} แต่ token เป็นของ ${ids.map((i) => "@" + i).join(" / ")} คนที่กดจากโฆษณาจะไปแอดอีก OA หนึ่ง เราจึงไม่มีวันเห็น lead`);
      }
    }

    // ด่าน 2 — LINE ชี้ webhook มาที่ระบบเราจริงหรือยัง (ด่านที่ขาดไปทั้งหมดคือด่านนี้)
    const epRes = await fetch(`${LINE_API}/v2/bot/channel/webhook/endpoint`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const ep = (await epRes.json().catch(() => ({}))) as { endpoint?: string; active?: boolean };
    if (!epRes.ok) {
      warn.push(`อ่านค่า Webhook URL จาก LINE ไม่ได้ (${epRes.status}) — ตรวจในคอนโซลเองอีกครั้งว่าชี้มาที่ ${expected}`);
    } else if (!ep.endpoint) {
      fail.push(`ยังไม่ได้ตั้ง Webhook URL ใน LINE Developers เลย — วาง ${expected} ที่ Messaging API → Webhook URL แล้วเปิด "Use webhook"`);
    } else if (sameUrl(ep.endpoint, expected)) {
      if (!ep.active) fail.push('ตั้ง Webhook URL ถูกแล้ว แต่สวิตช์ "Use webhook" ยังปิดอยู่ — เปิดใน LINE Developers ก่อน ไม่งั้น LINE ไม่ยิงอะไรมาเลย');
    } else if (relayToken.length >= 16) {
      // โหมด "webhook ยังอยู่ที่ระบบเดิมของลูกค้า" — ระบบนั้นต้องยิงสำเนาต่อมาหาเรา
      // เชื่อ config ไม่ได้ ต้องดูว่ามี event เข้ามาจริงในรอบ 7 วันถึงจะถือว่าผ่าน
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const seen = await prisma.webhookLog.count({ where: { projectId, createdAt: { gte: since } } });
      if (seen === 0) {
        fail.push(`โหมดตัวกลาง: LINE ชี้ไปที่ ${ep.endpoint} (ระบบเดิมของลูกค้า) แต่ 7 วันที่ผ่านมายังไม่มี event ส่งต่อเข้ามาเลย — ให้ระบบนั้นยิง POST ต่อมาที่ ${expected}?k=<relay token> โดยส่ง body เดิมทั้งก้อน`);
      }
    } else {
      fail.push(`LINE ชี้ webhook ไปที่ ${ep.endpoint} ไม่ใช่ระบบเรา event จึงไม่เข้าเลย — เลือกทางใดทางหนึ่ง: (1) เปลี่ยน Webhook URL ในคอนโซลเป็น ${expected} แล้วเลือก Option 2 พร้อมใส่ URL เดิมในช่อง forward ระบบเดิมของลูกค้าจะทำงานต่อได้เหมือนเดิม หรือ (2) ปล่อย webhook เดิมไว้ แล้วใส่ Relay Token ที่นี่ ให้ระบบเดิมยิงสำเนามาที่ ${expected}?k=<relay token>`);
    }

    // ด่าน 3 — relay ที่ตั้งค้างครึ่งทาง: ย้าย webhook มาแล้วแต่ไม่ได้บอกว่าจะ forward ไปไหน
    if (config.webhookMode === "relay" && !config.forwardUrl?.trim() && relayToken.length < 16) {
      warn.push('เลือก Option 2 ไว้แต่ยังไม่ใส่ "Webhook URL เดิมของลูกค้า" — จะไม่ forward ต่อให้ใคร ถ้าย้าย webhook มาแล้วระบบเดิมของลูกค้าจะหยุดรับ event เงียบ ๆ');
    }

    const tail = warn.length ? " · ⚠️ " + warn.join(" · ") : "";
    if (fail.length > 0) {
      return { ok: false, mock: false, message: `OA: ${oaName} — ❌ ${fail.join(" ❌ ")}${tail}` };
    }
    return { ok: true, mock: false, message: `✓ เชื่อม LINE OA จริงสำเร็จ: ${oaName} · LINE ชี้ webhook มาที่ระบบเราแล้ว${tail}` };
  } catch (err) {
    return { ok: false, mock: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// Graph API GET — token ไปทาง Authorization header ไม่ใช่ query string
// (query string ติดไปใน access log / proxy / error report ได้)
async function metaGet(path: string, token: string) {
  const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    error?: { message?: string; code?: number };
  };
  return { ok: res.ok && !json.error, status: res.status, json };
}

/**
 * Meta ออก access token ให้ Conversions API สองแบบ และทดสอบไม่เหมือนกัน:
 *  1. System User token จาก Events Manager → Settings → Conversions API (แบบที่ทีมใช้จริง)
 *     scope มีแค่ read_ads_dataset_quality = "ส่ง event เข้า dataset ได้" แต่ "อ่าน Pixel ไม่ได้"
 *  2. token ที่มี ads_management (ต้องผูก Business ให้เอง) — อ่าน Pixel ได้
 * ของเดิมทดสอบด้วยการอ่าน node ของ Pixel อย่างเดียว token แบบ 1 จึงตอบ
 * "(#100) Missing Permission" ทุกครั้ง ทั้งที่ตั้งค่าถูกและส่ง conversion ได้จริง
 * ตอนนี้ไล่เป็นชั้น: เช็คว่า token ใช้ได้ → ถ้ามี Test Event Code ก็ยิง test event
 * ซึ่งเป็นวิธีเดียวที่พิสูจน์ได้ว่า token คู่กับ Pixel ตัวนี้จริง
 */
async function testMeta(config: MetaAdsConfig): Promise<TestResult> {
  const pixelId = (config.pixelId ?? "").trim();
  const token = (config.accessToken ?? "").trim();
  const testCode = (config.testEventCode ?? "").trim();

  try {
    // ชั้น 1 — token ใช้ได้จริงไหม /me ตอบ 200 กับ token ที่ยัง valid ทุกชนิด รวม System User
    const me = await metaGet("me?fields=id", token);
    if (!me.ok) {
      return {
        ok: false,
        mock: false,
        message: `Access Token ใช้ไม่ได้ (${me.status}) — ${
          me.json.error?.message ??
          "สร้างใหม่ที่ Events Manager → Settings → Conversions API → Generate access token"
        }`,
      };
    }

    // ชั้น 2 — มี Test Event Code = ยืนยันได้ถึงปลายทางว่าส่งเข้า Pixel ตัวนี้ได้จริง
    if (testCode) {
      const sent = await sendMetaTestEvent(pixelId, token, testCode);
      if (!sent.ok) {
        return {
          ok: false,
          mock: false,
          message: `Token ใช้ได้ แต่ส่งเข้า Pixel ${pixelId} ไม่ผ่าน — ${sent.error} · เช็คว่า Pixel ID ตรงกับ dataset ที่ใช้ออก token`,
        };
      }
      return {
        ok: true,
        mock: false,
        message: `✓ ส่ง test event เข้า Pixel ${pixelId} สำเร็จ (Meta รับ ${sent.received} event) — เปิดดูได้ที่ Events Manager → Test Events`,
      };
    }

    // ชั้น 3 — ไม่มี Test Event Code: ลองอ่าน Pixel เผื่อเป็น token แบบมี ads_management
    const pixel = await metaGet(`${pixelId}?fields=id,name`, token);
    if (pixel.ok) {
      return { ok: true, mock: false, message: `เชื่อม Meta Pixel สำเร็จ: ${pixel.json.name ?? pixelId}` };
    }
    const code = pixel.json.error?.code;
    if (code === 100 || code === 200 || code === 10 || code === 3) {
      // ไม่ใช่ความผิดพลาดของการตั้งค่า — Meta ปิดสิทธิ์อ่านให้ token ชนิดนี้ตั้งแต่ต้น
      return {
        ok: false,
        warnOnly: true,
        mock: false,
        message: `Token ถูกต้องแล้ว (System User ของ Conversions API) — Meta ไม่ให้ token ชนิดนี้อ่านข้อมูล Pixel เลยยังยืนยันปลายทางไม่ได้ · ใส่ช่อง "Test Event Code" (Events Manager → Test Events) แล้วกด Test อีกครั้ง จะยืนยันได้ว่าส่งเข้า Pixel ${pixelId} ได้จริง`,
      };
    }
    return { ok: false, mock: false, message: pixel.json.error?.message || `Meta ตอบ ${pixel.status}` };
  } catch (err) {
    return { ok: false, mock: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function testSheet(config: SheetConfig): Promise<TestResult> {
  try {
    const token = await getGoogleAccessToken(config.serviceAccountJson!, SHEETS_SCOPE);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}?fields=spreadsheetId,properties.title`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      return { ok: false, mock: false, message: `เข้าถึง Sheet ไม่ได้ (${res.status}) — ตรวจสิทธิ์แชร์ให้ service account` };
    }
    const json = (await res.json()) as { properties?: { title?: string } };
    return { ok: true, mock: false, message: `เชื่อมต่อ Sheet สำเร็จ: ${json.properties?.title ?? config.sheetId}` };
  } catch (err) {
    return { ok: false, mock: false, message: err instanceof Error ? err.message : String(err) };
  }
}
