/**
 * Keyword Guard — Keyword Fingerprint
 *
 * คีย์เปรียบเทียบสี่ชั้นของคีย์เวิร์ดหนึ่งคำ ใช้เทียบ candidate กับของเดิมทั้งหมด
 * ด้วย Map lookup (O(1)) ไม่ต้องไล่เทียบทีละคู่ — ตารางระดับพันคำจึงไม่ค้าง
 *
 *   exactKey    ตัดช่องว่าง/วรรคตอน/ตัวพิมพ์ → จับ "รับทำ seo" = "รับทำseo" = "รับทำ SEO"
 *   orderKey    ตัดคำ + เรียง               → จับ "seo agency thailand" = "thailand seo agency"
 *   semanticKey ตัดคำขยายเป็นป้ายกลุ่ม       → จับ "ราคา SEO" = "ค่าบริการ SEO" = "แพ็กเกจ SEO"
 *   intentKey   เจตนาหลัก+ย่อย              → กัน "SEO คืออะไร" ไม่ให้ถูกรวมกับ "รับทำ SEO"
 */

import { dedupeKey, displayForm, orderFreeKey } from '@/lib/wordgod/local/normalize';
import { segmentWords } from '@/lib/wordgod/text/thai';
import { readIntent, scanModifiers } from './intent';
import type { KeywordFingerprint } from './types';

/** ทำความสะอาดก่อนทุกอย่าง: ขีด/สแลช/วรรคตอนกลายเป็นช่องว่าง แล้วยุบช่องว่างซ้ำ */
export function cleanKeyword(value: string): string {
  return String(value ?? '')
    .replace(/[​ ]/g, ' ')
    .replace(/[/\\|,;:_+]+/g, ' ')
    .replace(/[-–—]+/g, ' ')
    .replace(/["'`“”‘’()[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const cache = new Map<string, KeywordFingerprint>();
const CACHE_MAX = 20_000;

export function buildFingerprint(raw: string): KeywordFingerprint {
  const cleaned = cleanKeyword(raw);
  const cached = cache.get(cleaned);
  if (cached) return cached;

  const scan = scanModifiers(cleaned);
  const entity = scan.residual ? displayForm(scan.residual) : null;
  const intent = readIntent(cleaned, scan, entity);
  const semanticCore = scan.residual ? orderFreeKey(scan.residual) : '';
  const tokens = segmentWords(displayForm(cleaned)).filter(Boolean);

  const fp: KeywordFingerprint = {
    raw,
    display: displayForm(cleaned),
    exactKey: dedupeKey(cleaned),
    orderKey: orderFreeKey(cleaned),
    semanticKey: [semanticCore, ...[...scan.tags].sort()].filter(Boolean).join('|'),
    intentKey: `${intent.primaryIntent}:${intent.subIntent}`,
    tokens,
    head: tokens[0] ?? null,
    intent,
  };

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(cleaned, fp);
  return fp;
}

/** ความเหมือนระดับ token (Jaccard) — ใช้เป็นชั้นสุดท้ายเมื่อคีย์ทั้งสามชั้นไม่ชน */
export function tokenOverlap(a: KeywordFingerprint, b: KeywordFingerprint): number {
  if (a.tokens.length === 0 || b.tokens.length === 0) return 0;
  const setA = new Set(a.tokens);
  const setB = new Set(b.tokens);
  let inter = 0;
  setA.forEach(t => { if (setB.has(t)) inter++; });
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}
