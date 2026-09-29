/**
 * Keyword Intent Skill — จัด Topic Cluster (ขั้นที่ 5) + วิเคราะห์ intent mix/gap/link plan
 *
 * หมายเหตุการตีความสเปก: `detectGaps`/`linkPlan` ต้องใช้ข้อมูลกลุ่มจริง (intent/tier)
 * ซึ่งไม่ได้เก็บอยู่ใน TopicCluster ตรง ๆ (มีแค่ groupIds) — จึงรับพารามิเตอร์เสริม
 * เป็นรายการ/แผนที่กลุ่มด้วย ไม่ใช่แค่ cluster เดี่ยว ๆ ตามที่ระบุแบบย่อในสเปก
 */
import type {
  ClusterLink,
  IntentCode,
  IntentSkillContext,
  IntentSkillInputRow,
  KeywordGroup,
  TopicCluster,
} from './types';
import { containsTerm, slugify } from './thaiNormalize';

export interface ClusterBuildOptions {
  servicesOffered?: string[];
  /** group.id → intent หลักของแถวหัวกลุ่ม (ใช้คำนวณ intent mix/gap/link ให้แม่นกว่าอ่านจาก label) */
  primaryByGroupId?: Map<string, IntentCode>;
}

export interface ClusterBuildResult {
  clusters: TopicCluster[];
  /** group.id → cluster.id */
  groupClusterId: Map<string, string>;
}

/** เดา primary code จาก label เดี่ยว ๆ หรือ label ผสม (fallback เมื่อไม่มี primaryByGroupId) */
function primaryFromMixLabel(mix: string, keyword: string): IntentCode {
  if (mix === 'I' || mix === 'C' || mix === 'T' || mix === 'N') return mix;
  if (mix === 'I/C') return 'C';
  if (mix === 'I/T') return 'T';
  // C/T
  const k = keyword.trim();
  return k.startsWith('รับ') || k.startsWith('บริษัท') ? 'T' : 'C';
}

function primaryOfGroup(group: KeywordGroup, opts?: ClusterBuildOptions): IntentCode {
  return opts?.primaryByGroupId?.get(group.id) ?? primaryFromMixLabel(group.intent, group.head);
}

/** % ของแต่ละ intent (นับตามจำนวนกลุ่ม) — ปัดให้รวม = 100 */
export function intentMix(groups: KeywordGroup[], primaryByGroupId?: Map<string, IntentCode>): Record<IntentCode, number> {
  const counts: Record<IntentCode, number> = { I: 0, C: 0, T: 0, N: 0 };
  for (const g of groups) {
    const code = primaryByGroupId?.get(g.id) ?? primaryFromMixLabel(g.intent, g.head);
    counts[code]++;
  }
  const total = groups.length || 1;
  const raw: Record<IntentCode, number> = {
    I: (counts.I / total) * 100,
    C: (counts.C / total) * 100,
    T: (counts.T / total) * 100,
    N: (counts.N / total) * 100,
  };
  // ปัดเศษให้ผลรวม = 100 พอดี (แจกเศษที่เหลือให้ตัวที่มีเศษทศนิยมมากสุด)
  const floored: Record<IntentCode, number> = {
    I: Math.floor(raw.I), C: Math.floor(raw.C), T: Math.floor(raw.T), N: Math.floor(raw.N),
  };
  let remainder = 100 - (floored.I + floored.C + floored.T + floored.N);
  const order: IntentCode[] = (['I', 'C', 'T', 'N'] as IntentCode[]).sort((a, b) => (raw[b] - floored[b]) - (raw[a] - floored[a]));
  for (const code of order) {
    if (remainder <= 0) break;
    floored[code]++;
    remainder--;
  }
  return floored;
}

/** ข้อความช่องว่างเนื้อหา — อ่านจาก intent mix ของคลัสเตอร์ */
export function detectGaps(cluster: TopicCluster): string[] {
  const gaps: string[] = [];
  const hasI = cluster.mix.I > 0;
  const hasC = cluster.mix.C > 0;
  const hasT = cluster.mix.T > 0;

  if (hasI && !hasC && !hasT) {
    gaps.push('มีแต่บทความให้ความรู้ ยังไม่มีหน้าขาย (Money page)');
  } else if (hasT && !hasI) {
    gaps.push('มีแต่หน้าขาย ยังไม่มีบทความรองรับ');
  } else if (hasI && hasT && !hasC) {
    gaps.push('ยังไม่มีหน้าเปรียบเทียบ/ราคา เชื่อมบทความกับหน้าขาย');
  }
  return gaps;
}

