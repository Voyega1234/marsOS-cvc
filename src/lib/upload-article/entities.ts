// ─── Upload Article — ถอด HTML entity ของข้อความ (ไม่มี dependency ใช้ได้ทั้ง server และ client) ───

/** อักขระที่ต้องคงเป็น escape ใน HTML เสมอ (ถอดแล้วจะกลายเป็น markup) */
const KEEP_ESCAPED: Record<number, string> = { 38: '&amp;', 60: '&lt;', 62: '&gt;', 34: '&quot;', 39: '&#39;' }

const TYPO_ENTITIES: Record<string, string> = {
  ldquo: '\u201c', rdquo: '\u201d', lsquo: '\u2018', rsquo: '\u2019', sbquo: '\u201a', bdquo: '\u201e',
  hellip: '\u2026', ndash: '\u2013', mdash: '\u2014', bull: '\u2022', middot: '\u00b7',
  reg: '\u00ae', copy: '\u00a9', trade: '\u2122', deg: '\u00b0', times: '\u00d7', divide: '\u00f7',
  plusmn: '\u00b1', laquo: '\u00ab', raquo: '\u00bb', euro: '\u20ac', pound: '\u00a3', yen: '\u00a5',
  cent: '\u00a2', sect: '\u00a7', para: '\u00b6', frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be',
  sup2: '\u00b2', sup3: '\u00b3', micro: '\u00b5', larr: '\u2190', rarr: '\u2192', uarr: '\u2191', darr: '\u2193',
}

/**
 * ถอด entity ตัวเลข (&#3619;) และ entity ตัวอักษรทั่วไป (&ldquo; &reg;) กลับเป็นตัวอักษรจริง
 * Google Docs (export?format=html) ส่งภาษาไทยทุกตัวมาเป็น &#NNNN; — ถ้าไม่ถอด HTML ใหญ่ขึ้น ~7 เท่า
 * และทุกที่ที่อ่านข้อความดิบ (preview card, นับคำ, หา FAQ, ส่งให้ AI) จะอ่านไม่รู้เรื่อง
 * อักขระ & < > " ' ยังคงเป็น escape เหมือนเดิม (ไม่เปลี่ยนโครงสร้าง HTML) &nbsp; และ entity ที่ไม่รู้จักคงไว้
 */
export function decodeTextEntities(html: string): string {
  return html.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, ent: string) => {
    if (ent[0] === '#') {
      const isHex = ent[1] === 'x' || ent[1] === 'X'
      const code = parseInt(ent.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return m
      if (code === 160) return '&nbsp;'
      return KEEP_ESCAPED[code] ?? String.fromCodePoint(code)
    }
    return TYPO_ENTITIES[ent] ?? m
  })
}
