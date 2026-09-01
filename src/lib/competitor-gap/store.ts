/**
 * Competitor Gap — ที่เก็บ state/แคช
 *
 * ใช้ตาราง AppSetting (key/value) ที่มีอยู่แล้วเป็น JSON store — ไม่แตะ schema ของระบบ
 * และไม่สร้างตารางใหม่ให้กระทบส่วนอื่น
 *
 * TTL ตามนโยบายต้นทุน: SERP 24 ชม. · crawl 7 วัน · keyword/traffic 7 วัน
 * การสแกนที่มีค่าใช้จ่ายจะไม่เริ่มเองตอนเปิดหน้า — ต้องกดปุ่มเท่านั้น
 */

import { prisma } from '@/lib/prisma'
import type { GapReport, GapSnapshot, RunState } from './types'
import { CONTENT_PAGE_TYPES } from './types'

const PREFIX = 'competitor_gap'
export const TTL = {
  serp: 24 * 3600_000,
  crawl: 7 * 24 * 3600_000,
  keywords: 7 * 24 * 3600_000,
  run: 3 * 24 * 3600_000,
} as const

/** ค่าที่ใหญ่กว่านี้ไม่แคช — กันแถวเดียวบวมจนกระทบ DB ของระบบอื่น */
const MAX_VALUE_BYTES = 6_000_000

interface Envelope<T> {
  savedAt: string
  expiresAt: number
  data: T
}

export function hashKey(input: string): string {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(36)
}

async function readRaw(key: string): Promise<string | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } })
    return row?.value ?? null
  } catch {
    return null
  }
}

async function writeRaw(key: string, value: string): Promise<boolean> {
  if (value.length > MAX_VALUE_BYTES) return false
  try {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    })
    return true
  } catch {
    return false
  }
}

export async function getCache<T>(kind: string, id: string): Promise<{ data: T; savedAt: string } | null> {
  const raw = await readRaw(`${PREFIX}:cache:${kind}:${id}`)
  if (!raw) return null
  try {
    const env = JSON.parse(raw) as Envelope<T>
    if (!env.expiresAt || env.expiresAt < Date.now()) return null
    return { data: env.data, savedAt: env.savedAt }
  } catch {
    return null
  }
}

export async function setCache<T>(kind: string, id: string, data: T, ttlMs: number): Promise<void> {
  const env: Envelope<T> = {
    savedAt: new Date().toISOString(),
    expiresAt: Date.now() + ttlMs,
    data,
  }
  await writeRaw(`${PREFIX}:cache:${kind}:${id}`, JSON.stringify(env))
}

// ── Run state ────────────────────────────────────────────────────────────────

export async function saveRun(state: RunState): Promise<void> {
  state.updatedAt = new Date().toISOString()
  const ok = await writeRaw(`${PREFIX}:run:${state.runId}`, JSON.stringify({
    savedAt: state.updatedAt,
    expiresAt: Date.now() + TTL.run,
    data: state,
  } satisfies Envelope<RunState>))
  if (!ok) {
    // state ใหญ่เกินเพดาน — ตัดข้อความตัวอย่างออกแล้วลองอีกครั้ง (ยังคงตัวเลขทั้งหมด)
    for (const d of state.domains) {
      for (const p of d.pages) delete p.sample
    }
    await writeRaw(`${PREFIX}:run:${state.runId}`, JSON.stringify({
      savedAt: state.updatedAt,
      expiresAt: Date.now() + TTL.run,
      data: state,
    } satisfies Envelope<RunState>))
  }
  await writeRaw(`${PREFIX}:latest:${state.projectId}`, JSON.stringify({ runId: state.runId, at: state.updatedAt }))
}

export async function loadRun(runId: string): Promise<RunState | null> {
  const raw = await readRaw(`${PREFIX}:run:${runId}`)
  if (!raw) return null
  try {
    return (JSON.parse(raw) as Envelope<RunState>).data
  } catch {
    return null
  }
}

export async function latestRunId(projectId: string): Promise<string | null> {
  const raw = await readRaw(`${PREFIX}:latest:${projectId}`)
  if (!raw) return null
  try {
    return (JSON.parse(raw) as { runId?: string }).runId ?? null
  } catch {
    return null
  }
}

// ── Report (เก็บแยกจาก run state เพื่อให้หน้ารายงานโหลดเร็วและไม่พังตาม run) ──

export async function saveReport(projectId: string, report: GapReport): Promise<void> {
  await writeRaw(`${PREFIX}:report:${projectId}`, JSON.stringify({
    savedAt: report.generatedAt,
    expiresAt: Date.now() + TTL.crawl,
    data: report,
  } satisfies Envelope<GapReport>))
}

export async function loadReport(projectId: string): Promise<GapReport | null> {
  const raw = await readRaw(`${PREFIX}:report:${projectId}`)
  if (!raw) return null
  try {
    return (JSON.parse(raw) as Envelope<GapReport>).data
  } catch {
    return null
  }
}

// ── ประวัติ snapshot ต่อรอบสแกน (ไว้ดูว่า gap แคบลงหรือยัง) ─────────────────
// เก็บเป็น array เล็ก ๆ ไม่มีวันหมดอายุ — รายงานเต็มหมดอายุได้ แต่เส้นความคืบหน้าต้องอยู่

const MAX_SNAPSHOTS = 12

function buildSnapshot(report: GapReport): GapSnapshot {
  const ours = report.domains.find(d => d.isOurs) ?? null
  const kw = report.keywordGap
  return {
    runId: report.runId,
    generatedAt: report.generatedAt,
    keyword: report.input.keyword,
    readiness: report.readiness,
    gapToBaselinePct: report.gapToBaselinePct,
    ourRelevantPages: ours?.relevant ?? null,
    ourContentPages: ours ? CONTENT_PAGE_TYPES.reduce((s, t) => s + (ours.byType[t] ?? 0), 0) : null,
    ourTop10Keywords: kw.available
      ? kw.rows.filter(r => r.ourPosition !== null && r.ourPosition <= 10).length
      : null,
    keywordCounts: kw.available ? kw.counts : null,
    missingClusters: report.clusters.filter(c => c.state === 'missing').length,
    weakClusters: report.clusters.filter(c => c.state === 'weak').length,
    actionCounts: report.phase1.counts,
  }
}

export async function appendSnapshot(projectId: string, report: GapReport): Promise<void> {
  const key = `${PREFIX}:history:${projectId}`
  let list: GapSnapshot[] = []
  const raw = await readRaw(key)
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) list = parsed as GapSnapshot[]
    } catch { /* ประวัติเดิมอ่านไม่ได้ = เริ่มเก็บใหม่ ไม่ทำให้ run ล้ม */ }
  }
  list = list.filter(s => s.runId !== report.runId)
  list.push(buildSnapshot(report))
  list.sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))
  await writeRaw(key, JSON.stringify(list.slice(-MAX_SNAPSHOTS)))
}

export async function loadSnapshots(projectId: string): Promise<GapSnapshot[]> {
  const raw = await readRaw(`${PREFIX}:history:${projectId}`)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as GapSnapshot[]) : []
  } catch {
    return []
  }
}
