// ─── Mars Article Structure — FAQ (H2 + คำถาม H3) และกล่อง Key Takeaways ─────────────
// มาตรฐานกลางทุกตัวเขียน (Upload / PBN / SEO / Audit fix) — เจ้าของสั่ง 2026-10-21
// - หัวส่วน FAQ = <h2> เสมอ, คำถามใน <summary> ของ <details> = <span class="content-faq__q"> (ไม่ใช่ h3 — ดู faqQuestionsToSpan)
// - Key Takeaways = กล่อง <div class="content-takeaways"> หัวกล่องเป็น <p> (ไม่ใช่ H2 จึงไม่เข้าสารบัญ)
// ไฟล์นี้ไม่มี dependency — ใช้ได้ทั้ง server, client และสคริปต์ย้ายข้อมูล

/** หัวข้อ Key Takeaways — ตรงทั้งบรรทัดเท่านั้น ("สรุป" เฉย ๆ คือบทสรุปท้ายบท ห้ามจับ) */
export const TAKEAWAYS_HEADING_RE =
  /^\s*(?:key\s*takeaways?|สรุปประเด็นสำคัญ(?:ของบทความ(?:นี้)?)?|ประเด็นสำคัญ(?:ของบทความ(?:นี้)?|ที่ควรรู้)?|ใจความสำคัญ|สรุปสั้น\s*ๆ?|tl;?\s*dr)\s*(?:[(（][^)）]{0,40}[)）])?\s*[:：]?\s*$/i

const FAQ_HEADING_RE = /FAQ|คำถามที่พบบ่อย|คำถามยอดฮิต|Q\s*&\s*A|ถาม.?ตอบ|frequently asked|คำถามที่(หลายคน|คน|ผู้อ่าน|ลูกค้า)?(มัก|ชอบ)?(ถาม|สงสัย)/i

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
const idOf = (attrs: string) => /\bid="([^"]+)"/i.exec(attrs)?.[1] ?? ''
/** ตัดตัวหนาที่ครอบทั้งหัวข้อ — หัวกล่องหนาอยู่แล้ว */
const unwrapBold = (s: string) => s.trim().replace(/^<(strong|b)\b[^>]*>([\s\S]*)<\/\1>$/i, '$2').trim()

/** กฎโครงสร้างที่แนบทุกครั้งที่สั่งเขียนบทความ (ต่อจาก Human Voice Skill) */
export function articleStructureSkillBlock(language: 'th' | 'en' = 'th'): string {
  if (language === 'en') {
    return [
      '════ Mars Article Structure — Key Takeaways box + FAQ headings (system default) ════',
      '1. Key Takeaways: right after the opening paragraph and before the first <h2>, add a heading "Key Takeaways" followed by a <ul> of 3-5 short points (one sentence each) that sum up what the reader gets from this article. Do not repeat the closing summary word for word. The system turns it into a box.',
      '2. FAQ: the FAQ section heading is always <h2> (e.g. "FAQ" or "Frequently Asked Questions"). Every question is an <h3> (never <h2>, <h4> or bold text) and its answer follows as <p>. If the FAQ uses <details><summary>, put the question in <summary> as <span class="content-faq__q">…</span> — never an <h3> or any heading inside <summary>.',
      'If the task\'s HTML contract specifies exact markup for these parts, follow that markup; these rules decide where they go and which heading level they use.',
    ].join('\n')
  }
  return [
    '════ Mars Article Structure — กล่อง Key Takeaways + หัวข้อ FAQ (ค่าเริ่มต้นของระบบ) ════',
    '1. Key Takeaways: ต่อจากย่อหน้าเปิดเรื่อง ก่อน <h2> แรก ใส่หัวข้อ "สรุปประเด็นสำคัญ" ตามด้วย <ul> 3-5 ข้อ ข้อละ 1 ประโยคสั้น สรุปสิ่งที่ผู้อ่านจะได้จากบทความนี้ ห้ามลอกบทสรุปท้ายบทมาทั้งประโยค ระบบจะแปลงเป็นกล่องให้เอง',
    '2. FAQ: หัวส่วน FAQ ต้องเป็น <h2> เสมอ (เช่น "คำถามที่พบบ่อย" หรือ "FAQ") แต่ละคำถามต้องเป็น <h3> เท่านั้น (ห้าม <h2>, <h4> หรือตัวหนา) คำตอบตามหลังเป็น <p> ถ้า FAQ ใช้ <details><summary> ให้ใส่คำถามใน <summary> เป็น <span class="content-faq__q">…</span> — ห้ามใส่ <h3> หรือหัวข้อใด ๆ ใน <summary>',
    'ถ้าสัญญา HTML ของงานนี้กำหนดโครงแท็กของส่วนเหล่านี้ไว้ ให้ใช้โครงนั้น — กฎนี้คุมตำแหน่งและระดับหัวข้อ',
  ].join('\n')
}

