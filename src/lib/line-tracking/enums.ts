// Central definitions for the String-based "enums" used across the schema.
// SQLite has no native enums; these constants + types keep everything typed.

export const PROJECT_STATUS = ["DRAFT", "SETUP", "LIVE", "PAUSED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUS)[number];

export const CONNECTION_TYPES = [
  "LINE",
  "GOOGLE_SHEET",
  "GA4",
  "GOOGLE_ADS",
  "META_ADS",
  "TIKTOK_ADS",
  "LINE_ADS",
  "MICROSOFT_ADS",
  "X_ADS",
  "SNAPCHAT_ADS",
  "CUSTOM_WEBHOOK",
] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

/** Ad connectors used for setup grouping (everything except LINE/Sheet/GA4). */
export const AD_CONNECTION_TYPES: ConnectionType[] = [
  "GOOGLE_ADS",
  "META_ADS",
  "TIKTOK_ADS",
  "LINE_ADS",
  "MICROSOFT_ADS",
  "X_ADS",
  "SNAPCHAT_ADS",
  "CUSTOM_WEBHOOK",
];

export const CONNECTION_STATUS = ["NOT_CONNECTED", "CONNECTED", "ERROR"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUS)[number];

export const TRACKING_PLATFORMS = ["GOOGLE", "META", "TIKTOK", "CUSTOM"] as const;
export type TrackingPlatform = (typeof TRACKING_PLATFORMS)[number];

export const LEAD_STATUS = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "QUOTED",
  "BOOKED",
  "WON",
  "PAID",
  "LOST",
] as const;
export type LeadStatus = (typeof LEAD_STATUS)[number];

export const CONVERSION_STATE = [
  "NOT_READY",
  "QUEUED",
  "SENT",
  "FAILED",
  "SKIPPED",
] as const;
export type ConversionState = (typeof CONVERSION_STATE)[number];

export const CONVERSION_PLATFORMS = ["GA4", "GOOGLE_ADS", "META", "TIKTOK"] as const;
export type ConversionPlatform = (typeof CONVERSION_PLATFORMS)[number];

export const CONVERSION_EVENT_STATUS = [
  "PENDING",
  "SENT",
  "FAILED",
  "SKIPPED",
] as const;
export type ConversionEventStatus = (typeof CONVERSION_EVENT_STATUS)[number];

export const MAX_RETRY = 3;

// Human-friendly Thai labels for lead statuses (code identifiers stay English).
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: "ลูกค้าใหม่",
  CONTACTED: "ติดต่อแล้ว",
  QUALIFIED: "คุณภาพผ่าน",
  QUOTED: "เสนอราคาแล้ว",
  BOOKED: "จองสำเร็จ",
  WON: "ปิดการขาย",
  PAID: "ชำระเงินแล้ว",
  LOST: "หลุด/ไม่สนใจ",
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  DRAFT: "ร่าง",
  SETUP: "กำลังตั้งค่า",
  LIVE: "ใช้งานจริง",
  PAUSED: "หยุดชั่วคราว",
};

export const CONNECTION_LABEL: Record<ConnectionType, string> = {
  LINE: "LINE OA",
  GOOGLE_SHEET: "Google Sheet",
  GA4: "GA4",
  GOOGLE_ADS: "Google Ads",
  META_ADS: "Meta Ads",
  TIKTOK_ADS: "TikTok Ads",
  LINE_ADS: "LINE Ads",
  MICROSOFT_ADS: "Microsoft Ads",
  X_ADS: "X Ads",
  SNAPCHAT_ADS: "Snapchat Ads",
  CUSTOM_WEBHOOK: "Custom Webhook",
};
