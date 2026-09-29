/**
 * Keyword Intent Skill — จัดกลุ่มคีย์เวิร์ด (ขั้นที่ 4, 1 กลุ่ม = 1 URL)
 *
 * union-find: รวมกลุ่มเฉพาะคีย์เวิร์ดที่ intent หลัก / ประเภทหน้า / สถานะ
 * NOT_RECOMMENDED / พื้นที่ที่ตรวจพบ ตรงกันหมด แล้วค่อยเช็คว่าเป็นคำเดียวกัน
 * (normalize แล้วเท่ากัน) หรือ SERP top-10 ทับกันมากพอ
 */
import type { FitResult, IntentSkillInputRow, KeywordGroup, KeywordIntent, PageTier, UnifiedPageType } from './types';
import { normalizeThaiKey, slugify } from './thaiNormalize';
import { detectThaiProvince } from './cues';

export interface RowClassification {
  intent: KeywordIntent;
  fit: FitResult;
  page: { pageType: UnifiedPageType; tier: PageTier };
}

export interface GroupBuildOptions {
  /** จำนวน URL top-10 ที่ต้องทับกันขั้นต่ำถึงจะถือว่าเป็นกลุ่มเดียวกัน */
  minSerpOverlap?: number;
}

export interface GroupBuildResult {
  groups: KeywordGroup[];
  /** row.key → group.id */
  groupIdByKey: Map<string, string>;
  /** group.id → row.key ของ head */
  headKeyByGroupId: Map<string, string>;
}

function normalizeUrl(u: string): string {
  return u
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('?')[0]
    .replace(/\/+$/, '');
}

function urlOverlapCount(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a.map(normalizeUrl));
  let count = 0;
  for (const u of b.map(normalizeUrl)) {
    if (setA.has(u)) count++;
  }
  return count;
}

function detectLocation(row: IntentSkillInputRow): string | null {
  return row.location ?? detectThaiProvince(row.keyword);
}

export function buildGroups(
  rows: IntentSkillInputRow[],
  perRow: Map<string, RowClassification>,
  opts: GroupBuildOptions = {}
): GroupBuildResult {
  const minSerpOverlap = opts.minSerpOverlap ?? 3;
  const n = rows.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(i: number, j: number): void {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  }

  for (let i = 0; i < n; i++) {
    const ri = rows[i];
    const pi = perRow.get(ri.key);
    if (!pi) continue;
    for (let j = i + 1; j < n; j++) {
      const rj = rows[j];
      const pj = perRow.get(rj.key);
      if (!pj) continue;
      if (pi.intent.primary !== pj.intent.primary) continue;
      if (pi.page.pageType !== pj.page.pageType) continue;
      const notRecI = pi.fit.verdict === 'NOT_RECOMMENDED';
      const notRecJ = pj.fit.verdict === 'NOT_RECOMMENDED';
      if (notRecI !== notRecJ) continue;

      const locI = detectLocation(ri);
      const locJ = detectLocation(rj);
      const locEqual =
        (locI === null && locJ === null) ||
        (locI !== null && locJ !== null && normalizeThaiKey(locI) === normalizeThaiKey(locJ));
      if (!locEqual) continue;

      const sameNorm = normalizeThaiKey(ri.keyword) === normalizeThaiKey(rj.keyword);
      if (!sameNorm) {
        const overlap = urlOverlapCount(ri.serpTopUrls ?? [], rj.serpTopUrls ?? []);
        if (overlap < minSerpOverlap) continue;
      }

      union(i, j);
    }
  }

  const membersByRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!membersByRoot.has(root)) membersByRoot.set(root, []);
    membersByRoot.get(root)!.push(i);
  }

  interface Draft {
    memberRows: IntentSkillInputRow[];
    head: IntentSkillInputRow;
    highestSv: number | null;
    totalSv: number | null;
  }

  const drafts: Draft[] = [];
  for (const indices of Array.from(membersByRoot.values())) {
    const memberRows = indices.map(i => rows[i]);
    let head = memberRows[0];
    for (const r of memberRows.slice(1)) {
      const rv = r.volume ?? -1;
      const hv = head.volume ?? -1;
      if (rv > hv) head = r;
      else if (rv === hv && r.keyword.length < head.keyword.length) head = r;
    }
    const withVolume = memberRows.filter(r => r.volume !== null && r.volume !== undefined);
    const highestSv = withVolume.length ? Math.max(...withVolume.map(r => r.volume as number)) : null;
    const totalSv = withVolume.length ? withVolume.reduce((sum, r) => sum + (r.volume as number), 0) : null;
    drafts.push({ memberRows, head, highestSv, totalSv });
  }

  drafts.sort((a, b) => (b.highestSv ?? -1) - (a.highestSv ?? -1));

  const groups: KeywordGroup[] = [];
  const groupIdByKey = new Map<string, string>();
  const headKeyByGroupId = new Map<string, string>();

  drafts.forEach((draft, idx) => {
    const id = `g${idx + 1}`;
    const headClass = perRow.get(draft.head.key)!;
    const needsReview = draft.memberRows.some(r => perRow.get(r.key)?.intent.needsReview);
    const slug = slugify(draft.head.slug ?? '') || '';
    const pageTitle = draft.head.title || draft.head.keyword;

    groups.push({
      id,
      head: draft.head.keyword,
      keywords: draft.memberRows.map(r => r.keyword),
      intent: headClass.intent.mix,
      pageType: headClass.page.pageType,
      tier: headClass.page.tier,
      highestSv: draft.highestSv,
      totalSv: draft.totalSv,
      slug,
      nestedSlug: '',
      pageTitle,
      clusterId: '',
      fit: headClass.fit.verdict,
      approved: false,
      remark: '',
      needsReview,
    });

    for (const r of draft.memberRows) groupIdByKey.set(r.key, id);
    headKeyByGroupId.set(id, draft.head.key);
  });

  return { groups, groupIdByKey, headKeyByGroupId };
}