/** แผน internal link แบบ hub-spoke: I→C→T→pillar */
export function linkPlan(
  cluster: TopicCluster,
  groupsById: Map<string, KeywordGroup>,
  opts?: ClusterBuildOptions
): ClusterLink[] {
  const links: ClusterLink[] = [];
  const linked = new Set<string>();
  const members = cluster.groupIds.map(id => groupsById.get(id)).filter((g): g is KeywordGroup => !!g);
  const byPrimary = (code: IntentCode) => members.filter(g => primaryOfGroup(g, opts) === code);

  const iGroups = byPrimary('I');
  const cGroups = byPrimary('C');
  const tGroups = byPrimary('T');

  for (const g of iGroups) {
    const target = cGroups[0] ?? groupsById.get(cluster.pillarGroupId);
    if (target && target.id !== g.id) {
      links.push({ fromGroupId: g.id, toGroupId: target.id, kind: cGroups[0] ? 'I→C' : 'spoke→hub' });
      linked.add(g.id);
    }
  }
  for (const g of cGroups) {
    const target = tGroups[0] ?? groupsById.get(cluster.pillarGroupId);
    if (target && target.id !== g.id) {
      links.push({ fromGroupId: g.id, toGroupId: target.id, kind: tGroups[0] ? 'C→T' : 'spoke→hub' });
      linked.add(g.id);
    }
  }
  for (const g of members) {
    if (g.id === cluster.pillarGroupId || linked.has(g.id)) continue;
    links.push({ fromGroupId: g.id, toGroupId: cluster.pillarGroupId, kind: 'spoke→hub' });
    linked.add(g.id);
  }
  return links;
}

/**
 * จัดกลุ่ม (KeywordGroup) เข้าคลัสเตอร์:
 *  1) legacyCluster ของ head row (ถ้ามี)
 *  2) service ตัวแรกใน servicesOffered ที่คำหัวกลุ่มมี
 *  3) 'อื่น ๆ'
 * rowsByKey: map จาก keyword ของ head (group.head) → แถวต้นฉบับ (ใช้ดู legacyCluster)
 */
export function buildClusters(
  groups: KeywordGroup[],
  rowsByKey: Map<string, IntentSkillInputRow>,
  opts: ClusterBuildOptions = {}
): ClusterBuildResult {
  const servicesOffered = opts.servicesOffered ?? [];

  function partitionKey(group: KeywordGroup): string {
    const headRow = rowsByKey.get(group.head);
    const legacy = headRow?.legacyCluster?.trim();
    if (legacy) return legacy;
    const svc = servicesOffered.find(s => containsTerm(group.head, s));
    if (svc) return svc;
    return 'อื่น ๆ';
  }

  const buckets = new Map<string, KeywordGroup[]>();
  for (const g of groups) {
    const key = partitionKey(g);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(g);
  }

  interface Draft {
    key: string;
    members: KeywordGroup[];
    pillar: KeywordGroup;
  }

  const drafts: Draft[] = [];
  for (const [key, members] of Array.from(buckets)) {
    const primaryTierMembers = members.filter(g => g.tier === 'PRIMARY');
    const pool = primaryTierMembers.length ? primaryTierMembers : members;
    let pillar = pool[0];
    for (const g of pool.slice(1)) {
      if ((g.highestSv ?? -1) > (pillar.highestSv ?? -1)) pillar = g;
    }
    drafts.push({ key, members, pillar });
  }

  drafts.sort((a, b) => (b.pillar.highestSv ?? -1) - (a.pillar.highestSv ?? -1));

  const clusters: TopicCluster[] = [];
  const groupClusterId = new Map<string, string>();

  drafts.forEach((draft, idx) => {
    const id = `c${idx + 1}`;
    const groupIds = draft.members
      .slice()
      .sort((a, b) => (b.highestSv ?? -1) - (a.highestSv ?? -1))
      .map(g => g.id);
    const mix = intentMix(draft.members, opts.primaryByGroupId);
    const slugBase = slugify(draft.pillar.slug) || id;
    const section = servicesOffered.find(s => containsTerm(draft.pillar.head, s)) || draft.key;

    const cluster: TopicCluster = {
      id,
      name: draft.pillar.head,
      section,
      slugBase,
      mix,
      gaps: [],
      pillarGroupId: draft.pillar.id,
      groupIds,
      links: [],
      pillarIntent: draft.pillar.intent,
    };
    cluster.gaps = detectGaps(cluster);
    clusters.push(cluster);
    for (const gid of groupIds) groupClusterId.set(gid, id);
  });

  // เติม links หลังสร้างคลัสเตอร์ครบ (ต้องมี groupsById ของทุกกลุ่มในคลัสเตอร์นั้น)
  const groupsById = new Map(groups.map(g => [g.id, g] as const));
  for (const cluster of clusters) {
    cluster.links = linkPlan(cluster, groupsById, opts);
  }

  return { clusters, groupClusterId };
}

