/**
 * Keyword Intent Skill — แปลงผลลัพธ์เดิม (โหมด online/local) เป็น IntentSkillInputRow
 * และ parse ข้อมูลธุรกิจ (BusinessProfile) จาก input ดิบ (ฟอร์ม/JSON)
 */
import type { GoogleMetricData, DfsMetricData, ReferenceVolume } from '../local/metrics';
import type { KeywordResearchResult } from '../local/types';
import type { OnlineKeywordResult } from '../online/types';
import type { BusinessProfile, IntentSkillInputRow } from './types';

function pickVolume(google: GoogleMetricData, dfs: DfsMetricData, reference: ReferenceVolume): number | null {
  if (google.status === 'ok' || google.status === 'zero') return google.avgMonthlySearches ?? 0;
  if (dfs.status === 'ok' || dfs.status === 'zero') return dfs.searchVolume ?? 0;
  return reference.volume;
}

/** โหมด online_business (ไม่มีหน้าร้าน) → IntentSkillInputRow */
export function fromOnlineRow(r: OnlineKeywordResult): IntentSkillInputRow {
  const serpOk = r.serp?.status === 'ok';
  return {
    key: r.keyword,
    keyword: r.keyword,
    volume: pickVolume(r.google, r.dfs, r.reference),
    dfsIntent: r.searchIntent?.intent ?? null,
    dfsProbability: r.searchIntent?.probability ?? null,
    serpTopUrls: serpOk ? r.serp.topUrls : undefined,
    serpIntent: serpOk ? r.serp.serpIntent : null,
    serpServicePageCount: serpOk ? r.serp.servicePageCount : undefined,
    serpArticleCount: serpOk ? r.serp.articleCount : undefined,
    hasLocalPack: serpOk ? r.serp.hasLocalPack : undefined,
    location: null,
    service: r.serviceOrProduct ?? null,
    legacyCluster: r.cluster ?? null,
    legacyPageType: r.pageType ?? null,
    title: r.recommendedTitle ?? null,
    slug: r.suggestedSlug ?? null,
  };
}

/** โหมด Local SME (มีหน้าร้าน/พื้นที่บริการ) → IntentSkillInputRow */
export function fromLocalRow(r: KeywordResearchResult): IntentSkillInputRow {
  const intel = r.intel;
  const serpOk = intel?.serp?.status === 'ok';
  const volume =
    r.volume ??
    (intel ? pickVolume(intel.google, intel.dfs, { volume: intel.referenceVolume, source: intel.referenceSource }) : null);

  return {
    key: r.keyword,
    keyword: r.keyword,
    volume: volume ?? null,
    dfsIntent: intel?.searchIntent?.intent ?? null,
    dfsProbability: intel?.searchIntent?.probability ?? null,
    serpTopUrls: serpOk ? intel!.serp.topUrls : undefined,
    serpIntent: serpOk ? intel!.serp.serpIntent : null,
    serpServicePageCount: serpOk ? intel!.serp.servicePageCount : undefined,
    serpArticleCount: serpOk ? intel!.serp.articleCount : undefined,
    hasLocalPack: serpOk ? intel!.serp.hasLocalPack : undefined,
    location: r.location ?? null,
    service: r.service ?? null,
    legacyCluster: r.cluster ?? null,
    legacyPageType: r.suggestedPage ?? null,
    title: r.suggestedTitle ?? null,
    slug: r.slug ?? null,
  };
}

// ── Business profile parsing ─────────────────────────────────────────────────

const MAX_LIST_ITEMS = 60;
const MAX_ITEM_LEN = 80;
const MAX_BRAND_LEN = 80;

/** แปลง field ที่อาจเป็น array หรือ string (คั่นด้วย , หรือขึ้นบรรทัดใหม่) ให้เป็น string[] ที่ trim/dedupe/cap แล้ว */
function toStringList(raw: unknown): string[] {
  let items: string[];
  if (Array.isArray(raw)) {
    items = raw.map(v => String(v ?? ''));
  } else if (typeof raw === 'string') {
    items = raw.split(/[\n,]/g);
  } else {
    items = [];
  }
  const cleaned = items
    .map(s => s.trim().slice(0, MAX_ITEM_LEN))
    .filter(s => s.length > 0);
  return Array.from(new Set(cleaned)).slice(0, MAX_LIST_ITEMS);
}

function toBoolean(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return ['true', '1', 'yes', 'y'].includes(raw.trim().toLowerCase());
  return !!raw;
}

/**
 * parse โปรไฟล์ธุรกิจจาก input ดิบ (ฟอร์ม/JSON ที่ผู้ใช้กรอก)
 * ไม่ใช่ object → undefined; เป็น object (แม้ทุกช่องว่าง) → คืน object เสมอ
 */
export function parseBusinessProfile(raw: unknown): BusinessProfile | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;

  const ownBrandRaw = typeof r.ownBrand === 'string' ? r.ownBrand.trim().slice(0, MAX_BRAND_LEN) : '';

  return {
    servicesOffered: toStringList(r.servicesOffered),
    servicesNotOffered: toStringList(r.servicesNotOffered),
    hasShop: toBoolean(r.hasShop),
    shopProducts: toStringList(r.shopProducts),
    branches: toStringList(r.branches),
    competitorBrands: toStringList(r.competitorBrands),
    ownBrand: ownBrandRaw || undefined,
  };
}
