/**
 * แยกบทความ HTML ที่ระบบเขียน ออกเป็น card ตามส่วนประกอบ
 * (Title / TOC / เนื้อหาแต่ละ H2 / CTA / FAQ) เพื่อให้เลือกได้ก่อน push
 * ว่าจะเอา card ไหนขึ้นเว็บจริงบ้าง — กัน component ซ้ำกับที่เว็บปลายทางมีอยู่แล้ว
 *
 * ทำงานแบบ string-scan ล้วน (ไม่ใช้ DOM) จึงใช้ได้ทั้ง server และ client
 * และคง byte เดิมของ HTML ไว้ทุกส่วน: head + cards + tail ต่อกันแล้วได้ไฟล์เดิมเสมอ
 */

export type ArticleCardType = 'title' | 'toc' | 'content' | 'cta' | 'faq'

export interface ArticleCard {
  id: string
  type: ArticleCardType
  /** ป้ายที่มนุษย์อ่าน — ข้อความหัวข้อ หรือชื่อชนิด card */
  label: string
  /** HTML ต้นฉบับของส่วนนี้ (card toc เป็น HTML ที่ generate ให้) */
  html: string
  /** ข้อความล้วนตัด tag แล้ว (ใช้แสดง preview) */
  plainText: string
  /** true = card ที่ระบบสร้างเพิ่มให้ ไม่ได้อยู่ในบทความต้นฉบับ (เช่น TOC) */
  derived?: boolean
}

export interface ParsedArticle {
  /** ทุกอย่างก่อน h1 — meta comment, <style>, wrapper เปิด (ต้องคงไว้เสมอ) */
  head: string
  /** ส่วนปิดท้ายหลัง card สุดท้าย เช่น </div> ของ wrapper */
  tail: string
  cards: ArticleCard[]
}

export function stripTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

const FAQ_HEADING = /(คำถามที่พบบ่อย|FAQ)/i

/** หา </div> ที่ปิด <div ...> ณ ตำแหน่ง start (นับความลึกแบบไม่พึ่ง DOM) */
function findDivEnd(html: string, start: number): number {
  const re = /<\/?div\b[^>]*>/gi
  re.lastIndex = start
  let depth = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (m[0][1] === '/') depth--
    else depth++
    if (depth === 0) return m.index + m[0].length
  }
  return -1
}

/**
 * ตัด <div class="...cta..."> ออกมาเป็นชิ้น ๆ โดยรักษาลำดับตำแหน่งเดิม
 * คืน segment สลับ text/cta เรียงตามต้นฉบับ
 */
function splitOutCta(html: string): Array<{ kind: 'text' | 'cta'; html: string }> {
  const out: Array<{ kind: 'text' | 'cta'; html: string }> = []
  let cursor = 0
  const re = /<div\b[^>]*class="[^"]*\bcta\b[^"]*"[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const end = findDivEnd(html, m.index)
    if (end < 0) break
    if (m.index > cursor) out.push({ kind: 'text', html: html.slice(cursor, m.index) })
    out.push({ kind: 'cta', html: html.slice(m.index, end) })
    cursor = end
    re.lastIndex = end
  }
  if (cursor < html.length) out.push({ kind: 'text', html: html.slice(cursor) })
  return out
}

function headingText(html: string, tag: 'h1' | 'h2'): string {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? stripTags(m[1]) : ''
}

