/**
 * Keyword Guard — เครื่องตัดสิน cannibalization
 *
 * CANNIBALIZATION-FIRST RULE (คำสั่งเจ้าของระบบ):
 * ก่อนสร้าง Keyword Group / Cluster / Topic / Suggested Page / URL ใหม่ ต้องเทียบกับ
 *   1) คีย์เวิร์ดที่มีอยู่แล้ว  2) หัวข้อที่มีอยู่แล้ว  3) หน้า/URL ที่มีอยู่แล้ว
 *   4) กลุ่มคีย์เวิร์ดเดิม     5) candidate ในรอบเดียวกัน 6) คีย์เวิร์ดที่อนุมัติแล้ว
 *   7) exclude list          8) คำที่มาจาก Competitor Gap
 * ถ้าไม่แน่ใจ ให้ MERGE หรือ REVIEW เสมอ ห้ามเดาว่า CREATE NEW
 *
 * ประสิทธิภาพ: index เป็น Map สามชั้น + inverted index ระดับ token
 * การเทียบต่อหนึ่ง candidate จึงเป็น O(1) บวกการเทียบ token กับ "เฉพาะคำที่ใช้ token ร่วมกัน"
 * (ตัดเพดานที่ MAX_TOKEN_COMPARE) — ไม่มีการไล่เทียบทุกคู่แบบ O(n²)
 */

import { buildFingerprint, cleanKeyword, tokenOverlap } from './fingerprint';
import { dedupeKey } from '@/lib/wordgod/local/normalize';
import {
  bandOf,
  MATCH_SOURCE_LABEL_TH,
  MATCH_TYPE_LABEL_TH,
  type ExcludeEntry,
  type ExistingEntry,
  type GuardDecision,
  type GuardMatch,
  type GuardVerdict,
  type KeywordFingerprint,
  type ExcludedKeyword,
  type GuardSummary,
  type KeywordGuardInfo,
  type MatchSource,
  type MatchType,
} from './types';

const MAX_TOKEN_COMPARE = 60;
/** ต่ำกว่านี้ถือว่าคนละคำ ไม่ต้องรายงาน */
const TOKEN_SIM_FLOOR = 0.6;

interface IndexedEntry {
  fp: KeywordFingerprint;
  url: string | null;
  source: MatchSource;
}

export interface GuardSeed {
  keyword: string;
  url?: string | null;
  source: MatchSource;
}

export interface GuardInit {
  existing?: ExistingEntry[];
  exclude?: ExcludeEntry[];
  /** รายการเพิ่มเติมที่ไม่ได้อยู่ใน memory เช่น path จาก site scan หรือคำจาก Competitor Gap */
  extra?: GuardSeed[];
}

const SOURCE_OF_KIND: Record<ExistingEntry['kind'], MatchSource> = {
  keyword: 'EXISTING_KEYWORD',
  topic: 'EXISTING_TOPIC',
  page: 'EXISTING_PAGE',
  group: 'EXISTING_GROUP',
  approved: 'APPROVED_KEYWORD',
};

/** ข้อความจาก URL ที่เทียบกับคีย์เวิร์ดได้ — path segment สุดท้าย + คั่นด้วยช่องว่าง */
export function urlToText(url: string): string {
  let path = url;
  try {
    path = new URL(url.startsWith('http') ? url : `https://x.invalid${url.startsWith('/') ? '' : '/'}${url}`).pathname;
  } catch {
    /* ใช้สตริงเดิมถ้าแกะไม่ได้ */
  }
  return decodeURIComponent(path)
    .replace(/\.(html?|php|aspx)$/i, '')
    .replace(/[/_-]+/g, ' ')
    .trim();
}

export class KeywordGuard {
  private byExact = new Map<string, IndexedEntry>();
  private byOrder = new Map<string, IndexedEntry[]>();
  private bySemantic = new Map<string, IndexedEntry[]>();
  private byToken = new Map<string, IndexedEntry[]>();
  private urlEntries: Array<{ compact: string; entry: IndexedEntry }> = [];
  private excludeExact = new Map<string, ExcludeEntry>();
  private excludeOrder = new Map<string, ExcludeEntry>();
  private excludeSemantic = new Map<string, ExcludeEntry>();
  private excludePhrases: Array<{ compact: string; entry: ExcludeEntry }> = [];

  constructor(init: GuardInit = {}) {
    for (const e of init.existing ?? []) {
      this.add({ keyword: e.keyword, url: e.url, source: SOURCE_OF_KIND[e.kind] ?? 'EXISTING_KEYWORD' });
    }
    for (const e of init.extra ?? []) this.add(e);
    for (const x of init.exclude ?? []) this.addExclude(x);
  }

