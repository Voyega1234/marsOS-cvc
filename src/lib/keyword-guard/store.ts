/**
 * Keyword Guard — ที่เก็บ Existing / Exclude / Handoff ระดับโปรเจกต์
 *
 * ใช้ตาราง AppSetting (key/value) ที่มีอยู่แล้วเป็น JSON store แบบเดียวกับ Competitor Gap
 * — ไม่มี migration ไม่มีตารางใหม่ ไม่กระทบโมดูลอื่น และของเดิมที่ไม่มีข้อมูลจะได้
 * memory ว่างกลับไป (backward compatible)
 *
 * ข้อมูลนี้ใช้ร่วมกันสองหน้า: Keyword Research (wordgod local/online) และ Competitor Gap
 */

import { prisma } from '@/lib/prisma';
import { buildFingerprint, cleanKeyword } from './fingerprint';
import type { ExcludeEntry, ExistingEntry, HandoffItem, KeywordMemory } from './types';

const PREFIX = 'keyword_guard';
export const MAX_EXISTING = 5000;
export const MAX_EXCLUDE = 2000;
export const MAX_HANDOFF = 500;

const EMPTY: KeywordMemory = { existing: [], exclude: [], updatedAt: null };

function memoryKey(projectId: string): string {
  return `${PREFIX}:memory:${projectId}`;
}

