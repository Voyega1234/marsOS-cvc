/**
 * Keyword Intent Skill — ตัวช่วย normalize คีย์เวิร์ดภาษาไทย
 *
 * ต่อยอดจาก dedupeKey เดิม (src/lib/wordgod/local/normalize.ts) แต่เพิ่ม:
 *  - รวมสระอำสองรูป (ํ+า → ำ) ให้เป็นรูปเดียว
 *  - ตัดอักขระ zero-width ที่ติดมาจากการ copy/paste
 *  - lowercase เสมอ เพื่อให้เทียบ "Termite" กับ "termite" เป็นคำเดียวกัน
 */
import { dedupeKey } from '../local/normalize';

/** อักขระ zero-width ที่พบบ่อย (zero-width space/joiner/non-joiner + BOM) */
const ZERO_WIDTH = /[​-‍﻿]/g;

/** สระอำแบบแยกส่วน ํ (U+0E4D) + า (U+0E32) → ำ (U+0E33) */
const SARA_AM_SPLIT = /ํา/g;

/**
 * คีย์เปรียบเทียบภาษาไทย — ใช้ก่อนตรวจ cue/เปรียบเทียบคีย์เวิร์ดทุกจุดใน skill นี้
 * ห้ามใช้แสดงผล ใช้เทียบเท่านั้น (เหมือน dedupeKey เดิม)
 */
export function normalizeThaiKey(s: string): string {
  const cleaned = (s ?? '')
    .replace(ZERO_WIDTH, '')
    .replace(SARA_AM_SPLIT, 'ำ')
    .toLowerCase();
  return dedupeKey(cleaned);
}

/** เช็คว่าคีย์เวิร์ดมีคำ/วลี term อยู่ไหม (เทียบแบบ normalize แล้ว, term ต้องไม่ว่าง) */
export function containsTerm(kw: string, term: string): boolean {
  const t = term?.trim();
  if (!t) return false;
  return normalizeThaiKey(kw).includes(normalizeThaiKey(t));
}

/** slug ภาษาอังกฤษล้วน — ตัดภาษาไทยและอักขระอื่นทิ้ง, คืน '' ถ้าไม่เหลืออะไร */
export function slugify(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