// ── ตั้งชื่อคลัสเตอร์/แก้ slug-title กลุ่มด้วย AI (ถ้ามี ctx.llm) ────────────

interface LlmClusterItem { id: string; name: string; section: string; slugBase: string }
interface LlmGroupItem { id: string; slug?: string; pageTitle?: string }
interface LlmResponseShape { clusters?: LlmClusterItem[]; groups?: LlmGroupItem[] }

const MAX_CLUSTERS_PER_CALL = 40;
const MAX_CALLS = 2;
const MAX_PAGE_TITLE_LEN = 60;
const MAX_CLUSTER_NAME_LEN = 80;

function buildClusterNamingPrompt(
  batch: TopicCluster[],
  groupsById: Map<string, KeywordGroup>,
  groupsNeedingFill: KeywordGroup[],
  ctx: IntentSkillContext
): string {
  const clusterBlocks = batch.map(cluster => {
    const heads = cluster.groupIds
      .map(id => groupsById.get(id))
      .filter((g): g is KeywordGroup => !!g)
      .map(g => ({
        id: g.id,
        head: g.head,
        intent: g.intent,
        pageType: g.pageType,
        keywords: g.keywords.slice(0, 5),
      }));
    return { id: cluster.id, groups: heads };
  });

  return [
    'คุณเป็นผู้เชี่ยวชาญ SEO ภาษาไทย กำลังตั้งชื่อ Topic Cluster และเติม slug/pageTitle ที่ขาด',
    `บริบทธุรกิจ: ${ctx.businessContext || '(ไม่ได้ระบุ)'}`,
    `ภาษา: ${ctx.language ?? 'th'}`,
    'ข้อมูลคลัสเตอร์ (แต่ละคลัสเตอร์มีกลุ่มคีย์เวิร์ดที่เป็นหัวข้อย่อย):',
    JSON.stringify(clusterBlocks),
    groupsNeedingFill.length
      ? `กลุ่มที่ยังไม่มี slug หรือ pageTitle (เติมให้เฉพาะรายการเหล่านี้): ${JSON.stringify(
          groupsNeedingFill.map(g => ({ id: g.id, head: g.head, keywords: g.keywords.slice(0, 5) }))
        )}`
      : '',
    'กติกา:',
    '- name: ชื่อหัวข้อสั้น ๆ ภาษาไทย (ห้ามใช้รูปแบบ "X – ความรู้")',
    '- section: หมวดบริการ/สินค้าระดับบนของธุรกิจ',
    '- slugBase / slug: ตัวอักษรอังกฤษ kebab-case เท่านั้น',
    `- pageTitle: SEO title ตามภาษา (${ctx.language ?? 'th'}) ความยาวไม่เกิน 60 ตัวอักษร`,
    '- ให้ตอบเฉพาะกลุ่มที่ยังไม่มี slug หรือ pageTitle เท่านั้น',
    'ตอบกลับเป็น JSON เท่านั้นตามรูปแบบ:',
    '{"clusters":[{"id":"c1","name":"...","section":"...","slugBase":"..."}],"groups":[{"id":"g1","slug":"...","pageTitle":"..."}]}',
  ].filter(Boolean).join('\n');
}

/**
 * ตั้งชื่อคลัสเตอร์ + เติม slug/pageTitle กลุ่มที่ยังว่างด้วย AI (batch สูงสุด 40 คลัสเตอร์/ครั้ง, สูงสุด 2 ครั้ง)
 * ไม่มี ctx.llm หรือ AI ล้มเหลว → ใช้ fallback เสมอ ไม่โยน error
 */
