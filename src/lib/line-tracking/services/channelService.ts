// Channel attribution engine — GA4-style default channel grouping, extended
// with an "AI Assistant" channel (ChatGPT / Perplexity / Gemini / Copilot ...).
// Classifies a click from its source/medium/click-ids/referrer into:
//   channelGroup: coarse bucket used for reports
//   channel:      "source / medium" style detail string

export const CHANNEL_GROUPS = [
  "Paid Search",
  "Paid Social",
  "Paid Other",
  "AI Assistant",
  "Organic Search",
  "Organic Social",
  "Email",
  "Referral",
  "Direct",
] as const;
export type ChannelGroup = (typeof CHANNEL_GROUPS)[number];

export const CHANNEL_GROUP_LABEL: Record<ChannelGroup, string> = {
  "Paid Search": "โฆษณา Search",
  "Paid Social": "โฆษณา Social",
  "Paid Other": "โฆษณาอื่น ๆ",
  "AI Assistant": "AI Search (ChatGPT/Perplexity/…)",
  "Organic Search": "Organic Search",
  "Organic Social": "Social (Organic)",
  Email: "อีเมล",
  Referral: "เว็บอ้างอิง (Referral)",
  Direct: "เข้าตรง (Direct)",
};

const AI_HOSTS = [
  "chatgpt.com", "chat.openai.com", "openai.com",
  "perplexity.ai", "gemini.google.com", "bard.google.com",
  "copilot.microsoft.com", "bing.com/chat",
  "claude.ai", "you.com", "poe.com", "phind.com", "meta.ai",
];
const SEARCH_HOSTS = ["google.", "bing.", "yahoo.", "duckduckgo.", "baidu.", "yandex.", "ecosia.", "naver."];
const SOCIAL_HOSTS = [
  "facebook.", "fb.com", "fb.watch", "instagram.", "tiktok.", "youtube.", "youtu.be",
  "twitter.", "x.com", "linkedin.", "pinterest.", "line.me", "lin.ee", "reddit.", "threads.",
];

function hostOf(url?: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function matchAny(host: string, list: string[]): boolean {
  return list.some((h) => host.includes(h));
}

export interface ClassifyInput {
  source?: string | null;
  medium?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  ttclid?: string | null;
  msclkid?: string | null;
  twclid?: string | null;
  scclid?: string | null;
  referrer?: string | null;
}

export interface ChannelResult {
  channelGroup: ChannelGroup;
  channel: string; // "source / medium" detail
}

const PAID_MEDIUMS = ["cpc", "ppc", "paid", "paidsearch", "paid_search", "paid-search"];
const PAID_SOCIAL_MEDIUMS = ["paid_social", "paidsocial", "paid-social", "social_paid"];
const DISPLAY_MEDIUMS = ["display", "cpm", "banner", "programmatic"];
const SOCIAL_SOURCES = ["facebook", "instagram", "tiktok", "ig", "fb", "line", "youtube", "linkedin", "twitter", "x"];

/**
 * Classify a visit into a channel group. Order matters: explicit paid click ids
 * and mediums win first, then referrer host heuristics, then direct.
 */
export function classifyChannel(input: ClassifyInput): ChannelResult {
  const source = (input.source ?? "").toLowerCase().trim();
  const medium = (input.medium ?? "").toLowerCase().trim();
  const host = hostOf(input.referrer);
  const detail = `${source || (host || "(direct)")} / ${medium || "(none)"}`;

  // 1) Paid — by click id or paid medium
  if (input.gclid || input.msclkid || PAID_MEDIUMS.includes(medium)) {
    return { channelGroup: "Paid Search", channel: detail };
  }
  if (input.fbclid || input.ttclid || input.twclid || input.scclid || PAID_SOCIAL_MEDIUMS.includes(medium)) {
    return { channelGroup: "Paid Social", channel: detail };
  }
  if (DISPLAY_MEDIUMS.includes(medium)) {
    return { channelGroup: "Paid Other", channel: detail };
  }

  // 2) Email
  if (medium === "email" || source === "email" || source === "newsletter") {
    return { channelGroup: "Email", channel: detail };
  }

  // 3) Explicit organic markers
  if (medium === "organic") {
    return { channelGroup: "Organic Search", channel: detail };
  }
  if (medium === "social" || SOCIAL_SOURCES.includes(source)) {
    return { channelGroup: "Organic Social", channel: detail };
  }

  // 4) Referrer host heuristics (when no UTM tagging)
  if (host) {
    if (matchAny(host, AI_HOSTS)) return { channelGroup: "AI Assistant", channel: `${host} / referral` };
    if (matchAny(host, SEARCH_HOSTS)) return { channelGroup: "Organic Search", channel: `${host} / organic` };
    if (matchAny(host, SOCIAL_HOSTS)) return { channelGroup: "Organic Social", channel: `${host} / social` };
    return { channelGroup: "Referral", channel: `${host} / referral` };
  }

  // 5) Nothing → Direct
  return { channelGroup: "Direct", channel: "(direct) / (none)" };
}

// ── ตัวกรอง "ราย channel" ที่ใช้ร่วมกันทุกหน้า/ทุกโปรเจกต์ ────────────────────
// วางไว้ที่นี่เพราะเป็นคำศัพท์ชุดเดียวกับ CHANNEL_GROUPS/CHANNEL_GROUP_LABEL —
// หน้าไหนอยากมีตัวกรอง channel ก็ import ชุดนี้ ไม่ต้องนิยามคีย์เองให้หลุดกัน

export type ChannelQuery = { channel?: string };

/** ค่าใน query string ที่แปลว่า "ไม่กรอง" */
export const ALL_CHANNELS = "all";

/**
 * channel ที่เลือกอยู่ — ไม่ส่งมา / ว่าง = "ทั้งหมด"
 *
 * ตั้งใจไม่เช็คกับ CHANNEL_GROUPS เพราะข้อมูลจริงของลูกค้ามี channelGroup ที่ระบบเคยตั้งชื่อ
 * ไว้แบบเก่าแล้วเปลี่ยนทีหลัง (เช่น ชื่อกลุ่มที่เคยใช้ก่อนเปลี่ยนเป็น "AI Assistant") ถ้าเช็ค
 * กับรายชื่อปัจจุบัน ชิปของ lead กลุ่มนั้นจะกดแล้วเด้งกลับเป็น "ทุกช่องทาง" เงียบ ๆ
 * ชิปถูกสร้างจากค่าที่มีอยู่จริงในฐานข้อมูลอยู่แล้ว จึงยึดค่าที่ส่งมาได้เลย
 */
export function activeChannelKey(sp: ChannelQuery): string {
  const c = sp.channel?.trim();
  if (!c || c === ALL_CHANNELS) return ALL_CHANNELS;
  return c.slice(0, 64);
}

/** ป้ายภาษาไทยของ channel group — คีย์ที่ไม่รู้จักคืนตัวมันเองไป ไม่ระเบิด */
export function channelGroupLabel(key: string): string {
  return CHANNEL_GROUP_LABEL[key as ChannelGroup] ?? key;
}