export function parseArticleCards(html: string): ParsedArticle {
  const h1 = /<h1\b[^>]*>/i.exec(html)
  if (!h1) {
    // ไม่มี h1 — คืนทั้งก้อนเป็น content card เดียว จะได้ push แบบเดิมได้เสมอ
    return {
      head: '', tail: '',
      cards: [{ id: 'content-0', type: 'content', label: 'เนื้อหาบทความ', html, plainText: stripTags(html).slice(0, 300) }],
    }
  }

  const head = html.slice(0, h1.index)
  let body = html.slice(h1.index)

  // ตัด wrapper ปิดท้าย (</div> ติด ๆ กันท้ายไฟล์) ไปเป็น tail เพื่อไม่ให้ไปติดอยู่ใน card สุดท้าย
  let tail = ''
  const tailMatch = body.match(/(\s*(?:<\/div>\s*)+)$/)
  if (tailMatch) {
    tail = tailMatch[1]
    body = body.slice(0, body.length - tail.length)
  }

  // แบ่งตาม h2: ก้อนแรก (h1 + intro) เป็น title card ที่เหลือเป็น section
  const h2Positions: number[] = []
  const h2re = /<h2\b[^>]*>/gi
  let hm: RegExpExecArray | null
  while ((hm = h2re.exec(body))) h2Positions.push(hm.index)

  const rawBlocks: Array<{ kind: 'title' | 'section'; html: string }> = []
  if (h2Positions.length === 0) {
    rawBlocks.push({ kind: 'title', html: body })
  } else {
    rawBlocks.push({ kind: 'title', html: body.slice(0, h2Positions[0]) })
    for (let i = 0; i < h2Positions.length; i++) {
      const end = i + 1 < h2Positions.length ? h2Positions[i + 1] : body.length
      rawBlocks.push({ kind: 'section', html: body.slice(h2Positions[i], end) })
    }
  }

  // แตก CTA ออกจากทุก block แล้วประกอบเป็น card เรียงตามต้นฉบับ
  const cards: ArticleCard[] = []
  let ctaCount = 0
  let contentCount = 0
  for (const block of rawBlocks) {
    for (const seg of splitOutCta(block.html)) {
      if (seg.kind === 'cta') {
        cards.push({
          id: `cta-${ctaCount++}`, type: 'cta', label: 'CTA',
          html: seg.html, plainText: stripTags(seg.html),
        })
        continue
      }
      if (!stripTags(seg.html) && !/<img\b/i.test(seg.html)) continue // ชิ้นว่าง — ข้าม
      if (block.kind === 'title' && cards.length === 0) {
        cards.push({
          id: 'title-0', type: 'title',
          label: headingText(seg.html, 'h1') || 'Title + Intro',
          html: seg.html, plainText: stripTags(seg.html).slice(0, 400),
        })
      } else {
        const h2 = headingText(seg.html, 'h2')
        const isFaq = FAQ_HEADING.test(h2)
        cards.push({
          id: `${isFaq ? 'faq' : 'content'}-${contentCount++}`,
          type: isFaq ? 'faq' : 'content',
          label: h2 || 'เนื้อหา',
          html: seg.html, plainText: stripTags(seg.html).slice(0, 400),
        })
      }
    }
  }

  // TOC card (derived) — สร้างจากรายชื่อ h2 ให้เลือกเพิ่มได้ (default ไม่เลือก
  // เพราะบทความต้นฉบับไม่มี และเว็บปลายทางจำนวนมากมี TOC plugin อยู่แล้ว)
  const tocTargets = cards.filter(c => c.type === 'content' || c.type === 'faq')
  if (tocTargets.length > 0) {
    const items = tocTargets.map((c, i) => `  <li><a href="#cc-sec-${i}">${c.label}</a></li>`).join('\n')
    const tocHtml = `<nav class="mars-toc" aria-label="สารบัญ">\n<strong>สารบัญ</strong>\n<ol>\n${items}\n</ol>\n</nav>`
    const titleIdx = cards.findIndex(c => c.type === 'title')
    cards.splice(titleIdx + 1, 0, {
      id: 'toc-0', type: 'toc', label: 'สารบัญ (Table of Contents)',
      html: tocHtml, plainText: tocTargets.map(c => c.label).join(' · '),
      derived: true,
    })
  }

  return { head, tail, cards }
}

/**
 * ประกอบ HTML กลับจาก card ที่เลือก — ลำดับตามต้นฉบับเสมอ
 * ถ้าเลือก TOC จะฝัง id ให้ h2 ของ card ที่เลือกโดยอัตโนมัติเพื่อให้ลิงก์ทำงาน
 */
export function assembleArticleHtml(parsed: ParsedArticle, selectedIds: Set<string>): string {
  const chosen = parsed.cards.filter(c => selectedIds.has(c.id))
  const withToc = chosen.some(c => c.type === 'toc')

  const sectionCards = chosen.filter(c => c.type === 'content' || c.type === 'faq')
  const pieces = chosen.map(card => {
    if (card.type === 'toc') {
      // สร้าง TOC ใหม่จากเฉพาะ section ที่ถูกเลือกจริง
      const items = sectionCards.map((c, i) => `  <li><a href="#cc-sec-${i}">${c.label}</a></li>`).join('\n')
      return `<nav class="mars-toc" aria-label="สารบัญ">\n<strong>สารบัญ</strong>\n<ol>\n${items}\n</ol>\n</nav>`
    }
    if (withToc && (card.type === 'content' || card.type === 'faq')) {
      const i = sectionCards.indexOf(card)
      return card.html.replace(/<h2\b((?![^>]*\bid=)[^>]*)>/i, `<h2 id="cc-sec-${i}"$1>`)
    }
    return card.html
  })

  return parsed.head + pieces.join('\n') + parsed.tail
}
