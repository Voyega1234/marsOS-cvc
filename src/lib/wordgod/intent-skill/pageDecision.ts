/**
 * Keyword Intent Skill — ตัดสินประเภทหน้า (ขั้นที่ 3)
 */
import type { BusinessProfile, FitResult, IntentSkillInputRow, KeywordIntent, PageTier, UnifiedPageType } from './types';
import { detectThaiProvince, isComparisonCue, isPriceCue, isProductCue, isToolCue } from './cues';
import { containsTerm } from './thaiNormalize';

const TIER_BY_PAGE: Record<UnifiedPageType, PageTier> = {
  HOMEPAGE: 'PRIMARY',
  SERVICE: 'PRIMARY',
  CATEGORY: 'PRIMARY',
  LOCATION: 'SECONDARY',
  COMPARISON: 'SECONDARY',
  TOOL: 'SECONDARY',
  BLOG: 'BLOG',
};

export function decidePage(
  row: IntentSkillInputRow,
  intent: KeywordIntent,
  fit: FitResult,
  profile?: BusinessProfile
): { pageType: UnifiedPageType; tier: PageTier } {
  let pageType: UnifiedPageType;

  if (fit.verdict === 'ARTICLE_ONLY') {
    pageType = 'BLOG';
  } else if (intent.primary === 'N' && profile?.ownBrand && containsTerm(row.keyword, profile.ownBrand)) {
    pageType = 'HOMEPAGE';
  } else if (isToolCue(row.keyword)) {
    pageType = 'TOOL';
  } else if (intent.primary === 'C' && isComparisonCue(row.keyword)) {
    pageType = 'COMPARISON';
  } else if (intent.primary === 'T' || intent.mix === 'C/T') {
    const location = row.location ?? detectThaiProvince(row.keyword);
    const branches = profile?.branches ?? [];
    const branchesEmpty = branches.length === 0;
    const branchMatch = branches.some(b => containsTerm(row.keyword, b) || (location ? containsTerm(location, b) : false));
    const localPackWithLocation = !!row.hasLocalPack && !!location;

    if (location && (branchesEmpty || branchMatch)) {
      pageType = 'LOCATION';
    } else if (localPackWithLocation) {
      pageType = 'LOCATION';
    } else if (isProductCue(row.keyword) && (profile?.hasShop || row.legacyPageType === 'CATEGORY_PAGE' || row.legacyPageType === 'PRODUCT_PAGE')) {
      pageType = 'CATEGORY';
    } else {
      pageType = 'SERVICE';
    }
  } else if (intent.primary === 'C' && isPriceCue(row.keyword)) {
    const servicesOffered = profile?.servicesOffered ?? [];
    const noProfile = !profile;
    const matches = servicesOffered.some(s => containsTerm(row.keyword, s));
    pageType = noProfile || matches ? 'SERVICE' : 'BLOG';
  } else if (intent.primary === 'I') {
    pageType = 'BLOG';
  } else {
    // C ที่เหลือ (ไม่มี comparison cue ไม่มี price cue)
    pageType = 'COMPARISON';
  }

  return { pageType, tier: TIER_BY_PAGE[pageType] };
}

/** แปลง PageType เดิม (โหมด online) เป็น UnifiedPageType — null ถ้าไม่รู้จัก */
export function fromLegacyPageType(s: string | null | undefined): UnifiedPageType | null {
  switch (s) {
    case 'LANDING_PAGE':
      return 'SERVICE';
    case 'PRODUCT_PAGE':
    case 'CATEGORY_PAGE':
      return 'CATEGORY';
    case 'ARTICLE':
    case 'FAQ_PAGE':
    case 'CASE_STUDY':
      return 'BLOG';
    case 'COMPARISON_PAGE':
      return 'COMPARISON';
    // SuggestedPageType (โหมด local)
    case 'main_service':
    case 'pricing':
      return 'SERVICE';
    case 'location':
    case 'service_area':
    case 'gbp':
      return 'LOCATION';
    case 'faq':
    case 'blog':
      return 'BLOG';
    case 'existing':
      return 'SERVICE';
    default:
      return null;
  }
}
