import { createHash, randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import type { TrackingPlatform } from "@/lib/line-tracking/enums";
import type { AdClick } from "@prisma/client";
import { classifyChannel } from "./channelService";
import { saveBrowserIds } from "./clickSignalService";
import { cleanGoogleBraid, cleanLineClickId, hasBrowserIds, isPlausibleClickId, type BrowserIds } from "@/lib/line-tracking/browserIds";

export function getTrackingBaseUrl(): string {
  // Tracking links / embed must point at the PUBLIC production domain (where the embed
  // runs), never localhost. Priority: explicit env → Vercel deployment URL → localhost.
  const explicit = process.env.TRACKING_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return "http://localhost:12123";
}

/** Build the three default platform tracking links + allow custom. */
export function buildTrackingUrl(platform: TrackingPlatform, slug: string): string {
  const base = `${getTrackingBaseUrl()}/t/${slug}`;
  switch (platform) {
    case "GOOGLE":
      return `${base}?utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_term={keyword}&utm_content={creative}&gclid={gclid}`;
    case "META":
      // ไม่ใส่ &fbclid={{fbclid}} — Meta ไม่มี macro ตัวนี้ (ต่างจาก {gclid} ของ Google)
      // Meta ต่อ ?fbclid=... ให้เองตอนคนคลิกโฆษณา ถ้าเขียนไว้จะกลายเป็นข้อความดิบ
      // "{{fbclid}}" ซ้อนกับตัวจริงที่ Meta ต่อมา แล้วเก็บค่าผิดเข้า DB
      return `${base}?utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_adset={{adset.name}}&utm_content={{ad.name}}`;
    case "TIKTOK":
      return `${base}?utm_source=tiktok&utm_medium=paid_social&utm_campaign=__CAMPAIGN_NAME__&utm_content=__CID_NAME__&ttclid=__CLICKID__`;
    default:
      return base;
  }
}

/** Tracking-link templates for EVERY channel (paid + organic + manual). */
export function allChannelTemplates(slug: string): { key: string; label: string; url: string }[] {
  const base = `${getTrackingBaseUrl()}/t/${slug}`;
  return [
    { key: "GOOGLE", label: "Google Ads", url: buildTrackingUrl("GOOGLE", slug) },
    { key: "META", label: "Meta (FB/IG)", url: buildTrackingUrl("META", slug) },
    { key: "TIKTOK", label: "TikTok Ads", url: buildTrackingUrl("TIKTOK", slug) },
    { key: "LINE_ADS", label: "LINE Ads", url: `${base}?utm_source=line&utm_medium=paid_social&utm_campaign={campaign}&ldtag_cl={ldtag_cl}` },
    { key: "MICROSOFT", label: "Microsoft / Bing", url: `${base}?utm_source=bing&utm_medium=cpc&utm_campaign={CampaignId}&utm_term={keyword}&msclkid={msclkid}` },
    { key: "X", label: "X (Twitter) Ads", url: `${base}?utm_source=twitter&utm_medium=paid_social&utm_campaign={campaign}&twclid={twclid}` },
    { key: "SNAPCHAT", label: "Snapchat Ads", url: `${base}?utm_source=snapchat&utm_medium=paid_social&utm_campaign={campaign}&ScCid={ScCid}` },
    { key: "YOUTUBE", label: "YouTube", url: `${base}?utm_source=youtube&utm_medium=video&utm_campaign={campaign}&gclid={gclid}` },
    { key: "EMAIL", label: "อีเมล / Newsletter", url: `${base}?utm_source=email&utm_medium=email&utm_campaign={campaign}` },
    { key: "ORGANIC", label: "Organic / โพสต์ทั่วไป", url: `${base}?utm_source=organic&utm_medium=social&utm_campaign={campaign}` },
  ];
}

/**
 * Direct "capture + redirect to LINE" link (no landing page). Same params as the
 * landing link but via /go/ — for Facebook posts, bio links, one-tap Add LINE.
 */
export function buildDirectUrl(platform: TrackingPlatform, slug: string): string {
  return buildTrackingUrl(platform, slug).replace(`/t/${slug}`, `/go/${slug}`);
}

/** A simple direct link for organic Facebook posts (source=facebook / social). */
export function buildFacebookPostUrl(slug: string): string {
  return `${getTrackingBaseUrl()}/go/${slug}?utm_source=facebook&utm_medium=social&utm_campaign=post`;
}

/** Ensure the three default platform tracking links exist for a project. */
export async function ensureDefaultTrackingLinks(projectId: string, slug: string) {
  const defaults: { platform: TrackingPlatform; name: string }[] = [
    { platform: "GOOGLE", name: "Google Ads (default)" },
    { platform: "META", name: "Meta Ads (default)" },
    { platform: "TIKTOK", name: "TikTok Ads (default)" },
  ];
  // Was 3 × (findFirst + create) issued one after another. Now: one lookup for all
  // three, then one insert for whichever are missing — same rows, same skip-if-exists
  // behaviour, 2 round-trips instead of up to 6.
  const existing = await prisma.trackingLink.findMany({
    where: { projectId, name: { in: defaults.map((d) => d.name) } },
    select: { platform: true, name: true },
  });
  const have = new Set(existing.map((e) => `${e.platform}|${e.name}`));
  const missing = defaults.filter((d) => !have.has(`${d.platform}|${d.name}`));
  if (missing.length) {
    await prisma.trackingLink.createMany({
      data: missing.map((d) => ({
        projectId,
        platform: d.platform,
        name: d.name,
        url: buildTrackingUrl(d.platform, slug),
      })),
    });
  }
}

/**
 * ประทับเวลาว่า "คนนี้กดปุ่มไปต่อที่ LINE แล้ว" ลงบนคลิกนั้น
 *
 * LINE ไม่ส่งข้อมูลอะไรติดมากับ event follow/message เลย ระบบจึงต้องจับคู่
 * คลิก↔คนแอดด้วยหน้าต่างเวลา (leadService: คนที่ "กดปุ่มแอดไลน์" ภายใน 3 ชม.
 * ก่อน ไม่งั้นค่อยถอยไปใช้คลิกใดก็ได้ใน 30 นาที) — ตัวชี้ขาดคือ lineClickedAt
 *
 * ของเดิมมีแต่ embed script กับ LIFF ที่ประทับให้ ส่วนทางหลัก
 * /t/ และ /go/ → /line/start → เด้งเข้า LINE ทิ้ง click_id ไปเฉย ๆ
 * lead จากโฆษณาเลยตกไปใช้หน้าต่าง 30 นาทีแบบหยาบ และตัวเลข "กดปุ่มแอดไลน์"
 * ในแดชบอร์ดก็นับต่ำกว่าจริง
 */
export async function markLineClicked(projectId: string, clickId?: string | null): Promise<void> {
  if (!clickId) return;
  // updateMany: ไม่โยน error ถ้าหา clickId ไม่เจอ (ลิงก์เก่า/ถูกแก้มา)
  // และต้อง await ให้จบก่อน redirect ไม่งั้นบน serverless จะถูกตัดกลางคัน
  // จำกัดที่โปรเจกต์ของลิงก์นี้: endpoint เป็นสาธารณะ click_id ของโปรเจกต์อื่นต้องแตะไม่ได้
  await prisma.adClick
    .updateMany({ where: { clickId, projectId }, data: { lineClickedAt: new Date() } })
    .catch(() => {});
}

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export interface CapturedParams {
  source?: string;
  medium?: string;
  campaign?: string;
  adset?: string;
  content?: string;
  keyword?: string;
  gclid?: string;
  fbclid?: string;
  ttclid?: string;
  msclkid?: string;
  twclid?: string;
  scclid?: string;
  gaClientId?: string;
  /** Ids read from a redirect link (gbraid, wbraid, ldtag_cl); stored with the click as browser ids. */
  browserIds?: BrowserIds;
  landingUrl?: string;
  referrer?: string;
  userAgent?: string;
  ip?: string;
  /** Set when the click itself is the "go to LINE" step (LIFF link): stored in the same insert. */
  lineClickedAt?: Date;
}

/**
 * Record an ad click for a project. Generates a unique clickId and stores all
 * captured UTM + click identifiers. IP is hashed (never stored raw).
 */
export async function recordAdClick(
  projectId: string,
  params: CapturedParams
): Promise<AdClick> {
  const clickId = `clk_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const { channel, channelGroup } = classifyChannel({
    source: params.source,
    medium: params.medium,
    gclid: params.gclid,
    fbclid: params.fbclid,
    ttclid: params.ttclid,
    msclkid: params.msclkid,
    twclid: params.twclid,
    scclid: params.scclid,
    referrer: params.referrer,
  });
  const click = await prisma.adClick.create({
    data: {
      projectId,
      clickId,
      source: params.source,
      medium: params.medium,
      campaign: params.campaign,
      adset: params.adset,
      content: params.content,
      keyword: params.keyword,
      gclid: params.gclid,
      fbclid: params.fbclid,
      ttclid: params.ttclid,
      msclkid: params.msclkid,
      twclid: params.twclid,
      scclid: params.scclid,
      gaClientId: params.gaClientId,
      channel,
      channelGroup,
      landingUrl: params.landingUrl,
      referrer: params.referrer,
      userAgent: params.userAgent,
      ipHash: hashIp(params.ip ?? null),
      lineClickedAt: params.lineClickedAt,
    },
  });
  // The click was created in this request, so no ownership lookup is needed. Never throws.
  if (params.browserIds && hasBrowserIds(params.browserIds)) {
    await saveBrowserIds(projectId, click.clickId, params.browserIds, { trusted: true });
  }
  return click;
}

/**
 * macro ของแพลตฟอร์มโฆษณาที่ "ยังไม่ถูกแทนค่า" — {gclid}, {{campaign.name}},
 * __CLICKID__, %%CACHEBUSTER%% ฯลฯ เกิดได้เมื่อวางลิงก์ผิดช่อง / แพลตฟอร์มไม่รู้จัก
 * macro ตัวนั้น ถ้าปล่อยผ่านจะได้ click id ปลอมเข้า DB แล้ว match กับ Meta ไม่ติด
 * ทั้งที่ดูเหมือนเก็บค่าได้
 */
const MACRO_PLACEHOLDER = /^(\{.*\}|__.*__|%%.*%%)$/;

/**
 * อ่านค่าจาก query โดยข้าม macro ที่ไม่ถูกแทน และเลือก "ตัวหลังสุด" เมื่อคีย์ซ้ำ
 * — Meta/TikTok ต่อ click id ของจริงเข้ามาท้าย URL เอง คีย์จึงซ้ำได้
 * ของเดิมใช้ sp.get() ที่คืนตัวแรกเสมอ เลยได้ macro ดิบแทนค่าจริง
 */
function pickParam(sp: URLSearchParams, key: string): string | undefined {
  const all = sp.getAll(key);
  for (let i = all.length - 1; i >= 0; i--) {
    const v = all[i].trim();
    if (v && !MACRO_PLACEHOLDER.test(v)) return v;
  }
  return undefined;
}

/** Like pickParam, for click ids: the last value that is not a macro and has the shape of an id. */
function pickClickId(sp: URLSearchParams, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const all = sp.getAll(key);
    for (let i = all.length - 1; i >= 0; i--) {
      const v = all[i].trim();
      if (v && !MACRO_PLACEHOLDER.test(v) && isPlausibleClickId(v)) return v;
    }
  }
  return undefined;
}

/** Extract captured params from a URLSearchParams (tracking page query). */
export function extractParams(sp: URLSearchParams): CapturedParams {
  const g = (k: string) => pickParam(sp, k);
  const c = (...keys: string[]) => pickClickId(sp, ...keys);
  const browserIds: BrowserIds = {};
  const gbraid = cleanGoogleBraid(c("gbraid"));
  if (gbraid) browserIds.gbraid = gbraid;
  const wbraid = cleanGoogleBraid(c("wbraid"));
  if (wbraid) browserIds.wbraid = wbraid;
  const lineClickId = cleanLineClickId(c("ldtag_cl"));
  if (lineClickId) browserIds.lineClickId = lineClickId;
  return {
    source: g("utm_source"),
    medium: g("utm_medium"),
    campaign: g("utm_campaign"),
    adset: g("utm_adset"),
    content: g("utm_content"),
    keyword: g("utm_term") ?? g("keyword"),
    gclid: c("gclid"),
    fbclid: c("fbclid"),
    ttclid: c("ttclid"),
    msclkid: c("msclkid"),
    twclid: c("twclid"),
    // ScCid = ชื่อพารามิเตอร์ที่เทมเพลต Snapchat ด้านบนใช้จริง เดิมไม่มีในนี้ เลยหล่นทุกครั้ง
    scclid: c("scclid", "sc_click_id", "ScCid"),
    gaClientId: c("ga_client_id", "_ga"),
    browserIds,
  };
}
