// Connector config shapes + metadata driving the setup wizard connection cards.
// Config is stored in ProjectConnection.configJson (a JSON string on SQLite).

import type { ConnectionType } from "./enums";

export interface LineConfig {
  oaId?: string;
  addFriendUrl?: string;
  loginChannelId?: string;
  loginChannelSecret?: string;
  liffId?: string;
  messagingChannelSecret?: string;
  messagingAccessToken?: string;
  // LINE allows exactly ONE webhook URL per channel. When the customer already
  // runs a bot on that channel, our URL replaces theirs — so "relay" mode
  // forwards every verified event (raw body + original X-Line-Signature) to the
  // bot's original URL. Same channel = same secret, so the signature verifies at
  // the destination as if LINE had called it directly.
  webhookMode?: "direct" | "relay";
  forwardUrl?: string;
  // ใช้เฉพาะ Option 2 รูปแบบที่ LINE ชี้ webhook ไปที่ "ตัวกลางของลูกค้า" แล้วตัวกลาง
  // forward ต่อมาที่เรา ถ้าตัวกลางตัด header x-line-signature ทิ้งหรือ re-serialize
  // body ใหม่ ลายเซ็นของ LINE จะใช้ยืนยันไม่ได้อีก (พิสูจน์ไม่ได้ว่ามาจาก LINE จริง)
  // relayToken คือความลับที่ระบบเราออกให้เอง ลูกค้าเอาไปแปะท้าย URL ในตัวกลาง:
  //   .../api/webhooks/line/<projectId>?k=<relayToken>
  // ปล่อยว่าง = ต้องมีลายเซ็น LINE ถูกต้องเท่านั้น (พฤติกรรมมาตรฐาน แนะนำให้ใช้อันนี้)
  relayToken?: string;
  // "on" = event ที่ยืนยันไม่ได้ (ไม่มีลายเซ็น LINE ที่ถูกต้อง และไม่มี relayToken ที่ถูก)
  // จะถูกปฏิเสธ ไม่สร้าง lead / ไม่ยิง conversion / ไม่ forward ต่อ
  // ไม่ตั้ง หรือ "off" = รับทุก event เหมือน Mercy (เจ้าของสั่ง 2026-11-20)
  requireVerified?: "off" | "on";
}

export interface SheetConfig {
  sheetUrl?: string;
  sheetId?: string;
  tabName?: string;
  serviceAccountJson?: string;
}

export interface Ga4Config {
  measurementId?: string;
  apiSecret?: string;
}

export interface GoogleAdsConfig {
  developerToken?: string;
  customerId?: string; // digits only, no dashes
  conversionActionId?: string;
  // OAuth2 (needed for REAL offline conversion upload)
  oauthClientId?: string;
  oauthClientSecret?: string;
  refreshToken?: string;
  loginCustomerId?: string; // manager (MCC) id, digits only — optional
}

export interface MetaAdsConfig {
  pixelId?: string;
  accessToken?: string;
  // จาก Events Manager → Test Events. Token ที่ Meta ออกให้สำหรับ Conversions API
  // มีสิทธิ์ "ส่ง event" อย่างเดียว อ่านข้อมูล Pixel ไม่ได้ การยิง test event จึงเป็น
  // วิธีเดียวที่พิสูจน์ได้ว่า token คู่กับ Pixel ตัวนี้จริง — event ที่แนบ code นี้จะขึ้น
  // เฉพาะแท็บ Test Events ไม่เข้า reporting และไม่ถูกใช้ optimize แคมเปญ
  testEventCode?: string;
  /**
   * "on" = แนบเบอร์โทรที่ทีมกรอก/อ่านจากสลิป (เข้ารหัส SHA-256 ก่อนส่ง) ไปกับ conversion
   * ค่าเริ่มต้นคือปิด — ต้องเปิดรายโปรเจกต์เอง ระบบจึงไม่ส่งข้อมูลของลูกค้าเจ้าไหน
   * เพิ่มขึ้นเองจากการอัปเดตนี้ · Meta ใช้เบอร์ที่ hash แล้วจับคู่คน เพิ่ม match rate
   * ได้มากเมื่อ lead มาจากแชท LINE (ไม่มี fbclid)
   */
  sendHashedPhone?: string;
}

export interface TiktokAdsConfig {
  pixelId?: string;
  accessToken?: string;
}

export interface LineAdsConfig {
  tagId?: string;
  accessToken?: string;
}

export interface MicrosoftAdsConfig {
  customerId?: string;
  developerToken?: string;
  accessToken?: string;
  conversionName?: string;
}

export interface XAdsConfig {
  pixelId?: string;
  accessToken?: string;
  eventId?: string;
}

export interface SnapchatAdsConfig {
  pixelId?: string;
  accessToken?: string;
}

export type ConnectorConfig =
  | LineConfig
  | SheetConfig
  | Ga4Config
  | GoogleAdsConfig
  | MetaAdsConfig
  | TiktokAdsConfig
  | LineAdsConfig
  | MicrosoftAdsConfig
  | XAdsConfig
  | SnapchatAdsConfig;