/**
 * หัวข้อ (h1-h6) ใน <summary> → <span class="content-faq__q"> กลับเป็นแบบเดิม
 * เคยใส่ <h3> ใน <summary> (2026-10-21) แต่เว็บลูกค้าบางเว็บ (mfactors) ตัด <summary> ที่มี <h3> ทิ้ง
 * FAQ เหลือแต่ "Details" ไม่มีคำถาม — เจ้าของสั่งกลับไปใช้ <span> (2026-10-22) หัวส่วน FAQ ยังเป็น <h2>
 * summary ที่เป็นข้อความเปล่าหรือ <span> อยู่แล้ว ปล่อยตามเดิม
 */
export function faqQuestionsToSpan(html: string): string {
  return html.replace(/<summary\b([^>]*)>([\s\S]*?)<\/summary>/gi, (m, attrs: string, inner: string) => {
    const heading = /^<(h[1-6])\b[^>]*>([\s\S]*)<\/\1>$/i.exec(inner.trim())
    if (!heading) return m
    const q = heading[2].trim()
    if (!stripTags(q)) return m
    return `<summary${attrs}><span class="content-faq__q">${q}</span></summary>`
  })
}

/** หัว FAQ ที่เป็น h3-h6 (ก่อน <details> ข้อแรก) → <h2>, และคำถามแบบหัวข้อ h4-h6 ในส่วน FAQ → <h3> */
export function faqHeadingToH2(html: string): string {
  let out = html.replace(/<(h[3-6])\b([^>]*)>([\s\S]{1,300}?)<\/\1>(\s*<details\b)/gi, (m, _tag: string, attrs: string, inner: string, next: string) => {
    const text = stripTags(inner)
    if (!FAQ_HEADING_RE.test(text) || /[?？]$/.test(text) || text.length > 80) return m
    const withId = idOf(attrs) || /\bid="faq"/i.test(html) ? attrs : `${attrs} id="faq"`
    return `<h2${withId}>${inner}</h2>${next}`
  })
  // ส่วน FAQ แบบไม่ใช้ <details>: H2 FAQ → คำถามเป็น h4/h5/h6 จนถึง H2 ถัดไป
  out = out.replace(/(<h2\b[^>]*>([\s\S]*?)<\/h2>)([\s\S]*?)(?=<h2\b|<\/div>\s*$|$)/gi, (m, head: string, headInner: string, section: string) => {
    if (!FAQ_HEADING_RE.test(stripTags(headInner))) return m
    // มี <details>/<h3> อยู่แล้ว = คำถามอยู่ระดับถูกแล้ว h4 ที่เหลือเป็นหัวย่อยในคำตอบ (เช่นข้อดี-ข้อเสีย) ห้ามแตะ
    if (/<details\b|<h3\b/i.test(section)) return m
    return head + section.replace(/<(h[4-6])\b([^>]*)>([\s\S]*?)<\/\1>/gi, (_x, _t: string, a: string, i: string) => `<h3${a}>${i}</h3>`)
  })
  return out
}

