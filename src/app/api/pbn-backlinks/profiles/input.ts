import type { PbnLanguage } from '@/lib/upload-article/pbn-sets'

/** validate ค่าจากฟอร์ม set ข้อมูลโปรเจกต์ (ชื่อ + เว็บหลัก + ภาษา) */
export function parsePbnProfileInput(body: unknown): { name: string; website: string; language: PbnLanguage } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'ข้อมูลไม่ถูกต้อง' }
  const b = body as Record<string, unknown>
  const rawSite = typeof b.website === 'string' ? b.website.trim().slice(0, 300) : ''
  let website = ''
  if (rawSite) {
    const withProto = /^https?:\/\//i.test(rawSite) ? rawSite : `https://${rawSite}`
    try {
      const u = new URL(withProto)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'URL เว็บหลักไม่ถูกต้อง' }
    } catch {
      return { error: 'URL เว็บหลักไม่ถูกต้อง' }
    }
    website = withProto.replace(/\/+$/, '')
  }
  let name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : ''
  if (!name && website) {
    try {
      name = new URL(website).host
    } catch {
      /* ใช้ค่าว่างต่อ */
    }
  }
  if (!name) return { error: 'กรุณาใส่ชื่อ set หรือเว็บหลัก' }
  const language: PbnLanguage = b.language === 'en' || b.language === 'both' ? b.language : 'th'
  return { name, website, language }
}