  /** จำนวนรายการอ้างอิงที่ใช้เทียบอยู่ (ไว้แสดงใน progress/warning) */
  get size(): number {
    return this.byExact.size;
  }

  get excludeSize(): number {
    return this.excludeExact.size + this.excludePhrases.length;
  }

  add(seed: GuardSeed): void {
    const cleaned = cleanKeyword(seed.keyword ?? '');
    const url = seed.url ?? null;
    if (!cleaned && !url) return;
    // รายการที่ให้มาเป็น URL ล้วน (เช่น /services/seo) — แปลงเป็นข้อความก่อนทำ fingerprint
    const text = cleaned && !/^https?:\/\//i.test(cleaned) && !cleaned.startsWith('/')
      ? cleaned
      : urlToText(cleaned || url || '');
    if (!text) return;
    const fp = buildFingerprint(text);
    if (!fp.exactKey) return;
    const entry: IndexedEntry = { fp, url: url ?? (cleaned.startsWith('/') || /^https?:/i.test(cleaned) ? cleaned : null), source: seed.source };

    if (!this.byExact.has(fp.exactKey)) this.byExact.set(fp.exactKey, entry);
    push(this.byOrder, fp.orderKey, entry);
    if (fp.semanticKey) push(this.bySemantic, fp.semanticKey, entry);
    for (const t of Array.from(new Set(fp.tokens))) push(this.byToken, t, entry);
    if (entry.url) this.urlEntries.push({ compact: dedupeKey(urlToText(entry.url)), entry });
  }

  addExclude(x: ExcludeEntry): void {
    const cleaned = cleanKeyword(x.keyword ?? '');
    if (!cleaned) return;
    const fp = buildFingerprint(cleaned);
    if (x.mode === 'phrase') {
      this.excludePhrases.push({ compact: fp.exactKey, entry: x });
      return;
    }
    this.excludeExact.set(fp.exactKey, x);
    this.excludeOrder.set(fp.orderKey, x);
    if (fp.semanticKey) this.excludeSemantic.set(fp.semanticKey, x);
  }

  /** จอง candidate ที่ผ่านแล้วเข้า index ของรอบนี้ — candidate ตัวถัดไปจะชนกับตัวนี้ได้ */
  claim(keyword: string): void {
    this.add({ keyword, source: 'RUN_CANDIDATE' });
  }

  /** ตัดสิน candidate หนึ่งคำ (ไม่แก้ index — เรียก claim เองเมื่อรับคำนั้นเข้าตาราง) */
  evaluate(keyword: string): GuardVerdict {
    const fp = buildFingerprint(keyword);
    const excluded = this.checkExclude(fp);
    if (excluded) return excluded;

    const match = this.bestMatch(fp);
    if (!match) {
      return {
        keyword: fp.display,
        fingerprint: fp,
        decision: 'CREATE_NEW',
        risk: 0,
        band: 'LOW',
        match: null,
        reasons: ['ไม่ชนกับคีย์เวิร์ด/หัวข้อ/หน้าเดิม และไม่ซ้ำกับ candidate ในรอบนี้'],
      };
    }

    const risk = riskOf(match);
    const decision = decide(risk, match);
    return {
      keyword: fp.display,
      fingerprint: fp,
      decision,
      risk,
      band: bandOf(risk),
      match,
      reasons: reasonsFor(fp, match, risk, decision),
    };
  }

  /**
   * ตัดสินทั้งชุดในรอบเดียว พร้อมกันซ้ำภายในรอบ (§19)
   * เรียงตามลำดับที่ส่งมา — ผู้เรียกควรเรียงคำที่สำคัญกว่ามาก่อน (คำแรกได้เป็นตัวหลัก)
   */
  evaluateRun(keywords: string[]): GuardVerdict[] {
    const out: GuardVerdict[] = [];
    for (const kw of keywords) {
      const verdict = this.evaluate(kw);
      out.push(verdict);
      if (verdict.decision === 'CREATE_NEW' || verdict.decision === 'NEEDS_REVIEW') {
        this.claim(verdict.fingerprint.display);
      }
    }
    return out;
  }

