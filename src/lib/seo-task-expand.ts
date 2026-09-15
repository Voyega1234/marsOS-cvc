// ─────────────────────────────────────────────────────────────────────────────
//  seo-task-expand — แปลง SeoFinding ที่ผู้ใช้เลือกให้เป็นรายการ SeoTask ที่จะสร้างจริง
//  (คำสั่งเจ้าของ 2026-09-11) finding หนึ่งข้อที่มี affected N หน้า ต้องแตกเป็น N งาน
//  โดยแต่ละงานบอกว่าหน้าไหน ปัญหาอะไร วิธีแก้อย่างไร — ปัญหาระดับเว็บ (affected ว่าง)
//  ยังเป็นงานเดียวเหมือนเดิม
//
//  ไฟล์นี้เป็น pure function ล้วน (ไม่แตะ prisma/session) เพื่อให้ route เรียกใช้และ
//  เขียน unit test แยกได้ — ดู seo-task-spec.md §4 และ §7 สำหรับ contract ที่ต้องตรงเป๊ะ
// ─────────────────────────────────────────────────────────────────────────────

import { SEO_ACTION_LABEL } from '@/lib/seo-fix-guide'
import type { SeoFinding } from '@/lib/seo-audit'

export interface ExpandedTask {
  area: string
  category: string
  title: string
  detail: string
  url: string | null
  priority: string
  evidence: string
  /** มีเมื่อ finding นี้เป็นชนิดที่ให้ AI แนะนำข้อความ — route ใช้จับกลุ่มเรียก AI แล้วเติม option กลับ */
  aiKey?: { findingId: string; url: string }
}

const MAX_TITLE_LEN = 70

/** URL → pathname + search — home คือ "/" */
export function pathLabel(url: string): string {
  try {
    const u = new URL(url)
    const label = `${u.pathname || '/'}${u.search || ''}`
    return label || '/'
  } catch {
    return url
  }
}

function formatScannedAt(scannedAt: string): string {
  try {
    return new Date(scannedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return scannedAt
  }
}

function buildTitle(finding: SeoFinding, url: string): string {
  const action = SEO_ACTION_LABEL[finding.id] ?? finding.title
  const full = `${action} หน้า ${pathLabel(url)}`
  return full.length > MAX_TITLE_LEN ? `${full.slice(0, MAX_TITLE_LEN - 1)}…` : full
}

/**
 * แตก finding ที่ผู้ใช้ติ๊กเลือกให้เป็นรายการงานที่จะสร้างจริง
 * - affected ว่าง (ปัญหาระดับเว็บ) → งานเดียว ใช้ title/url/evidence เดิมของ finding
 * - affected มีหลายหน้า → หนึ่งงานต่อหนึ่งหน้า ตามรูปแบบ detail ของ §4
 */
export function expandFindings(findings: SeoFinding[], ctx: { website: string; scannedAt: string }): ExpandedTask[] {
  const tasks: ExpandedTask[] = []
  const scannedLabel = formatScannedAt(ctx.scannedAt)

  for (const finding of findings) {
    if (!finding.affected || finding.affected.length === 0) {
      tasks.push({
        area: finding.area,
        category: finding.category,
        title: finding.title,
        detail: `${finding.detail}\n\nวิธีแก้:\n${finding.fix}`,
        url: finding.url ?? null,
        priority: finding.priority,
        evidence: finding.evidence,
      })
      continue
    }

    for (const page of finding.affected) {
      const task: ExpandedTask = {
        area: finding.area,
        category: finding.category,
        title: buildTitle(finding, page.url),
        detail: [
          `หน้า: ${page.url}`,
          `ปัจจุบัน: "${page.current}"`,
          `ปัญหา: ${page.issue}`,
          '',
          'วิธีแก้:',
          finding.fix,
        ].join('\n'),
        url: page.url,
        priority: finding.priority,
        evidence: `ผลสแกน ${ctx.website} เมื่อ ${scannedLabel}\n${page.issue}`,
      }
      if (finding.aiSuggest) task.aiKey = { findingId: finding.id, url: page.url }
      tasks.push(task)
    }
  }

  return tasks
}

/** ต่อท้าย section "ทางเลือก:" ให้ task — ไม่ทำอะไรถ้าไม่มี option ที่ใช้ได้ */
export function attachOptions(task: ExpandedTask, options: string[]): ExpandedTask {
  const cleaned = options.map((o) => o.trim()).filter(Boolean).slice(0, 3)
  if (!cleaned.length) return task
  const numbered = cleaned.map((o, i) => `${i + 1}. ${o}`).join('\n')
  return { ...task, detail: `${task.detail}\n\nทางเลือก:\n${numbered}` }
}
