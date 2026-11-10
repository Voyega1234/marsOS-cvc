/**
 * เมนูซ้ายของ Project Settings (SEO SME) — id ของแต่ละหน้า + ตัวแปลง tab เดิม ('lab' | 'ce' ...) เป็นหน้าใหม่
 * ใช้ร่วมกันระหว่าง drawer, SmeSettingsShell, SmeLabTab, ProjectSetupChecklist และ setup-checklist route (UI เท่านั้น ไม่มีผลกับ DB)
 */
export type SmeLabSection = 'style' | 'business' | 'links' | 'images' | 'cta' | 'author' | 'test-article' | 'test-image'
export type SmeSettingsSection = 'checklist' | 'website' | 'google' | 'engine' | SmeLabSection

/** tab เดิมของ drawer ที่ checklist/ลิงก์เก่ายังส่งมา */
export type LegacyDrawerTab = 'lab' | 'ce' | 'google' | 'website'

export const SME_LAB_SECTIONS: readonly SmeLabSection[] = ['style', 'business', 'links', 'images', 'cta', 'author', 'test-article', 'test-image']

export function isSmeLabSection(s: SmeSettingsSection): s is SmeLabSection {
  return (SME_LAB_SECTIONS as readonly string[]).includes(s)
}

/** แปลง tab เดิมเป็นหน้าใหม่: lab → style, ce → engine */
export function legacyTabToSection(tab: LegacyDrawerTab): SmeSettingsSection {
  if (tab === 'lab') return 'style'
  if (tab === 'ce') return 'engine'
  return tab
}
