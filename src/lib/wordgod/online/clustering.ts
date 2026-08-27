/**
 * Clustering + Cannibalization + Sitemap + Waves (โค้ดล้วน ไม่มี AI)
 * - cluster = สินค้า/บริการ × ธีม journey (อ่านรู้เรื่องเป็น topic cluster จริง)
 * - คำกินกันเอง: ความคล้ายข้อความ (char-bigram dice) + SERP overlap จริง
 * - sitemap = สถาปัตยกรรมเว็บ: section / parent / topic role / path
 * - การคัด: cluster quota — ไม่ใช่ top-N ล้วน เพื่อได้ portfolio สมดุล
 */

import type {
  CannibalizationAction,
  FunnelStage,
  JourneyStage,
  Objective,
  PageType,
  SitemapPlacement,
  SlugStatus,
  TopicRole,
} from './types';
import { orderFreeKey } from '../local/normalize';

// ── ธีมจาก journey stage ────────────────────────────────────────────────────

export interface ThemeDef { key: string; labelTh: string; section: string }

const THEME_BY_STAGE: Record<JourneyStage, ThemeDef> = (() => {
  const T = {
    problem: { key: 'problem', labelTh: 'ปัญหา-อาการ', section: 'problems' },
    knowledge: { key: 'knowledge', labelTh: 'ความรู้-วิธีใช้', section: 'guides' },
    solution: { key: 'solution', labelTh: 'ทางแก้-สินค้า', section: 'solutions' },
    trust: { key: 'trust', labelTh: 'เทียบ-รีวิว', section: 'reviews' },
    buy: { key: 'buy', labelTh: 'ราคา-การซื้อ', section: 'pricing' },
    aeo: { key: 'aeo', labelTh: 'คำถาม (AEO)', section: 'faq' },
    geo: { key: 'geo', labelTh: 'AI Search Topics (GEO)', section: 'topics' },
  };
  return {
    PROBLEM_AWARENESS: T.problem, SYMPTOM_SEARCH: T.problem, CAUSE_EXPLORATION: T.problem,
    EDUCATION_BASICS: T.knowledge, HOW_TO_DIY: T.knowledge, ONBOARDING_USAGE: T.knowledge,
    SOLUTION_AWARENESS: T.solution, SOLUTION_COMPARISON: T.solution, PRODUCT_DISCOVERY: T.solution,
    FEATURE_EXPLORATION: T.solution, USE_CASE_FIT: T.solution,
    VENDOR_COMPARISON: T.trust, REVIEWS_PROOF: T.trust, OBJECTION_RISK: T.trust,
    PRICING_COST: T.buy, PURCHASE_INTENT: T.buy, CHANNEL_WHERE_TO_BUY: T.buy,
    AEO_QUESTION: T.aeo, GEO_AI_TOPIC: T.geo,
  };
})();

export function themeOfStage(stage: JourneyStage): ThemeDef {
  return THEME_BY_STAGE[stage];
}

// ── ความคล้ายข้อความ (เหมาะกับไทยที่ไม่มีเว้นวรรค) ──────────────────────────

function bigrams(s: string): Set<string> {
  const t = s.toLowerCase().replace(/\s+/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

export function textSimilarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  Array.from(A).forEach(g => { if (B.has(g)) inter++; });
  return (2 * inter) / (A.size + B.size);
}

export function serpOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  let inter = 0;
  for (const u of b) if (A.has(u)) inter++;
  return inter / Math.min(a.length, b.length);
}

// ── Cluster + cannibalization ───────────────────────────────────────────────

export interface ClusterableRow {
  keyword: string;
  serviceOrProduct: string;
  journeyStage: JourneyStage;
  funnelStage: FunnelStage;
  objective: Objective;
  finalScore: number;
  referenceVolume: number | null;
  topUrls: string[];
  pageType: PageType;
}

export interface ClusterAssignment {
  clusterId: number;
  clusterName: string;
  clusterRole: 'PRIMARY' | 'SECONDARY';
  themeKey: string;
  section: string;
}

