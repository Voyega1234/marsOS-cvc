// Brand Radar background scanning switch ("สแกนอัตโนมัติตามรอบ" in Settings).
//
// One switch per project, kept in the AppSetting key-value table so no schema change is needed.
// The scheduled server job (/api/brand-radar/cron) starts and continues scans only for projects whose
// switch is on. Projects with the switch off behave as before: a scan runs while someone has the page open.

import { prisma } from '@/lib/prisma'
import type { AutoScanDTO } from './types'

const KEY_PREFIX = 'brand_radar_auto_scan:'
const HEARTBEAT_KEY = 'brand_radar_cron_heartbeat'

function keyOf(projectId: string): string {
  return `${KEY_PREFIX}${projectId}`
}

function isOn(value: string): boolean {
  try {
    const v: unknown = JSON.parse(value)
    return !!v && typeof v === 'object' && (v as { on?: unknown }).on === true
  } catch {
    return false
  }
}

export async function getAutoScan(projectId: string): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: keyOf(projectId) }, select: { value: true } })
  return !!row && isOn(row.value)
}

/** Callers must have checked that the user may manage this project (requireProject). */
export async function setAutoScan(projectId: string, on: boolean, userId: string, now = new Date()): Promise<void> {
  const key = keyOf(projectId)
  if (!on) {
    await prisma.appSetting.deleteMany({ where: { key } })
    return
  }
  const value = JSON.stringify({ on: true, by: userId, at: now.toISOString() })
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
}

/** Project ids whose switch is on */
export async function listAutoScanProjectIds(): Promise<string[]> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { startsWith: KEY_PREFIX } },
    select: { key: true, value: true },
  })
  return rows.filter((r) => isOn(r.value)).map((r) => r.key.slice(KEY_PREFIX.length)).filter(Boolean)
}

/** Called by the scheduled server job on every tick, so Settings can show that it is alive */
export async function touchCronHeartbeat(now = new Date()): Promise<void> {
  const value = now.toISOString()
  await prisma.appSetting.upsert({ where: { key: HEARTBEAT_KEY }, create: { key: HEARTBEAT_KEY, value }, update: { value } })
}

async function lastCronTick(): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: HEARTBEAT_KEY }, select: { value: true } })
  if (!row) return null
  const t = Date.parse(row.value)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** What the Settings switch shows. `ready` only says whether the server secret exists, never its value. */
export async function getAutoScanInfo(projectId: string): Promise<AutoScanDTO> {
  const [on, lastTickAt] = await Promise.all([getAutoScan(projectId), lastCronTick()])
  return { on, ready: !!process.env.CRON_SECRET, lastTickAt }
}
