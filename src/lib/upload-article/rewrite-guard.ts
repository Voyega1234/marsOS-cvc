// ด่านตรวจผลเขียนใหม่ด้วย AI ก่อนทับบทความเดิม (เฉพาะเส้นทาง rewrite — เขียนบทความใหม่ปกติไม่ใช้)

/** เหตุผลสิ้นสุดที่ถือว่าโมเดลเขียนจบเอง */
export function isNormalStopFinish(finishReason: string | undefined | null): boolean {
  return finishReason === 'stop' || finishReason === 'end_turn' || finishReason === 'completed'
}

/** ข้อความล้วนจาก HTML (ตัด tag/entity เบื้องต้น) */
export function plainTextLength(html: string | null | undefined): number {
  return (html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length
}

const countH2 = (html: string | null | undefined) => (html?.match(/<h2[\s>]/gi) || []).length

/** ผลเขียนใหม่สั้นผิดปกติ/โครงหายไหม — คืนข้อความ error หรือ null ถ้าผ่าน */
export function rewriteOutputProblem(oldHtml: string | null | undefined, newHtml: string): string | null {
  const oldLen = plainTextLength(oldHtml)
  const newLen = plainTextLength(newHtml)
  if (oldLen > 0 && newLen < oldLen * 0.5) {
    return 'เนื้อหาใหม่สั้นกว่าเดิมเกินครึ่ง (โมเดลอาจตอบไม่ครบ/ปฏิเสธ) — เก็บบทความเดิมไว้ ลองเขียนใหม่อีกครั้ง'
  }
  if (countH2(oldHtml) > 0 && countH2(newHtml) === 0) {
    return 'เนื้อหาใหม่ไม่มีหัวข้อ H2 เลยทั้งที่บทความเดิมมี — เก็บบทความเดิมไว้ ลองเขียนใหม่อีกครั้ง'
  }
  return null
}

/** ผลเขียนใหม่ที่เก่าเกินนี้ไม่แสดง toast ซ้ำ (เวลาฝั่ง server) */
export const REWRITE_RESULT_TTL_MS = 30 * 60 * 1000