/** หัวข้อ Key Takeaways + รายการถัดไป → กล่อง content-takeaways (คง id เดิมไว้ ลิงก์สารบัญเก่ายังกระโดดถึง) */
export function boxKeyTakeaways(html: string): string {
  const removedIds: string[] = []
  // AI รุ่นก่อนใส่ Key Takeaways ไว้ในกล่อง content-highlight/notice — แกะกล่องเดิมออกก่อน กันกล่องซ้อนกล่อง
  let out = html.replace(
    /<div\b[^>]*class="[^"]*\bcontent-(?:highlight|notice)\b[^"]*"[^>]*>\s*(<(h[2-6]|p)\b[^>]*>((?:(?!<\/\2>)[\s\S]){1,200})<\/\2>\s*<(ul|ol)\b[^>]*>[\s\S]*?<\/\4>)\s*<\/div>/gi,
    (m, inner: string, _tag: string, title: string) => (TAKEAWAYS_HEADING_RE.test(stripTags(title)) ? inner : m),
  )
  out = out.replace(
    /<(h[2-6]|p)\b([^>]*)>((?:(?!<\/\1>)[\s\S]){1,200})<\/\1>(\s*)(<(ul|ol)\b[^>]*>[\s\S]*?<\/\6>)/gi,
    (m, _tag: string, attrs: string, inner: string, _ws: string, list: string, listTag: string) => {
      if (/content-takeaways/i.test(attrs)) return m
      if (!TAKEAWAYS_HEADING_RE.test(stripTags(inner))) return m
      // รายการซ้อน (ul ใน li) — regex ตัดที่ </ul> แรก ผิดโครง ปล่อยไว้ตามเดิม
      if ((list.match(new RegExp(`<${listTag}\\b`, 'gi')) || []).length !== 1) return m
      const id = idOf(attrs)
      if (id) removedIds.push(id)
      return `<div class="content-takeaways"${id ? ` id="${id}"` : ''}><p class="content-takeaways__title">${unwrapBold(inner)}</p>${list}</div>`
    },
  )
  // หัวข้อที่กลายเป็นกล่องไม่ใช่ section แล้ว — ตัดรายการในสารบัญของระบบ
  for (const id of removedIds) {
    out = out.replace(/(<nav\b[^>]*content-toc[\s\S]*?<\/nav>)/i, (nav) =>
      nav.replace(new RegExp(`<li\\b[^>]*>\\s*<a\\b[^>]*href="#${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>[\\s\\S]*?<\\/a>\\s*<\\/li>`, 'i'), ''),
    )
  }
  return out
}

/** ทั้งชุด — ใช้หลัง AI เขียนเสร็จ (SEO) และตอนย้ายบทความเก่า */
export function normalizeFaqAndTakeaways(html: string): string {
  return boxKeyTakeaways(faqQuestionsToSpan(faqHeadingToH2(html)))
}

/** CSS ของ H3 ในคำถาม FAQ + กล่อง Key Takeaways — ต่อท้าย buildArticleCss */
export function articleStructureCss(theme: string, border: string): string[] {
  return [
    // คำถาม (span หรือ h3 ในบทความที่ยังไม่ได้แปลงกลับ): หน้าตาตามแถบคำถาม FAQ เดิม ไม่เอาขนาด/สี/margin ของ h3 จากเนื้อหาหรือธีมเว็บ
    `.content-article .content-faq__question h3,.content-article .content-faq__question .content-faq__q{margin:0;padding:0;border:0;background:none;font:inherit;color:inherit;letter-spacing:inherit;text-transform:inherit;flex:1 1 auto;min-width:0;text-align:left;}`,
    `.content-article .content-faq__question h3::before,.content-article .content-faq__question h3::after{content:none;display:none;}`,
    `.content-article .content-takeaways{border:1px solid color-mix(in srgb, ${theme} 30%, ${border});background:color-mix(in srgb, ${theme} 6%, transparent);border-radius:12px;padding:1.1em 1.3em;margin:1.6em 0;}`,
    `.content-article .content-takeaways__title{font-weight:700;color:${theme};margin:0 0 .5em;font-size:1.05em;}`,
    `.content-article .content-takeaways ul,.content-article .content-takeaways ol{margin:0;padding-left:1.3em;}`,
    `.content-article .content-takeaways li{margin:.35em 0;}`,
    `.content-article .content-takeaways li::marker{color:${theme};}`,
  ]
}
