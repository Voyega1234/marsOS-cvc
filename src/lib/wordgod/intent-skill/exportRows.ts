/**
 * Keyword Intent Skill — แปลงผลลัพธ์เป็นแถวสำหรับ export Sheet/Excel
 */
import type { IntentSkillResult, KeywordGroup, PageTier, TopicCluster } from './types';
import { PAGE_TYPE_LABEL_TH } from './handoff';

export const SHEET_COLUMNS = [
  'Section',
  'Cluster',
  'Page Title',
  'Slug',
  'Page Type',
  'Pillar Intent',
  'Page Tier',
  'Keyword Group',
  'Highest SV',
  'Keywords',
  'Intent',
  'Remark',
  'Approved',
] as const;

export interface SheetRow {
  'Section': string;
  'Cluster': string;
  'Page Title': string;
  'Slug': string;
  'Page Type': string;
  'Pillar Intent': string;
  'Page Tier': string;
  'Keyword Group': string;
  'Highest SV': number | '';
  'Keywords': string;
  'Intent': string;
  'Remark': string;
  'Approved': 'TRUE' | 'FALSE';
}

const TIER_LABEL: Record<PageTier, string> = {
  PRIMARY: 'Primary',
  SECONDARY: 'Secondary',
  BLOG: 'Blog',
};

function pageTypeLabel(group: KeywordGroup): string {
  return `${PAGE_TYPE_LABEL_TH[group.pageType]} (${group.pageType})`;
}

function toSheetRow(group: KeywordGroup, cluster: TopicCluster | undefined): SheetRow {
  return {
    'Section': cluster?.section ?? '',
    'Cluster': cluster?.name ?? '',
    'Page Title': group.pageTitle,
    'Slug': group.nestedSlug || group.slug,
    'Page Type': pageTypeLabel(group),
    'Pillar Intent': cluster?.pillarIntent ?? '',
    'Page Tier': TIER_LABEL[group.tier],
    'Keyword Group': group.head,
    'Highest SV': group.highestSv ?? '',
    'Keywords': group.keywords.join('\n'),
    'Intent': group.intent,
    'Remark': group.remark,
    'Approved': group.approved ? 'TRUE' : 'FALSE',
  };
}

/**
 * เรียงตามคลัสเตอร์ (pillar ก่อน) → tier (Primary → Secondary → Blog) → highestSv มาก→น้อย
 */
export function toSheetRows(result: IntentSkillResult): SheetRow[] {
  const clusterById = new Map(result.clusters.map(c => [c.id, c] as const));
  const tierOrder: Record<PageTier, number> = { PRIMARY: 0, SECONDARY: 1, BLOG: 2 };

  const clusterOrder = new Map(result.clusters.map((c, idx) => [c.id, idx] as const));

  const sorted = result.groups.slice().sort((a, b) => {
    const clusterIdxA = clusterOrder.get(a.clusterId) ?? Number.MAX_SAFE_INTEGER;
    const clusterIdxB = clusterOrder.get(b.clusterId) ?? Number.MAX_SAFE_INTEGER;
    if (clusterIdxA !== clusterIdxB) return clusterIdxA - clusterIdxB;

    const clusterA = clusterById.get(a.clusterId);
    const isPillarA = clusterA?.pillarGroupId === a.id;
    const clusterB = clusterById.get(b.clusterId);
    const isPillarB = clusterB?.pillarGroupId === b.id;
    if (isPillarA !== isPillarB) return isPillarA ? -1 : 1;

    if (tierOrder[a.tier] !== tierOrder[b.tier]) return tierOrder[a.tier] - tierOrder[b.tier];
    return (b.highestSv ?? -1) - (a.highestSv ?? -1);
  });

  return sorted.map(g => toSheetRow(g, clusterById.get(g.clusterId)));
}
