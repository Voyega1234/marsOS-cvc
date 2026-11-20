// Platform registry — single source of truth for every conversion destination.
// Add a new ad platform here (id + connectionType + sender + default events) and
// it flows through rules, queue, UI and seed automatically — no schema change.

import type { ConnectionType, LeadStatus } from "./enums";
import type { SendContext, SendResult } from "./services/senderTypes";
import { sendGa4 } from "./services/ga4Service";
import { sendMeta } from "./services/metaAdsService";
import { sendTiktok } from "./services/tiktokAdsService";
import { sendLineAds } from "./services/lineAdsService";
import { sendMicrosoft } from "./services/microsoftAdsService";
import { sendX } from "./services/xAdsService";
import { sendSnapchat } from "./services/snapchatAdsService";

export type PlatformId =
  | "ga4"
  | "meta"
  | "tiktok"
  | "line_ads"
  | "microsoft"
  | "x"
  | "snapchat";

export interface PlatformDef {
  id: PlatformId;
  label: string;
  connectionType: ConnectionType; // which ProjectConnection supplies its creds
  realImplemented: boolean;
  send: (config: Record<string, unknown>, ctx: SendContext) => Promise<SendResult>;
  /** GA4-style event name for each lead status. */
  events: Partial<Record<LeadStatus, string>>;
  /** Statuses where this platform is toggled ON by default when seeding. */
  defaultOn: LeadStatus[];
  /** Event name sent when a user BLOCKS the LINE OA (unfollow) — lets you measure
   *  which campaign/channel drives blocks. Omit for platforms where it doesn't apply. */
  blockEvent?: string;
}

// ยิงทุกสถานะของ funnel ตั้งแต่ "แอด/ทัก" (NEW) ยาวไปจนปิดการขาย — ของเดิมเปิดให้
// แพลตฟอร์มโฆษณาเฉพาะ QUALIFIED ขึ้นไป โปรเจกต์ที่ทีมยังไม่ได้ไล่เลื่อนสถานะเองจึงไม่มี
// event ไหลไป Meta/TikTok เลยแม้เชื่อมต่อผ่านแล้ว (ดู RULE_SCHEMA_VERSION สำหรับการ
// อัปเกรดโปรเจกต์เก่า)
//
// นับซ้ำไหม: ไม่ เพราะทุกสถานะใช้ "ชื่อ event คนละตัว" แล้ว (Lead / Contact /
// CompleteRegistration / SubmitApplication / Schedule / Purchase) แพลตฟอร์มจึงเห็นเป็น
// คนละขั้นของ funnel เดียวกัน วัดอัตราการหล่นแต่ละขั้นได้ และเลือก optimize ทีละขั้นได้
// (ถ้าใช้ชื่อซ้ำกันคิวจะกันเป็น event ซ้ำแล้วข้ามเงียบ ๆ — ดู LEGACY_EVENT_DEFAULTS)
// LOST ไม่มีในนี้เพราะไม่มีชื่อ event ให้ตั้งแต่ต้น (defaultPlatformsForStatus ข้ามให้)
const ALL_FUNNEL_STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED", "QUOTED", "BOOKED", "WON", "PAID"];
const ADS_DEFAULT_ON: LeadStatus[] = ALL_FUNNEL_STATUSES;
const GA4_DEFAULT_ON: LeadStatus[] = ALL_FUNNEL_STATUSES;

// Cast helpers: senders take their own config types; registry stores generic.
type AnySend = (config: never, ctx: SendContext) => Promise<SendResult>;
const s = (fn: AnySend) => fn as unknown as PlatformDef["send"];

