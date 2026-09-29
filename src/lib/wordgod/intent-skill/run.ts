/**
 * Keyword Intent Skill — orchestrator หลัก
 * รวมทุกขั้น: classify → (AI ช่วยตัดสินที่กำกวม) → fit → page → group → cluster
 *            → ตั้งชื่อคลัสเตอร์ด้วย AI → nestedSlug → auto-approve ตาม quota
 * ไม่โยน error แม้ AI ล้มเหลว — เก็บ warning ไว้ใน result.warnings แทน
 */
import type {
  IntentCode,
  IntentSkillContext,
  IntentSkillInputRow,
  IntentSkillOutput,
  IntentSkillRowFields,
  KeywordIntent,
} from './types';
import { normalizeThaiKey } from './thaiNormalize';
import { classifyIntent } from './classifyIntent';
import { evaluateFit, isProfileEmpty } from './businessFit';
import { decidePage } from './pageDecision';
import { buildGroups, type RowClassification } from './grouping';
import { buildClusters, nameClustersLLM } from './clusters';
import { reclassifyAmbiguous } from './reclassify';
import { autoApprove } from './quota';

function dedupeRows(rows: IntentSkillInputRow[]): IntentSkillInputRow[] {
  const seen = new Set<string>();
  const out: IntentSkillInputRow[] = [];
  for (const r of rows) {
    const key = normalizeThaiKey(r.keyword);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export async function runIntentSkill(rows: IntentSkillInputRow[], ctx: IntentSkillContext): Promise<IntentSkillOutput> {
  const warnings: string[] = [];
  const dedupedRows = dedupeRows(rows);

  // 1) classify
  const intents = new Map<string, KeywordIntent>();
  for (const row of dedupedRows) {
    intents.set(row.key, classifyIntent(row, ctx.profile));
  }

  // 2) AI ช่วยตัดสิน intent ที่กำกวม (ถ้ามี ctx.llm)
  try {
    const { warnings: w } = await reclassifyAmbiguous(dedupedRows, intents, ctx);
    warnings.push(...w);
  } catch {
    warnings.push('AI ช่วยตัดสิน intent ล้มเหลวโดยไม่คาดคิด — ใช้ผลจาก rule เดิม');
  }

  // 3) fit + 4) page
  const fits = new Map(dedupedRows.map(row => [row.key, evaluateFit(row, intents.get(row.key)!, ctx.profile)] as const));
  const pages = new Map(
    dedupedRows.map(row => [row.key, decidePage(row, intents.get(row.key)!, fits.get(row.key)!, ctx.profile)] as const)
  );

  // 5) group
  const perRow = new Map<string, RowClassification>(
    dedupedRows.map(row => [row.key, { intent: intents.get(row.key)!, fit: fits.get(row.key)!, page: pages.get(row.key)! }] as const)
  );
  const { groups, groupIdByKey, headKeyByGroupId } = buildGroups(dedupedRows, perRow, { minSerpOverlap: 3 });

  const primaryByGroupId = new Map<string, IntentCode>();
  for (const [groupId, headKey] of Array.from(headKeyByGroupId)) {
    primaryByGroupId.set(groupId, intents.get(headKey)!.primary);
  }

  // 6) cluster (rowsByKey ของ buildClusters คือ map จาก "keyword ของ head" → แถวต้นฉบับ)
  const rowsByKeyword = new Map(dedupedRows.map(row => [row.keyword, row] as const));
  const { clusters, groupClusterId } = buildClusters(groups, rowsByKeyword, {
    servicesOffered: ctx.profile?.servicesOffered,
    primaryByGroupId,
  });

  for (const g of groups) g.clusterId = groupClusterId.get(g.id) ?? '';

  // 7) ตั้งชื่อคลัสเตอร์ + เติม slug/pageTitle ที่ขาดด้วย AI
  try {
    const { warnings: w } = await nameClustersLLM(clusters, groups, ctx);
    warnings.push(...w);
  } catch {
    warnings.push('ตั้งชื่อ Topic Cluster ล้มเหลวโดยไม่คาดคิด — ใช้ชื่อสำรอง');
  }

  // 8) nestedSlug (pillar = /slugBase/, spoke = /slugBase/slug/)
  const clusterById = new Map(clusters.map(c => [c.id, c] as const));
  for (const g of groups) {
    const cluster = clusterById.get(g.clusterId);
    if (!cluster) {
      g.nestedSlug = `/${g.slug || g.id}/`;
      continue;
    }
    g.nestedSlug = g.id === cluster.pillarGroupId ? `/${cluster.slugBase}/` : `/${cluster.slugBase}/${g.slug}/`;
  }

  // 9) group-level remark ของ head เอง (fit.remarkTh + needsReview) — ไม่รวมข้อความ "รวมเข้ากลุ่ม"
  for (const g of groups) {
    const headKey = headKeyByGroupId.get(g.id);
    const headFit = headKey ? fits.get(headKey) : undefined;
    const headIntent = headKey ? intents.get(headKey) : undefined;
    g.remark = [headFit?.remarkTh || null, headIntent?.needsReview ? 'ให้คนตรวจ intent' : null].filter(Boolean).join(' · ');
  }

  // 10) auto-approve ตาม quota
  const approvedCount = autoApprove(groups, ctx.quota);

  // 11) rowFields ต่อคีย์เวิร์ด
  const rowFields: Record<string, IntentSkillRowFields> = {};
  for (const row of dedupedRows) {
    const key = row.key;
    const intent = intents.get(key)!;
    const fit = fits.get(key)!;
    const page = pages.get(key)!;
    const groupId = groupIdByKey.get(key) ?? '';
    const group = groups.find(g => g.id === groupId);
    const isGroupHead = headKeyByGroupId.get(groupId) === key;
    const cluster = group ? clusterById.get(group.clusterId) : undefined;

    const remarkParts = [
      fit.remarkTh || null,
      !isGroupHead && group ? `รวมเข้ากลุ่ม "${group.head}"` : null,
      intent.needsReview ? 'ให้คนตรวจ intent' : null,
    ].filter(Boolean);

    rowFields[key] = {
      intent,
      fit,
      pageType: page.pageType,
      tier: page.tier,
      groupId,
      isGroupHead,
      clusterId: group?.clusterId ?? '',
      clusterName: cluster?.name ?? '',
      section: cluster?.section ?? '',
      nestedSlug: group?.nestedSlug ?? '',
      remark: remarkParts.join(' · '),
      approved: group?.approved ?? false,
    };
  }

  // 12) stats
  let fitCount = 0;
  let articleOnlyCount = 0;
  let notRecommendedCount = 0;
  let needsReviewCount = 0;
  for (const row of dedupedRows) {
    const fit = fits.get(row.key)!;
    if (fit.verdict === 'FIT') fitCount++;
    else if (fit.verdict === 'ARTICLE_ONLY') articleOnlyCount++;
    else if (fit.verdict === 'NOT_RECOMMENDED') notRecommendedCount++;
    if (intents.get(row.key)!.needsReview) needsReviewCount++;
  }

  return {
    rowFields,
    result: {
      version: 1,
      generatedAt: new Date().toISOString(),
      profileUsed: !!ctx.profile,
      profile: ctx.profile,
      groups,
      clusters,
      quota: { requested: ctx.quota ?? null, approved: approvedCount },
      stats: {
        rows: dedupedRows.length,
        groups: groups.length,
        clusters: clusters.length,
        needsReview: needsReviewCount,
        fit: fitCount,
        articleOnly: articleOnlyCount,
        notRecommended: notRecommendedCount,
      },
      warnings,
    },
  };
}

// เผื่อ caller อยากเช็คว่าโปรไฟล์ว่างเปล่าไหมโดยตรง
export { isProfileEmpty };
