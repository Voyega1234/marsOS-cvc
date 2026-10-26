// ── ข้อมูลจริงจากบทความสำหรับวางบนปก (overlay ฟอนต์จริง — ดู coverOverlay.ts) ──────
// bullet = หัวข้อ H2 จริง (ข้าม FAQ/สรุป) · คำโปรย = meta_description ที่ writer สร้าง
// ใช้ของจริงเท่านั้น ไม่ให้ AI แต่งคำใหม่ — ข้อความบนปกจึงตรงกับเนื้อหาเสมอ
// client-safe: ใช้ทั้งตอนเขียนบทความ (/api/article/write) และปุ่มสร้างปกใหม่หน้า SME
export function extractCoverExtras(html: string): { subtitle: string; bullets: string[] } {
  const stripTags = (t: string) => t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
  const bullets: string[] = []
  for (const m of Array.from(html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi))) {
    const t = stripTags(m[1])
    if (!t) continue
    if (/คำถามที่พบบ่อย|FAQ|สรุป|บทส่งท้าย/i.test(t)) continue
    bullets.push(t)
    if (bullets.length >= 3) break
  }
  const metaBlock = html.match(/<!--\s*CONVERT_CAKE_SEO_META([\s\S]*?)-->/i)?.[1] ?? ''
  const subtitle = metaBlock.match(/meta_description\s*[:=]\s*([^\n]+)/i)?.[1]?.trim() ?? ''
  return { subtitle, bullets }
}