export const PLATFORMS: PlatformDef[] = [
  {
    id: "ga4",
    label: "GA4",
    connectionType: "GA4",
    realImplemented: true,
    send: s(sendGa4 as AnySend),
    events: { NEW: "generate_lead", CONTACTED: "contact", QUALIFIED: "qualified_lead", QUOTED: "quote_sent", BOOKED: "booked", WON: "deal_won", PAID: "purchase" },
    blockEvent: "line_block",
    defaultOn: GA4_DEFAULT_ON,
  },
  {
    id: "meta",
    label: "Meta Ads",
    connectionType: "META_ADS",
    realImplemented: true,
    send: s(sendMeta as AnySend),
    events: { NEW: "Lead", CONTACTED: "Contact", QUALIFIED: "CompleteRegistration", QUOTED: "SubmitApplication", BOOKED: "Booked", WON: "Schedule", PAID: "Purchase" },
    blockEvent: "line_block",
    defaultOn: ADS_DEFAULT_ON,
  },
  {
    id: "tiktok",
    label: "TikTok Ads",
    connectionType: "TIKTOK_ADS",
    realImplemented: true,
    send: s(sendTiktok as AnySend),
    events: { NEW: "SubmitForm", CONTACTED: "Contact", QUALIFIED: "CompleteRegistration", QUOTED: "InitiateCheckout", BOOKED: "AddPaymentInfo", WON: "PlaceAnOrder", PAID: "CompletePayment" },
    blockEvent: "line_block",
    defaultOn: ADS_DEFAULT_ON,
  },
  {
    id: "line_ads",
    label: "LINE Ads",
    connectionType: "LINE_ADS",
    realImplemented: true,
    send: s(sendLineAds as AnySend),
    events: { NEW: "add_friend", CONTACTED: "message", QUALIFIED: "qualified", QUOTED: "quote", BOOKED: "booked", WON: "conversion", PAID: "purchase" },
    blockEvent: "line_block",
    defaultOn: ADS_DEFAULT_ON,
  },
  {
    id: "microsoft",
    label: "Microsoft Ads",
    connectionType: "MICROSOFT_ADS",
    realImplemented: true,
    send: s(sendMicrosoft as AnySend),
    events: { NEW: "Lead", CONTACTED: "Contact", QUALIFIED: "QualifiedLead", QUOTED: "QuoteSent", BOOKED: "Booked", WON: "DealWon", PAID: "Purchase" },
    blockEvent: "line_block",
    defaultOn: ADS_DEFAULT_ON,
  },
  {
    id: "x",
    label: "X Ads",
    connectionType: "X_ADS",
    realImplemented: true,
    send: s(sendX as AnySend),
    events: { NEW: "Lead", CONTACTED: "Contact", QUALIFIED: "QualifiedLead", QUOTED: "Quote", BOOKED: "Booked", WON: "DealWon", PAID: "Purchase" },
    blockEvent: "line_block",
    defaultOn: ADS_DEFAULT_ON,
  },
  {
    id: "snapchat",
    label: "Snapchat Ads",
    connectionType: "SNAPCHAT_ADS",
    realImplemented: true,
    send: s(sendSnapchat as AnySend),
    events: { NEW: "SIGN_UP", CONTACTED: "CONTACT", QUALIFIED: "SUBMIT_APPLICATION", QUOTED: "START_CHECKOUT", BOOKED: "ADD_BILLING", WON: "RESERVE", PAID: "PURCHASE" },
    blockEvent: "line_block",
    defaultOn: ADS_DEFAULT_ON,
  },
];

/**
 * Standard events per platform — options for the Conversion Mapping event
 * selector. GA4/Meta/TikTok/Snapchat lists follow each platform's official
 * standard-event names; LINE Ads / Microsoft / X conversions are account-defined
 * so these are sensible defaults. Custom names are always allowed via the
 * free-text override next to the selector.
 */