export interface CannibalizationResult {
  /** keyword → คำที่ถูกยุบเป็นคำรองของมัน */
  absorbed: Map<string, string[]>;
  /** keyword ที่ถูกยุบ → action + เป้า */
  actions: Map<string, { action: CannibalizationAction; target: string }>;
  /** โทษคะแนน (0-15) ของคำที่เสี่ยงกินกันเองแต่ยังเก็บไว้ */
  penalties: Map<string, number>;
}

const MERGE_SIM = 0.9;
const SECONDARY_SIM = 0.78;
const SERP_DUP = 0.5;

/**
 * หา "คำกินกันเอง" ภายในกลุ่มสินค้า/ธีมเดียวกัน — คำคะแนนต่ำกว่าถูกยุบเป็น
 * secondary ของคำคะแนนสูงกว่า (MERGE เมื่อแทบเป็นคำเดียวกัน)
 */
export function detectCannibalization(rows: ClusterableRow[]): CannibalizationResult {
  const absorbed = new Map<string, string[]>();
  const actions = new Map<string, { action: CannibalizationAction; target: string }>();
  const penalties = new Map<string, number>();

  // จัดกลุ่มก่อนเพื่อไม่ต้องเทียบ O(n²) ทั้ง pool
  const groups = new Map<string, ClusterableRow[]>();
  for (const r of rows) {
    const key = `${r.serviceOrProduct}|${themeOfStage(r.journeyStage).key}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  for (const list of Array.from(groups.values())) {
    const sorted = [...list].sort((a, b) => b.finalScore - a.finalScore);
    for (let i = 0; i < sorted.length; i++) {
      const hi = sorted[i];
      if (actions.has(hi.keyword)) continue;
      for (let j = i + 1; j < sorted.length; j++) {
        const lo = sorted[j];
        if (actions.has(lo.keyword)) continue;
        const sim = textSimilarity(hi.keyword, lo.keyword);
        const overlap = serpOverlap(hi.topUrls, lo.topUrls);
        if (sim >= MERGE_SIM) {
          actions.set(lo.keyword, { action: 'MERGE', target: hi.keyword });
        } else if (sim >= SECONDARY_SIM || overlap >= SERP_DUP) {
          actions.set(lo.keyword, { action: 'USE_AS_SECONDARY', target: hi.keyword });
        } else if (sim >= 0.65 || (overlap > 0 && overlap >= 0.3)) {
          // เสี่ยงชนกันแต่ยังแยกหน้าได้ — หักคะแนนกันหน้า doorway
          penalties.set(lo.keyword, Math.max(penalties.get(lo.keyword) ?? 0, overlap >= 0.3 ? 10 : 6));
          continue;
        } else {
          continue;
        }
        const secs = absorbed.get(hi.keyword) ?? [];
        secs.push(lo.keyword);
        absorbed.set(hi.keyword, secs);
      }
    }
  }

  // รอบสอง: เทียบ "ข้ามกลุ่ม" ทั้ง pool — AI อาจติดป้าย journey stage ต่างกันให้คำที่
  // เจตนาเดียวกัน (เช่น "ล้างแอร์ บางนา ราคาถูก" vs "บางนา ล้างแอร์ ราคาถูก") ทำให้
  // รอบแรกไม่เคยได้เทียบกันเลย — รอบนี้จับเฉพาะเคสชัวร์: token ชุดเดียวกัน (orderFreeKey),
  // ข้อความแทบเหมือนกัน (≥ MERGE_SIM) หรือ SERP ทับกันหนัก (≥ 0.75)
  const GLOBAL_SERP_MERGE = 0.75;
  const allSorted = [...rows].sort((a, b) => b.finalScore - a.finalScore);
  for (let i = 0; i < allSorted.length; i++) {
    const hi = allSorted[i];
    if (actions.has(hi.keyword)) continue;
    for (let j = i + 1; j < allSorted.length; j++) {
      const lo = allSorted[j];
      if (actions.has(lo.keyword)) continue;
      const sameTokens = orderFreeKey(hi.keyword) === orderFreeKey(lo.keyword);
      if (!sameTokens
        && textSimilarity(hi.keyword, lo.keyword) < MERGE_SIM
        && serpOverlap(hi.topUrls, lo.topUrls) < GLOBAL_SERP_MERGE) continue;
      actions.set(lo.keyword, { action: 'MERGE', target: hi.keyword });
      const secs = absorbed.get(hi.keyword) ?? [];
      secs.push(lo.keyword);
      absorbed.set(hi.keyword, secs);
    }
  }

  return { absorbed, actions, penalties };
}

/** ตั้งชื่อ cluster + กำหนด id ให้แถวที่รอด (หลังยุบคำซ้ำแล้ว) */
export function assignClusters(rows: ClusterableRow[]): Map<string, ClusterAssignment> {
  const out = new Map<string, ClusterAssignment>();
  const groups = new Map<string, ClusterableRow[]>();
  for (const r of rows) {
    const theme = themeOfStage(r.journeyStage);
    const key = `${r.serviceOrProduct}|${theme.key}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  let id = 0;
  const orderedKeys = Array.from(groups.keys()).sort((a, b) => {
    const sa = groups.get(a)!.reduce((s, r) => s + r.finalScore, 0);
    const sb = groups.get(b)!.reduce((s, r) => s + r.finalScore, 0);
    return sb - sa;
  });
  for (const key of orderedKeys) {
    const list = groups.get(key)!;
    id += 1;
    const [product] = key.split('|');
    const theme = themeOfStage(list[0].journeyStage);
    const name = `${product} – ${theme.labelTh}`;
    const primary = [...list].sort((a, b) => b.finalScore - a.finalScore)[0];
    for (const r of list) {
      out.set(r.keyword, {
        clusterId: id,
        clusterName: name,
        clusterRole: r.keyword === primary.keyword ? 'PRIMARY' : 'SECONDARY',
        themeKey: theme.key,
        section: theme.section,
      });
    }
  }
  return out;
}

// ── Slug status ─────────────────────────────────────────────────────────────

export function resolveSlugStatus(
  slug: string | null,
  existingPaths: string[],
  seenSlugs: Set<string>
): SlugStatus {
  if (!slug) return 'REVIEW';
  const norm = slug.toLowerCase();
  if (seenSlugs.has(norm)) return 'CONFLICT';
  seenSlugs.add(norm);
  if (existingPaths.some(p => {
    const last = p.toLowerCase().split('/').filter(Boolean).pop() ?? '';
    const decoded = (() => { try { return decodeURIComponent(last); } catch { return last; } })();
    return decoded === norm;
  })) return 'EXISTING';
  return 'NEW';
}

// ── Sitemap placement ───────────────────────────────────────────────────────

export function buildSitemapPlacement(
  row: ClusterableRow,
  assignment: ClusterAssignment,
  clusterPrimaryKeyword: string,
  slug: string | null,
  existingPaths: string[],
  productTokens: string[]
): SitemapPlacement {
  const isPrimary = assignment.clusterRole === 'PRIMARY';
  let topicRole: TopicRole;
  if (row.funnelStage === 'BOFU' && ['LANDING_PAGE', 'PRODUCT_PAGE', 'CATEGORY_PAGE'].includes(row.pageType)) {
    topicRole = 'MONEY_PAGE';
  } else if (isPrimary) {
    topicRole = 'PILLAR';
  } else if (row.finalScore >= 55) {
    topicRole = 'CLUSTER';
  } else {
    topicRole = 'SUPPORTING';
  }
  const kw = row.keyword.toLowerCase();
  const linkTarget =
    existingPaths.find(p => {
      const decoded = (() => { try { return decodeURIComponent(p.toLowerCase()); } catch { return p.toLowerCase(); } })();
      return productTokens.some(t => decoded.includes(t)) && decoded.split('/').filter(Boolean).some(seg => kw.includes(seg) || seg.includes(kw));
    }) ?? null;
  return {
    section: assignment.section,
    parentTopic: isPrimary ? null : clusterPrimaryKeyword,
    topicRole,
    suggestedPath: slug ? `/${assignment.section}/${slug}` : `/${assignment.section}/`,
    internalLinkTarget: linkTarget,
  };
}

// ── Cluster-quota selection (ไม่ใช่ top-N ล้วน) ─────────────────────────────

/**
 * คัด target คำจาก pool โดยกัน quota ต่อ (cluster group) ตามขนาด×คุณภาพ
 * แล้ว round-robin เก็บตามคะแนน — คำที่เหลือเติมด้วยคะแนนรวม
 */
export function selectWithClusterQuota(rows: ClusterableRow[], target: number): ClusterableRow[] {
  if (rows.length <= target) return [...rows].sort((a, b) => b.finalScore - a.finalScore);
  const groups = new Map<string, ClusterableRow[]>();
  for (const r of rows) {
    const key = `${r.serviceOrProduct}|${themeOfStage(r.journeyStage).key}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  Array.from(groups.values()).forEach(list => list.sort((a, b) => b.finalScore - a.finalScore));

  const weights = new Map<string, number>();
  let weightSum = 0;
  for (const [key, list] of Array.from(groups.entries())) {
    const avg = list.reduce((s, r) => s + r.finalScore, 0) / list.length;
    const w = Math.sqrt(list.length) * Math.max(avg, 1);
    weights.set(key, w);
    weightSum += w;
  }

  const picked: ClusterableRow[] = [];
  const cursors = new Map<string, number>();
  for (const [key, list] of Array.from(groups.entries())) {
    const quota = Math.max(1, Math.floor((weights.get(key)! / weightSum) * target));
    const take = Math.min(quota, list.length);
    picked.push(...list.slice(0, take));
    cursors.set(key, take);
  }
  // เติมที่เหลือด้วยคะแนนรวมจากทุกกลุ่ม
  if (picked.length < target) {
    const rest: ClusterableRow[] = [];
    for (const [key, list] of Array.from(groups.entries())) rest.push(...list.slice(cursors.get(key)!));
    rest.sort((a, b) => b.finalScore - a.finalScore);
    picked.push(...rest.slice(0, target - picked.length));
  }
  return picked
    .slice(0, target)
    .sort((a, b) => b.finalScore - a.finalScore);
}

// ── Waves (Wave 1 = balanced portfolio) ─────────────────────────────────────

export function assignWaves(rows: ClusterableRow[], target: number): Map<string, 1 | 2 | 3> {
  const out = new Map<string, 1 | 2 | 3>();
  const w1Size = Math.max(5, Math.round(target * 0.15));
  const w2Size = Math.max(10, Math.round(target * 0.3));

  // Wave 1: round-robin ข้าม objective (SALE/LEAD/TRAFFIC) ตามคะแนน — portfolio สมดุล
  const byObjective = new Map<Objective, ClusterableRow[]>();
  for (const r of rows) {
    const list = byObjective.get(r.objective) ?? [];
    list.push(r);
    byObjective.set(r.objective, list);
  }
  Array.from(byObjective.values()).forEach(list => list.sort((a, b) => b.finalScore - a.finalScore));
  const order: Objective[] = ['SALE', 'LEAD', 'TRAFFIC'];
  const idx = new Map<Objective, number>(order.map(o => [o, 0]));
  let assigned = 0;
  while (assigned < w1Size) {
    let progressed = false;
    for (const o of order) {
      const list = byObjective.get(o) ?? [];
      const i = idx.get(o)!;
      if (i < list.length && assigned < w1Size) {
        out.set(list[i].keyword, 1);
        idx.set(o, i + 1);
        assigned++;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  // Wave 2/3: ตามคะแนน
  const rest = rows.filter(r => !out.has(r.keyword)).sort((a, b) => b.finalScore - a.finalScore);
  rest.forEach((r, i) => out.set(r.keyword, i < w2Size ? 2 : 3));
  return out;
}