function handoffKey(projectId: string): string {
  return `${PREFIX}:handoff:${projectId}`;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    if (!row?.value) return fallback;
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<boolean> {
  try {
    const str = JSON.stringify(value);
    await prisma.appSetting.upsert({ where: { key }, create: { key, value: str }, update: { value: str } });
    return true;
  } catch {
    return false;
  }
}

export async function loadMemory(projectId: string | null | undefined): Promise<KeywordMemory> {
  if (!projectId) return { ...EMPTY };
  const raw = await readJson<Partial<KeywordMemory>>(memoryKey(projectId), EMPTY);
  return {
    existing: Array.isArray(raw.existing) ? raw.existing : [],
    exclude: Array.isArray(raw.exclude) ? raw.exclude : [],
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  };
}

export async function saveMemory(projectId: string, memory: KeywordMemory): Promise<boolean> {
  return writeJson(memoryKey(projectId), { ...memory, updatedAt: new Date().toISOString() });
}

/** รับข้อความหลายบรรทัด รูปแบบ "keyword" หรือ "keyword | /url/" → รายการ existing */
export function parseExistingLines(text: string, kind: ExistingEntry['kind'] = 'keyword', source = 'manual'): ExistingEntry[] {
  const now = new Date().toISOString();
  const out: ExistingEntry[] = [];
  for (const line of String(text ?? '').split(/[\r\n]+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [kwPart, urlPart] = trimmed.split('|').map(s => s.trim());
    const keyword = cleanKeyword(kwPart ?? '');
    const url = urlPart || null;
    if (!keyword && !url) continue;
    // บรรทัดที่เป็น URL ล้วน = หน้าที่มีอยู่แล้ว
    const isPath = !urlPart && (/^https?:\/\//i.test(keyword) || keyword.startsWith('/'));
    out.push({
      keyword: isPath ? '' : keyword,
      url: isPath ? kwPart.trim() : url,
      kind: isPath ? 'page' : url ? 'page' : kind,
      source,
      addedAt: now,
    });
  }
  return out;
}

/** รับข้อความหลายบรรทัดของ exclude — รองรับ "keyword | เหตุผล" และ prefix "*" = จับแบบวลี */
export function parseExcludeLines(text: string, source = 'manual'): ExcludeEntry[] {
  const now = new Date().toISOString();
  const out: ExcludeEntry[] = [];
  for (const line of String(text ?? '').split(/[\r\n]+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [kwPart, reasonPart] = trimmed.split('|').map(s => s.trim());
    const phrase = kwPart.startsWith('*');
    const keyword = cleanKeyword(phrase ? kwPart.slice(1) : kwPart);
    if (!keyword) continue;
    out.push({ keyword, mode: phrase ? 'phrase' : 'exact', reason: reasonPart || null, source, addedAt: now });
  }
  return out;
}

function existingId(e: ExistingEntry): string {
  return e.keyword ? buildFingerprint(e.keyword).exactKey : `url:${(e.url ?? '').toLowerCase()}`;
}

export function mergeExisting(current: ExistingEntry[], incoming: ExistingEntry[]): ExistingEntry[] {
  const byId = new Map<string, ExistingEntry>();
  for (const e of current) byId.set(existingId(e), e);
  for (const e of incoming) {
    const id = existingId(e);
    if (!id) continue;
    const prev = byId.get(id);
    // ของเดิมชนะเรื่องเวลา แต่ URL ที่เพิ่งได้มาเติมให้ของเดิมที่ยังว่าง
    byId.set(id, prev ? { ...prev, url: prev.url ?? e.url, kind: prev.kind === 'keyword' && e.kind !== 'keyword' ? e.kind : prev.kind } : e);
  }
  return Array.from(byId.values()).slice(0, MAX_EXISTING);
}

export function mergeExclude(current: ExcludeEntry[], incoming: ExcludeEntry[]): ExcludeEntry[] {
  const byId = new Map<string, ExcludeEntry>();
  for (const e of current) byId.set(`${e.mode}:${buildFingerprint(e.keyword).exactKey}`, e);
  for (const e of incoming) {
    const id = `${e.mode}:${buildFingerprint(e.keyword).exactKey}`;
    if (!id.endsWith(':')) byId.set(id, byId.get(id) ?? e);
  }
  return Array.from(byId.values()).slice(0, MAX_EXCLUDE);
}

export function removeExisting(current: ExistingEntry[], keywords: string[]): ExistingEntry[] {
  const drop = new Set(keywords.map(k => buildFingerprint(k).exactKey).filter(Boolean));
  const dropUrls = new Set(keywords.map(k => k.trim().toLowerCase()));
  return current.filter(e => !(e.keyword && drop.has(buildFingerprint(e.keyword).exactKey)) && !(e.url && dropUrls.has(e.url.toLowerCase())));
}

export function removeExclude(current: ExcludeEntry[], keywords: string[]): ExcludeEntry[] {
  const drop = new Set(keywords.map(k => buildFingerprint(k).exactKey).filter(Boolean));
  return current.filter(e => !drop.has(buildFingerprint(e.keyword).exactKey));
}

// ── Handoff: Competitor Gap → Keyword Research ───────────────────────────────

export async function loadHandoff(projectId: string | null | undefined): Promise<HandoffItem[]> {
  if (!projectId) return [];
  const raw = await readJson<{ items?: HandoffItem[] }>(handoffKey(projectId), {});
  return Array.isArray(raw.items) ? raw.items : [];
}

export async function addHandoff(projectId: string, items: HandoffItem[]): Promise<HandoffItem[]> {
  const current = await loadHandoff(projectId);
  const byKey = new Map<string, HandoffItem>();
  for (const item of [...current, ...items]) {
    const k = buildFingerprint(item.keyword).exactKey;
    if (!k) continue;
    byKey.set(k, item);
  }
  const merged = Array.from(byKey.values()).slice(0, MAX_HANDOFF);
  await writeJson(handoffKey(projectId), { items: merged, updatedAt: new Date().toISOString() });
  return merged;
}

export async function clearHandoff(projectId: string, keywords?: string[]): Promise<HandoffItem[]> {
  if (!keywords || keywords.length === 0) {
    await writeJson(handoffKey(projectId), { items: [], updatedAt: new Date().toISOString() });
    return [];
  }
  const drop = new Set(keywords.map(k => buildFingerprint(k).exactKey));
  const kept = (await loadHandoff(projectId)).filter(i => !drop.has(buildFingerprint(i.keyword).exactKey));
  await writeJson(handoffKey(projectId), { items: kept, updatedAt: new Date().toISOString() });
  return kept;
}