export const PLATFORM_STANDARD_EVENTS: Record<PlatformId, string[]> = {
  ga4: ["generate_lead", "contact", "qualified_lead", "working_lead", "quote_sent", "close_convert_lead", "purchase", "sign_up", "begin_checkout", "add_to_cart", "add_payment_info", "refund", "booked", "line_block"],
  meta: ["Lead", "Contact", "Purchase", "CompleteRegistration", "SubmitApplication", "Schedule", "StartTrial", "Subscribe", "InitiateCheckout", "AddToCart", "AddPaymentInfo", "ViewContent", "Search", "Booked", "line_block"],
  tiktok: ["SubmitForm", "Contact", "CompleteRegistration", "CompletePayment", "PlaceAnOrder", "InitiateCheckout", "AddToCart", "AddPaymentInfo", "ViewContent", "ClickButton", "Subscribe", "Download", "Search", "line_block"],
  line_ads: ["add_friend", "message", "qualified", "quote", "conversion", "purchase", "booked", "line_block"],
  microsoft: ["Lead", "Contact", "QualifiedLead", "QuoteSent", "DealWon", "Purchase", "SignUp", "Booked", "line_block"],
  x: ["Lead", "Contact", "QualifiedLead", "Quote", "DealWon", "Purchase", "SignUp", "Booked", "line_block"],
  snapchat: ["SIGN_UP", "CONTACT", "SUBMIT_APPLICATION", "START_CHECKOUT", "RESERVE", "PURCHASE", "ADD_CART", "VIEW_CONTENT", "SUBSCRIBE", "LOGIN", "SEARCH", "START_TRIAL", "ADD_BILLING", "line_block"],
};

/**
 * ชื่อ event ชุดเดิมที่ "ซ้ำกันข้ามสถานะ" (ก่อน 14 ส.ค. 2026)
 *
 * คิวกัน event ซ้ำด้วยคีย์ leadId + platform + eventName ถ้าสองสถานะใช้ชื่อเดียวกัน
 * lead คนเดิมที่เลื่อนสถานะจะถูกมองว่า "ส่งไปแล้ว" แล้วข้ามเงียบ ๆ — เช่น meta เดิม
 * NEW กับ QUALIFIED ชื่อ "Lead" เหมือนกัน คนทักกับคนที่ qualified เลยแยก optimize ไม่ได้
 *
 * ตารางนี้เก็บ "ค่าเดิมที่ระบบเคยตั้งให้" เท่านั้น เพื่อให้ syncRulePlatforms อัปเกรด
 * ให้อัตโนมัติ — ถ้าทีมเคยแก้ชื่อเองไว้ ค่าจะไม่ตรงตารางนี้และจะไม่ถูกแตะต้อง
 */
export const LEGACY_EVENT_DEFAULTS: Partial<
  Record<PlatformId, Partial<Record<LeadStatus, string>>>
> = {
  meta: { QUALIFIED: "Lead", WON: "Purchase" },
  tiktok: { QUOTED: "Consult", WON: "CompletePayment" },
  line_ads: { PAID: "conversion" },
  microsoft: { WON: "Purchase" },
  x: { WON: "Purchase" },
  snapchat: { QUALIFIED: "SIGN_UP", QUOTED: "SUBMIT_APPLICATION", WON: "PURCHASE" },
};

/**
 * คืนชื่อ event ใหม่ ถ้าชื่อปัจจุบันยังเป็นค่าเดิมที่ซ้ำกัน — คืน null เมื่อไม่ต้องแก้
 * (ทีมแก้ชื่อเองไว้ / เป็นค่าใหม่อยู่แล้ว / ไม่มีในตาราง)
 */
export function healLegacyEventName(
  platformId: string,
  status: LeadStatus,
  currentName: string
): string | null {
  const legacy = LEGACY_EVENT_DEFAULTS[platformId as PlatformId]?.[status];
  if (!legacy || legacy !== currentName) return null;
  const next = PLATFORM_BY_ID[platformId]?.events[status];
  return next && next !== currentName ? next : null;
}

export const PLATFORM_BY_ID: Record<string, PlatformDef> = Object.fromEntries(
  PLATFORMS.map((p) => [p.id, p])
);

export function getPlatform(id: string): PlatformDef | undefined {
  return PLATFORM_BY_ID[id];
}