export async function nameClustersLLM(
  clusters: TopicCluster[],
  groups: KeywordGroup[],
  ctx: IntentSkillContext
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const groupsById = new Map(groups.map(g => [g.id, g] as const));

  // เก็บ snapshot กลุ่มที่ยัง "ว่าง" ก่อนเติม fallback — ส่งให้ AI พิจารณาเฉพาะรายการนี้
  const groupsMissingBefore = new Set(groups.filter(g => !g.slug || !g.pageTitle).map(g => g.id));

  const llm = ctx.llm;
  if (llm) {
    const batches: TopicCluster[][] = [];
    for (let i = 0; i < clusters.length && batches.length < MAX_CALLS; i += MAX_CLUSTERS_PER_CALL) {
      batches.push(clusters.slice(i, i + MAX_CLUSTERS_PER_CALL));
    }

    // แต่ละ batch คนละชุดคลัสเตอร์/กลุ่ม ไม่ทับกัน — รันพร้อมกันได้ เก็บ warnings แยกต่อ batch แล้ว push ตามลำดับเดิม
    const batchWarnings = await Promise.all(batches.map(async batch => {
      const warns: string[] = [];
      const groupsInBatch = batch.flatMap(c => c.groupIds.map(id => groupsById.get(id)).filter((g): g is KeywordGroup => !!g));
      const groupsNeedingFill = groupsInBatch.filter(g => groupsMissingBefore.has(g.id));

      try {
        const prompt = buildClusterNamingPrompt(batch, groupsById, groupsNeedingFill, ctx);
        const raw = await llm(prompt, 'intent_skill_clusters');
        const parsed = raw as LlmResponseShape;
        if (!parsed || typeof parsed !== 'object') {
          warns.push('ตั้งชื่อ Topic Cluster ด้วย AI ไม่สำเร็จ (รูปแบบผลลัพธ์ไม่ถูกต้อง) — ใช้ชื่อสำรอง');
          return warns;
        }

        for (const item of parsed.clusters ?? []) {
          const cluster = batch.find(c => c.id === item.id);
          if (!cluster || !item.name) continue;
          const name = String(item.name).trim().slice(0, MAX_CLUSTER_NAME_LEN);
          if (!name) continue;
          cluster.name = name;
          if (item.section) cluster.section = String(item.section).trim().slice(0, MAX_CLUSTER_NAME_LEN);
          const slugBase = slugify(item.slugBase ?? '');
          if (slugBase) cluster.slugBase = slugBase;
        }

        for (const item of parsed.groups ?? []) {
          const group = groupsNeedingFill.find(g => g.id === item.id);
          if (!group) continue;
          if (item.slug) {
            const s = slugify(item.slug);
            if (s) group.slug = s;
          }
          if (item.pageTitle) {
            const title = String(item.pageTitle).trim().slice(0, MAX_PAGE_TITLE_LEN);
            if (title) group.pageTitle = title;
          }
        }
      } catch {
        warns.push('เรียก AI ตั้งชื่อ Topic Cluster ไม่สำเร็จ — ใช้ชื่อสำรอง');
      }
      return warns;
    }));
    for (const warns of batchWarnings) warnings.push(...warns);
  }

  // ค่า fallback สำหรับสิ่งที่ AI ยังไม่เติม (หรือไม่มี ctx.llm เลย) — ไม่ปล่อยให้ว่าง
  for (const cluster of clusters) {
    const pillar = groupsById.get(cluster.pillarGroupId);
    if (!cluster.name) cluster.name = pillar?.head ?? cluster.id;
    if (!cluster.section) cluster.section = pillar?.head ?? cluster.name;
    if (!cluster.slugBase) cluster.slugBase = slugify(pillar?.slug ?? '') || cluster.id;
  }
  for (const group of groups) {
    if (!group.pageTitle) group.pageTitle = group.head;
    if (!group.slug) {
      const cluster = clusters.find(c => c.groupIds.includes(group.id));
      group.slug = slugify(group.pageTitle) || `${cluster?.slugBase ?? 'group'}-${group.id}`;
    }
  }

  // กันกรณี AI ให้ slug ซ้ำกันในกลุ่มเดียวกัน — เติม groupId ต่อท้ายให้ไม่ชนกัน
  const seenSlugs = new Set<string>();
  for (const group of groups) {
    let candidate = group.slug || slugify(group.pageTitle) || group.id;
    if (seenSlugs.has(candidate)) candidate = `${candidate}-${group.id}`;
    seenSlugs.add(candidate);
    group.slug = candidate;
  }

  return { warnings };
}