  private checkExclude(fp: KeywordFingerprint): GuardVerdict | null {
    const hit =
      pickExclude(this.excludeExact.get(fp.exactKey), 'EXACT') ??
      pickExclude(this.excludeOrder.get(fp.orderKey), 'WORD_ORDER') ??
      pickExclude(fp.semanticKey ? this.excludeSemantic.get(fp.semanticKey) : undefined, 'SEMANTIC') ??
      this.excludePhraseHit(fp);
    if (!hit) return null;
    const reason = hit.entry.reason ? ` — ${hit.entry.reason}` : '';
    return {
      keyword: fp.display,
      fingerprint: fp,
      decision: 'EXCLUDE',
      risk: 100,
      band: 'STRONG',
      match: {
        keyword: hit.entry.keyword,
        url: null,
        source: 'EXCLUDE_LIST',
        type: hit.type,
        similarity: 1,
        sameIntent: true,
      },
      reasons: [`อยู่ในรายการคำที่ไม่เอา (${MATCH_TYPE_LABEL_TH[hit.type]}: “${hit.entry.keyword}”)${reason}`],
    };
  }

  private excludePhraseHit(fp: KeywordFingerprint): { entry: ExcludeEntry; type: MatchType } | null {
    for (const p of this.excludePhrases) {
      if (p.compact && fp.exactKey.includes(p.compact)) return { entry: p.entry, type: 'PHRASE' };
    }
    return null;
  }

  private bestMatch(fp: KeywordFingerprint): GuardMatch | null {
    const candidates: GuardMatch[] = [];

    const exact = this.byExact.get(fp.exactKey);
    if (exact) {
      candidates.push(toMatch(exact, fp, exact.fp.display === fp.display ? 'EXACT' : 'SPACING', 1));
    }

    for (const e of this.byOrder.get(fp.orderKey) ?? []) {
      if (e.fp.exactKey === fp.exactKey) continue;
      candidates.push(toMatch(e, fp, 'WORD_ORDER', 1));
    }

    if (fp.semanticKey) {
      for (const e of this.bySemantic.get(fp.semanticKey) ?? []) {
        if (e.fp.exactKey === fp.exactKey || e.fp.orderKey === fp.orderKey) continue;
        candidates.push(toMatch(e, fp, 'SEMANTIC', 0.9));
      }
    }

    for (const u of this.urlEntries) {
      if (!u.compact || u.compact.length < 4) continue;
      if (u.compact === fp.exactKey) candidates.push(toMatch(u.entry, fp, 'URL_PATH', 1));
      else if (u.compact.includes(fp.exactKey) && fp.exactKey.length >= 6) candidates.push(toMatch(u.entry, fp, 'URL_PATH', 0.85));
    }

    // ชั้นสุดท้าย: token ซ้ำกันเยอะ — เทียบเฉพาะรายการที่ใช้ token ร่วมกันจริง
    const seen = new Set<string>();
    let compared = 0;
    for (const t of Array.from(new Set(fp.tokens))) {
      for (const e of this.byToken.get(t) ?? []) {
        if (compared >= MAX_TOKEN_COMPARE) break;
        if (seen.has(e.fp.exactKey)) continue;
        seen.add(e.fp.exactKey);
        compared++;
        if (e.fp.exactKey === fp.exactKey) continue;
        const sim = tokenOverlap(fp, e.fp);
        if (sim >= TOKEN_SIM_FLOOR) candidates.push(toMatch(e, fp, 'TOKEN_OVERLAP', sim));
      }
      if (compared >= MAX_TOKEN_COMPARE) break;
    }

    if (candidates.length === 0) return null;
    return candidates.reduce((best, c) => (riskOf(c) > riskOf(best) ? c : best));
  }
}

function pickExclude(entry: ExcludeEntry | undefined, type: MatchType): { entry: ExcludeEntry; type: MatchType } | null {
  return entry ? { entry, type } : null;
}

function push(map: Map<string, IndexedEntry[]>, key: string, entry: IndexedEntry): void {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(entry);
  else map.set(key, [entry]);
}

function toMatch(entry: IndexedEntry, fp: KeywordFingerprint, type: MatchType, similarity: number): GuardMatch {
  return {
    keyword: entry.fp.display,
    url: entry.url,
    source: entry.source,
    type,
    similarity,
    sameIntent: entry.fp.intentKey === fp.intentKey,
  };
}

/** คะแนนความเสี่ยง 0–100 — เจตนาต่างกันถูกเพดานกดไว้ที่ 55 เสมอ (§20–21) */
export function riskOf(match: GuardMatch): number {
  let base: number;
  switch (match.type) {
    case 'EXACT':
    case 'SPACING':
      base = 100; break;
    case 'WORD_ORDER':
      base = 88; break;
    case 'URL_PATH':
      base = match.similarity >= 1 ? 92 : 74; break;
    case 'SEMANTIC':
      base = 78; break;
    case 'TOKEN_OVERLAP':
      base = Math.round(match.similarity * 80); break;
    default:
      base = 0;
  }
  if (match.source === 'EXISTING_PAGE' && base < 100) base += 4;
  // คู่แข่งติดคำนี้ = หลักฐานว่ามีโอกาส ไม่ใช่หลักฐานว่าต้องทำหน้าใหม่ — ไม่เร่งความเสี่ยงเท่าของเราเอง
  if (match.source === 'COMPETITOR_GAP') base -= 12;
  if (!match.sameIntent) base = Math.min(base, 55);
  return Math.max(0, Math.min(100, Math.round(base)));
}

