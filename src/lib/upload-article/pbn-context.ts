// ─── PBN Backlinks — ค่าที่ใช้จริงของบทความหนึ่งชิ้น (สไตล์ตามเว็บปลายทาง + ข้อมูลโปรเจกต์ตาม set) ──
// ลูกค้า Upload Article (ไม่ใช่แถว PBN) ได้ค่าเดิมทุกอย่างกลับไป — พฤติกรรมไม่เปลี่ยน

import { parsePrefs } from './prefs-store'
import { isPbnPrefsRaw, readPbnSites } from './pbn'
import {
  PBN_MAIN_PROFILE,
  pbnCeScopeId,
  readPbnArticleTargets,
  readPbnProfiles,
  readPbnStyles,
  type PbnArticleTarget,
} from './pbn-sets'

type ClientLike = { id: string; website: string; language: string; themeColors: string; pushPrefs: string }

export interface PbnEffective<T extends ClientLike> {
  /** แถวลูกค้าที่ website / language / themeColors ถูกแทนด้วยค่าของ set + สไตล์ของเว็บปลายทางแล้ว */
  client: T
  /** projectId ของ Content Engine ที่ต้องใช้ */
  ceScopeId: string
  /** เป้าหมายของบทความ (PBN เท่านั้น) */
  target: PbnArticleTarget | null
}

/** แทนค่าตาม target ที่ระบุ — target ที่อ้าง set/เว็บที่ถูกลบไปแล้ว = ใช้ค่าหลักแทน */
export function pbnEffectiveClient<T extends ClientLike>(client: T, target: PbnArticleTarget | null): PbnEffective<T> {
  if (!target || !isPbnPrefsRaw(client.pushPrefs)) return { client, ceScopeId: client.id, target: null }
  const prefs = parsePrefs(client.pushPrefs)
  let next: T = client
  let ceScopeId = client.id
  if (target.profileId !== PBN_MAIN_PROFILE) {
    const profile = readPbnProfiles(prefs).find((p) => p.id === target.profileId)
    if (profile) {
      next = { ...next, website: profile.website, language: profile.language }
      ceScopeId = pbnCeScopeId(client.id, profile.id)
    }
  }
  const style = readPbnStyles(prefs)[target.siteId]
  if (style && readPbnSites(prefs).some((s) => s.id === target.siteId)) {
    next = { ...next, themeColors: JSON.stringify(style.theme) }
  }
  return { client: next, ceScopeId, target }
}

/** ค่าที่ใช้จริงของบทความที่เขียนไว้แล้ว (อ่านเป้าหมายจาก pbnArticleTargets) */
export function pbnArticleEffective<T extends ClientLike>(client: T, articleId: string): PbnEffective<T> {
  if (!isPbnPrefsRaw(client.pushPrefs)) return { client, ceScopeId: client.id, target: null }
  const target = readPbnArticleTargets(parsePrefs(client.pushPrefs))[articleId] ?? null
  return pbnEffectiveClient(client, target)
}

/**
 * set ของ Content Engine จาก query ?set=<profileId> (route Content Engine ของ Upload Article)
 * ไม่ส่ง / main = ขอบเขตเดิม (client.id) — set อื่นใช้ได้เฉพาะแถว PBN ที่มี set นั้นอยู่จริง
 */
export function resolveCeSet<T extends ClientLike>(
  client: T,
  reqUrl: string,
): { scopeId: string; client: T } | { error: string } {
  const set = new URL(reqUrl).searchParams.get('set')
  if (!set || set === PBN_MAIN_PROFILE) return { scopeId: client.id, client }
  if (!isPbnPrefsRaw(client.pushPrefs)) return { error: 'ไม่พบ set ข้อมูลโปรเจกต์นี้' }
  const profile = readPbnProfiles(parsePrefs(client.pushPrefs)).find((p) => p.id === set)
  if (!profile) return { error: 'ไม่พบ set ข้อมูลโปรเจกต์นี้ (อาจถูกลบไปแล้ว)' }
  return {
    scopeId: pbnCeScopeId(client.id, profile.id),
    client: { ...client, website: profile.website, language: profile.language },
  }
}