export function platformLabel(id: string): string {
  return PLATFORM_BY_ID[id]?.label ?? id;
}

/**
 * What data each platform's payload actually contains — shown in the setup
 * wizard so users know exactly what's sent. NO personal data (name/phone/email)
 * is ever sent; only click ids, hashed pseudonymous ids, and conversion values.
 */
export const PLATFORM_DATA_SENT: Record<PlatformId, string[]> = {
  ga4: ["client_id (GA client id / lead id)", "user_id (LINE id)", "value + currency", "transaction_id (ตอน purchase/paid)", "source, campaign, keyword", "project_id, lead_id"],
  meta: ["fbc (จาก fbclid)", "external_id (LINE id เข้ารหัส SHA-256)", "ph (เบอร์เข้ารหัส SHA-256 — เฉพาะโปรเจกต์ที่เปิดสวิตช์ในการ์ด Meta Ads)", "value + currency (เฉพาะ event ปิดการขาย)", "order_id"],
  tiktok: ["ttclid", "external_id (เข้ารหัส SHA-256)", "value + currency", "order_id"],
  line_ads: ["line_user_id", "value + currency", "order_id"],
  microsoft: ["msclkid", "conversion value + currency", "conversion time"],
  x: ["twclid", "external_id (เข้ารหัส SHA-256)", "value + currency", "conversion id"],
  snapchat: ["sc_click_id (scclid)", "external_id (เข้ารหัส SHA-256)", "value + currency", "order_id"],
};

// ---- Rule shape (stored as JSON on ConversionRule.platformsJson) -----------

export interface PlatformRule {
  enabled: boolean;
  eventName: string;
}
export type PlatformsConfig = Record<string, PlatformRule>;

/**
 * Master on/off default per status (whole rule).
 *
 * QUOTED เคยปิดไว้ ทำให้ทั้งขั้น "เสนอราคา" หายไปจาก funnel ที่วัดได้ ตอนนี้เปิดหมด
 * ทุกขั้นที่มี event — เหลือ LOST อย่างเดียวที่ปิด เพราะไม่ใช่ conversion และไม่มีชื่อ
 * event ให้ส่งอยู่แล้ว
 */
export const STATUS_ENABLED_DEFAULT: Record<LeadStatus, boolean> = {
  NEW: true,
  CONTACTED: true,
  QUALIFIED: true,
  QUOTED: true,
  BOOKED: true,
  WON: true,
  PAID: true,
  LOST: false,
};

/**
 * คีย์สงวนใน platformsJson — ไม่ใช่แพลตฟอร์มจริง เก็บว่า "รูลแถวนี้อัปเกรดค่าเริ่มต้น
 * ถึงรุ่นไหนแล้ว" จึงอัปเกรดซ้ำไม่ได้ ทีมปิดสวิตช์ทีหลังแล้วมันจะไม่เด้งกลับมาเปิดเอง
 *
 * ปลอดภัยกับโค้ดที่วน platformsJson อยู่แล้ว: enabled=false ทำให้ enqueueForLead ข้าม
 * ตั้งแต่บรรทัดแรก และหน้า Conversion Mapping วาดคอลัมน์จาก PLATFORMS ไม่ได้วาดจาก JSON
 * คีย์นี้จึงไม่โผล่ใน UI
 */
export const RULE_SCHEMA_KEY = "__schema";

/** 2 = เปิด "คนทัก" (NEW) ให้แพลตฟอร์มโฆษณาเป็นค่าเริ่มต้น (14 ส.ค. 2026) */
export const RULE_SCHEMA_VERSION = 2;

/** Build the default per-platform config for a given lead status. */
export function defaultPlatformsForStatus(status: LeadStatus): PlatformsConfig {
  const cfg: PlatformsConfig = {};
  for (const p of PLATFORMS) {
    const eventName = p.events[status];
    if (!eventName) continue; // LOST has no events
    cfg[p.id] = { enabled: p.defaultOn.includes(status), eventName };
  }
  return cfg;
}