export interface ConnectorField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean; // secret fields are masked in read views and never listed raw
  textarea?: boolean;
  optional?: boolean;
  /** Renders as a <select> instead of a text input. */
  options?: { value: string; label: string }[];
}

export interface ConnectorMeta {
  type: ConnectionType;
  title: string;
  description: string;
  /** Fields required to consider the connector "real" (not mock). */
  realKeys: string[];
  fields: ConnectorField[];
  /** Whether real API is implemented (vs stub) — surfaced in UI. */
  realImplemented: boolean;
}

export const CONNECTOR_META: Record<ConnectionType, ConnectorMeta> = {
  LINE: {
    type: "LINE",
    title: "Connect LINE OA",
    description: "เชื่อม LINE Official Account เพื่อรับเพื่อนและ Lead จากโฆษณา",
    // โหมด 1 (โปร่งใส): ต้องมี Messaging (webhook) + Add Friend URL. LINE Login ไม่ต้อง
    realKeys: ["messagingChannelSecret", "messagingAccessToken"],
    realImplemented: true,
    fields: [
      { key: "oaId", label: "LINE OA ID (@id)", placeholder: "@abcclinic" },
      { key: "addFriendUrl", label: "Add Friend URL (ลิงก์แอดเพื่อน — จำเป็น)", placeholder: "https://lin.ee/xxxx" },
      { key: "messagingChannelSecret", label: "Messaging Channel Secret (จำเป็น — ยืนยัน webhook)", secret: true },
      { key: "messagingAccessToken", label: "Messaging Access Token (จำเป็น — ดึงชื่อ/รูป + อ่านสลิป)", secret: true },
      {
        key: "webhookMode",
        label: "โหมด Webhook (เลือกตามลูกค้า)",
        optional: true,
        options: [
          { value: "direct", label: "Option 1 — ลูกค้าไม่มีบอทเดิม: ใช้ webhook ของระบบเราอย่างเดียว" },
          { value: "relay", label: "Option 2 — ลูกค้ามีบอท/webhook เดิม: forward ทุก event ต่อให้บอทเดิมด้วย" },
        ],
      },
      {
        key: "forwardUrl",
        label: "Webhook URL เดิมของบอทลูกค้า (ใส่เมื่อเลือก Option 2)",
        placeholder: "https://bot-ของลูกค้า.example.com/callback",
        optional: true,
      },
      {
        key: "relayToken",
        label: "Relay Token (ไม่บังคับ — ใส่เมื่อตัวกลางของลูกค้าส่ง x-line-signature ต่อมาไม่ได้)",
        placeholder: "สุ่มมา ≥16 ตัวอักษร แล้วต่อท้าย URL เป็น ?k=<token>",
        secret: true,
        optional: true,
      },
      {
        key: "requireVerified",
        label: "ปฏิเสธ event ที่ยืนยันไม่ได้ (กันคนยิง lead ปลอม)",
        optional: true,
        options: [
          { value: "off", label: "ปิด — รับทุก event แม้ยืนยันลายเซ็นไม่ได้ (ค่าเดิม)" },
          { value: "on", label: "เปิด — รับเฉพาะ event ที่ลายเซ็น LINE ถูก หรือมี Relay Token ถูก (เช็ค log ก่อนว่าไม่มี \"ยืนยันลายเซ็นไม่ได้\")" },
        ],
      },
      { key: "loginChannelId", label: "LINE Login Channel ID (ไม่บังคับ — เฉพาะถ้าอยาก attribution แม่น 1:1)", optional: true },
      { key: "loginChannelSecret", label: "LINE Login Channel Secret (ไม่บังคับ)", secret: true, optional: true },
      { key: "liffId", label: "LIFF ID", optional: true },
    ],
  },
  GOOGLE_SHEET: {
    type: "GOOGLE_SHEET",
    title: "Connect Google Sheet",
    description: "ซิงก์ Lead ไป-กลับกับ Google Sheet ให้ทีมเซลส์อัปเดตสถานะ",
    realKeys: ["sheetId", "serviceAccountJson"],
    realImplemented: true,
    fields: [
      { key: "sheetUrl", label: "Sheet URL", placeholder: "https://docs.google.com/spreadsheets/d/..." },
      { key: "sheetId", label: "Sheet ID", placeholder: "1AbC...xyz" },
      { key: "tabName", label: "Tab name", placeholder: "Leads" },
      {
        key: "serviceAccountJson",
        label: "Service Account JSON",
        secret: true,
        textarea: true,
        optional: true,
        placeholder: '{"type":"service_account", ...}',
      },
    ],
  },
  GA4: {
    type: "GA4",
    title: "Connect GA4",
    description: "ส่ง Conversion เข้า GA4 ผ่าน Measurement Protocol (ของจริง)",
    realKeys: ["measurementId", "apiSecret"],
    realImplemented: true,
    fields: [
      { key: "measurementId", label: "Measurement ID", placeholder: "G-XXXXXXXXXX" },
      { key: "apiSecret", label: "API Secret", secret: true },
    ],
  },
  META_ADS: {
    type: "META_ADS",
    title: "Connect Meta Ads",
    description: "ส่ง Conversion เข้า Meta ผ่าน Conversions API (real เมื่อใส่ token)",
    realKeys: ["pixelId", "accessToken"],
    realImplemented: true,
    fields: [
      { key: "pixelId", label: "Pixel ID (Dataset ID)", placeholder: "1234567890" },
      { key: "accessToken", label: "Access Token", secret: true },
      {
        key: "testEventCode",
        label: "Test Event Code (ใส่เพื่อให้ปุ่ม Test ยืนยันการส่งจริง)",
        placeholder: "TEST12345 — Events Manager → Test Events",
        optional: true,
      },
      {
        key: "sendHashedPhone",
        label: "ส่งเบอร์โทร (เข้ารหัส SHA-256) เพื่อเพิ่ม match rate",
        optional: true,
        options: [
          { value: "off", label: "ไม่ส่ง — ส่งเฉพาะ fbc + external_id (ค่าเริ่มต้น)" },
          { value: "on", label: "ส่ง — เฉพาะ lead ที่มีเบอร์ (ทีมกรอกเอง/อ่านจากสลิป)" },
        ],
      },
    ],
  },
  TIKTOK_ADS: {
    type: "TIKTOK_ADS",
    title: "Connect TikTok Ads",
    description: "ส่ง Conversion เข้า TikTok ผ่าน Events API (real เมื่อใส่ token)",
    realKeys: ["pixelId", "accessToken"],
    realImplemented: true,
    fields: [
      { key: "pixelId", label: "Pixel ID (Event Set ID)", placeholder: "C123..." },
      { key: "accessToken", label: "Access Token", secret: true },
    ],
  },
  LINE_ADS: {
    type: "LINE_ADS",
    title: "Connect LINE Ads (LAP)",
    description: "ส่ง Conversion เข้า LINE Ads Platform (real เมื่อใส่ credentials)",
    realKeys: ["tagId", "accessToken"],
    realImplemented: true,
    fields: [
      { key: "tagId", label: "LINE Tag ID", placeholder: "xxxxxxxx" },
      { key: "accessToken", label: "Access Token", secret: true },
    ],
  },
  MICROSOFT_ADS: {
    type: "MICROSOFT_ADS",
    title: "Connect Microsoft / Bing Ads",
    description: "อัปโหลด Offline Conversion เข้า Microsoft Ads (real เมื่อใส่ credentials)",
    realKeys: ["developerToken", "customerId", "accessToken"],
    realImplemented: true,
    fields: [
      { key: "customerId", label: "Customer ID", placeholder: "1234567" },
      { key: "developerToken", label: "Developer Token", secret: true },
      { key: "accessToken", label: "Access Token", secret: true },
      { key: "conversionName", label: "Conversion Goal Name", optional: true, placeholder: "Lead" },
    ],
  },
  X_ADS: {
    type: "X_ADS",
    title: "Connect X (Twitter) Ads",
    description: "ส่ง Conversion เข้า X Ads ผ่าน Conversions API (real เมื่อใส่ credentials)",
    realKeys: ["pixelId", "accessToken"],
    realImplemented: true,
    fields: [
      { key: "pixelId", label: "Pixel ID", placeholder: "o1abc" },
      { key: "accessToken", label: "Access Token", secret: true },
      { key: "eventId", label: "Default Event ID", optional: true },
    ],
  },
  SNAPCHAT_ADS: {
    type: "SNAPCHAT_ADS",
    title: "Connect Snapchat Ads",
    description: "ส่ง Conversion เข้า Snapchat ผ่าน Conversions API (real เมื่อใส่ credentials)",
    realKeys: ["pixelId", "accessToken"],
    realImplemented: true,
    fields: [
      { key: "pixelId", label: "Pixel ID", placeholder: "xxxx-xxxx" },
      { key: "accessToken", label: "Access Token", secret: true },
    ],
  },
};

/** True when the config has all keys required to run in REAL (non-mock) mode. */
export function isRealMode(type: ConnectionType, config: Record<string, unknown>): boolean {
  const meta = CONNECTOR_META[type];
  return meta.realKeys.every((k) => {
    const v = config[k];
    return typeof v === "string" && v.trim().length > 0;
  });
}

/** Extract the service-account email from a Google service-account JSON. */
export function serviceAccountEmail(json?: string | null): string | null {
  if (!json) return null;
  try {
    return (JSON.parse(json) as { client_email?: string }).client_email ?? null;
  } catch {
    return null;
  }
}

/** Mask a secret value for display, e.g. "abcd…wxyz". */
export function maskSecret(value?: string | null): string {
  if (!value) return "";
  if (value.length <= 6) return "••••";
  return `${value.slice(0, 3)}…${value.slice(-3)}`;
}

export const SECRET_FIELD_KEYS = new Set(
  Object.values(CONNECTOR_META).flatMap((m) =>
    m.fields.filter((f) => f.secret).map((f) => f.key)
  )
);
