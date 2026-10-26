// ─────────────────────────────────────────────────────────────────────────────
//  อ่านข้อความจาก PDF ในเบราว์เซอร์ (pdf.js) — ส่งแค่ข้อความขึ้นเซิร์ฟเวอร์แทนไฟล์ทั้งก้อน
//  เหตุผล: Vercel รับ body ได้ราว 4.5MB ต่อ request เกินแล้วตัดทิ้งเงียบ (413)
//  โบรชัวร์/โปรแกรมทัวร์ 5-10MB ส่วนใหญ่เป็นรูป ข้อความจริงแค่หลักสิบ-ร้อย KB
//  ฝั่งเซิร์ฟเวอร์ใช้แค่ข้อความอยู่แล้ว (context-files.ts) ผลที่ AI ได้จึงเท่าเดิม
// ─────────────────────────────────────────────────────────────────────────────

/** เพดานข้อความต่อไฟล์ — เซิร์ฟเวอร์ตัดรวมที่ 60,000 ตัวอักษรอยู่แล้ว (ไทย 3 byte/ตัว: 5 ไฟล์ ≈ 0.9MB) */
const MAX_CHARS_PER_FILE = 60_000
/**
 * worker ก๊อปมาไว้ใน public/ ตรง ๆ — ปล่อยให้ Next 14 bundle เองแล้ว terser ทำ worker พัง
 * ("Object.defineProperty called on non-object") ถ้าอัปเกรด pdfjs-dist ต้องก๊อปไฟล์ใหม่และเปลี่ยนชื่อตามเวอร์ชัน
 */
const WORKER_SRC = '/pdfjs/pdf.worker-4.10.38.min.mjs'

/** maxChars: เพดานข้อความ (default 60,000 ตามไฟล์ธุรกิจ) — ไฟล์ข้อจำกัดของ Content Engine ส่งค่าสูงกว่า */
export async function readPdfText(file: File, maxChars = MAX_CHARS_PER_FILE): Promise<{ text: string; pages: number }> {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  try {
    const pages: string[] = []
    let total = 0
    for (let i = 1; i <= doc.numPages && total < maxChars; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      // ต่อบรรทัดตามตำแหน่ง y แบบ pdf-parse — hasEOL ของ pdf.js วางผิดที่กับสระ/วรรณยุกต์ไทย ("วาณาวั\nนที่")
      let text = ''
      let lastY: number | null = null
      for (const item of content.items) {
        if (!('str' in item)) continue
        const y = item.transform[5]
        if (lastY !== null && Math.abs(y - lastY) > 1) text += '\n'
        text += item.str
        lastY = y
      }
      page.cleanup()
      pages.push(text.trim())
      total += text.length
    }
    return { text: pages.filter(Boolean).join('\n\n').slice(0, maxChars), pages: doc.numPages }
  } finally {
    await doc.destroy()
  }
}