function decide(risk: number, match: GuardMatch): GuardDecision {
  if (risk >= 80) {
    if (match.source === 'EXISTING_PAGE' || match.type === 'URL_PATH') return 'MAP_TO_EXISTING_PAGE';
    if (match.source === 'EXISTING_TOPIC' || match.source === 'EXISTING_GROUP') return 'MAP_TO_EXISTING_TOPIC';
    return 'MERGE';
  }
  if (risk >= 60) return match.sameIntent ? 'ADD_AS_SECONDARY' : 'NEEDS_REVIEW';
  if (risk >= 40) return 'NEEDS_REVIEW';
  return 'CREATE_NEW';
}

function reasonsFor(fp: KeywordFingerprint, match: GuardMatch, risk: number, decision: GuardDecision): string[] {
  const out: string[] = [];
  out.push(
    `ชนกับ${MATCH_SOURCE_LABEL_TH[match.source]} “${match.keyword}”${match.url ? ` (${match.url})` : ''} — ${MATCH_TYPE_LABEL_TH[match.type]}${
      match.type === 'TOKEN_OVERLAP' ? ` ${Math.round(match.similarity * 100)}%` : ''
    }`
  );
  if (!match.sameIntent) {
    out.push('เจตนาการค้นหาต่างกัน — ไม่รวมเป็นหน้าเดียวกัน แต่ยังต้องตรวจว่าซ้อนกันไหม (เพดานความเสี่ยง 55)');
  } else if (risk >= 60) {
    out.push(`เจตนาเดียวกัน (${fp.intent.subIntent}) — ทำสองหน้าจะแย่งอันดับกันเอง`);
  }
  if (decision === 'CREATE_NEW') out.push('ความเสี่ยงต่ำกว่า 40 — สร้างกลุ่ม/หน้าใหม่ได้');
  if (decision === 'NEEDS_REVIEW') out.push('ยังตัดสินไม่ขาด — ตามกติกาให้เลือกทางตรวจก่อน ไม่สร้างใหม่อัตโนมัติ');
  return out;
}

// ── ตัวช่วยแปลงผลไปเก็บในผลลัพธ์ของหน้า Keyword Research / Competitor Gap ────

export function toGuardInfo(v: GuardVerdict): KeywordGuardInfo {
  return {
    decision: v.decision,
    risk: v.risk,
    band: v.band,
    existingMatch: v.match?.keyword ?? null,
    existingUrl: v.match?.url ?? null,
    matchSource: v.match?.source ?? null,
    matchType: v.match?.type ?? null,
    primaryIntent: v.fingerprint.intent.primaryIntent,
    subIntent: v.fingerprint.intent.subIntent,
    topic: v.fingerprint.intent.topic,
    mainEntity: v.fingerprint.intent.mainEntity,
    funnelStage: v.fingerprint.intent.funnelStage,
    recommendedContentType: v.fingerprint.intent.recommendedContentType,
    reasons: v.reasons,
  };
}

export function toExcludedKeyword(v: GuardVerdict): ExcludedKeyword {
  return {
    keyword: v.keyword,
    decision: v.decision,
    risk: v.risk,
    matchType: v.match?.type ?? 'NONE',
    matchSource: v.match?.source ?? 'NONE',
    matchedKeyword: v.match?.keyword ?? null,
    matchedUrl: v.match?.url ?? null,
    reason: v.reasons.join(' · '),
  };
}

export function summarize(verdicts: GuardVerdict[], existingCount: number, excludeCount: number): GuardSummary {
  const count = (d: GuardDecision) => verdicts.filter(v => v.decision === d).length;
  return {
    existingCount,
    excludeCount,
    checked: verdicts.length,
    createNew: count('CREATE_NEW'),
    merged: count('MERGE'),
    secondary: count('ADD_AS_SECONDARY'),
    mappedExisting: count('MAP_TO_EXISTING_PAGE') + count('MAP_TO_EXISTING_TOPIC'),
    needsReview: count('NEEDS_REVIEW'),
    excluded: count('EXCLUDE'),
  };
}
