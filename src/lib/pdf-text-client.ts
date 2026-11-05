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

// ── ไฟล์ข้อจำกัด: ข้อความรายหน้า + หน้าที่เนื้อหาอยู่ในรูป ───────────────────────

export interface PdfPageInfo {
  page: number
  text: string
  /** พื้นที่รูปต่อพื้นที่หน้า 0-1 */
  imageCoverage: number
}

/** รูปกินพื้นที่เท่านี้ขึ้นไป หรือมีรูปแต่แทบไม่มีข้อความ = เนื้อหาน่าจะอยู่ในรูป */
const IMAGE_PAGE_MIN_COVERAGE = 0.2
const IMAGE_PAGE_MAX_TEXT = 50

export function isImagePage(p: Pick<PdfPageInfo, 'text' | 'imageCoverage'>): boolean {
  return p.imageCoverage >= IMAGE_PAGE_MIN_COVERAGE || (p.imageCoverage > 0 && p.text.length < IMAGE_PAGE_MAX_TEXT)
}

type Matrix = [number, number, number, number, number, number]

function multiply(m: Matrix, n: number[]): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

/** ไล่ transform ของหน้าเพื่อหาพื้นที่ที่รูปวาดจริง — รูปวาดในกรอบ 1x1 ของ matrix ปัจจุบัน */
function imageAreaOf(fnArray: number[], argsArray: unknown[][], OPS: Record<string, number>, pageArea: number): number {
  const stack: Matrix[] = []
  let ctm: Matrix = [1, 0, 0, 1, 0, 0]
  let area = 0
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    const args = argsArray[i]
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm
    else if (fn === OPS.transform) ctm = multiply(ctm, args as number[])
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm)
      if (Array.isArray(args?.[0])) ctm = multiply(ctm, args[0] as number[])
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      area += Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])
    }
  }
  return pageArea > 0 ? Math.min(1, area / pageArea) : 0
}

/** ต่อข้อความแบบเดียวกับ readPdfText และบอกว่าแต่ละหน้ามีรูปกินพื้นที่แค่ไหน */
export async function readPdfPages(file: File, maxChars = MAX_CHARS_PER_FILE): Promise<{ pages: PdfPageInfo[]; pageCount: number }> {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  try {
    const pages: PdfPageInfo[] = []
    let total = 0
    for (let i = 1; i <= doc.numPages && total < maxChars; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      let text = ''
      let lastY: number | null = null
      for (const item of content.items) {
        if (!('str' in item)) continue
        const y = item.transform[5]
        if (lastY !== null && Math.abs(y - lastY) > 1) text += '\n'
        text += item.str
        lastY = y
      }
      // ตรวจรูปพลาด = ถือว่าไม่มีรูป เสียแค่ไม่เสนอให้ AI อ่านหน้านั้น ข้อความยังครบ
      let imageCoverage = 0
      try {
        const ops = await page.getOperatorList()
        const { width, height } = page.getViewport({ scale: 1 })
        imageCoverage = imageAreaOf(ops.fnArray, ops.argsArray, pdfjs.OPS as unknown as Record<string, number>, width * height)
      } catch {
        imageCoverage = 0
      }
      page.cleanup()
      pages.push({ page: i, text: text.trim(), imageCoverage })
      total += text.length
    }
    return { pages, pageCount: doc.numPages }
  } finally {
    await doc.destroy()
  }
}

/** ข้อความพร้อมตำแหน่งรายหน้า — ใช้ประกอบตารางจาก PDF */
export async function readPdfTextItems(file: File): Promise<Array<Array<{ str: string; x: number; y: number; width: number }>>> {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  try {
    const pages: Array<Array<{ str: string; x: number; y: number; width: number }>> = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const items: Array<{ str: string; x: number; y: number; width: number }> = []
      for (const item of content.items) {
        if ('str' in item && item.str) items.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width })
      }
      page.cleanup()
      pages.push(items)
    }
    return pages
  } finally {
    await doc.destroy()
  }
}

/** เรนเดอร์หน้าเป็น JPEG — ลดคุณภาพจนไม่เกิน maxBytes เพราะ body ของ Vercel รับได้ราว 4.5MB */
export async function renderPdfPagesJpeg(
  file: File,
  pageNumbers: number[],
  onPage: (page: number, dataUrl: string) => Promise<void>,
  opts: { maxSide?: number; maxBytes?: number } = {},
): Promise<void> {
  const maxSide = opts.maxSide ?? 1600
  const maxBytes = opts.maxBytes ?? 3_000_000
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  try {
    for (const n of pageNumbers) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: maxSide / Math.max(base.width, base.height) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const canvasContext = canvas.getContext('2d')
      if (!canvasContext) throw new Error('เบราว์เซอร์สร้าง canvas ไม่ได้')
      await page.render({ canvasContext, viewport }).promise
      let dataUrl = canvas.toDataURL('image/jpeg', 0.82)
      for (const q of [0.65, 0.5, 0.35]) {
        if (dataUrl.length * 0.75 <= maxBytes) break
        dataUrl = canvas.toDataURL('image/jpeg', q)
      }
      page.cleanup()
      await onPage(n, dataUrl)
    }
  } finally {
    await doc.destroy()
  }
}
