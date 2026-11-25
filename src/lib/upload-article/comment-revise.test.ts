// รัน: npx tsx src/lib/upload-article/comment-revise.test.ts
import {
  applyRevision, buildReviseSystemPrompt, detectArticleLanguage, imageTokensOf, locateQuote, planRevision, splitBlocks,
  ReviseInputError, ReviseOutputError,
} from './comment-revise'

let passed = 0
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
}
function throws(fn: () => unknown, type: new (...a: never[]) => Error, msg: string) {
  try {
    fn()
  } catch (e) {
    assert(e instanceof type, `${msg} (ชนิด error)`)
    return
  }
  throw new Error(`FAIL: ${msg} (ไม่ throw)`)
}

const IMG = '<img src="https://example.com/a.jpg" alt="ภาพ" data-align="center" width="600">'
const ARTICLE = [
  '<h1>รีวิวคลินิก</h1>',
  '\n',
  '<p>ย่อหน้าแรก พูดถึงบริการทั่วไปของคลินิกแห่งนี้</p>',
  '\n<!-- note -->\n',
  '<h2>ราคา</h2>',
  '<p>ราคาเริ่มต้น 5,000 บาท ต่อครั้ง <a href="https://example.com/price">ดูราคา</a></p>',
  `<figure>${IMG}<figcaption>ภาพคลินิก</figcaption></figure>`,
  '<ul><li>ข้อหนึ่ง</li><li>ข้อสอง ที่ลูกค้าอยากให้แก้คำ</li></ul>',
  '<p></p>',
  '<p>ย่อหน้าสุดท้าย   มีช่องว่าง  แปลก ๆ</p>',
].join('')

// ── splitBlocks ──
{
  const segs = splitBlocks(ARTICLE)
  assert(segs, 'แบ่งบล็อกได้')
  assert(segs!.map((s) => s.raw).join('') === ARTICLE, 'ต่อกลับได้ HTML เดิมทุกตัวอักษร')
  const blocks = segs!.filter((s) => s.block)
  assert(blocks.length === 7, `ได้ 7 บล็อก (ได้ ${blocks.length})`)
  assert(blocks[0].raw === '<h1>รีวิวคลินิก</h1>', 'บล็อกแรกคือ h1 ทั้ง tag')
  assert(blocks[4].raw.startsWith('<figure>') && blocks[4].raw.endsWith('</figure>'), 'figure เป็นบล็อกเดียว')
  assert(!segs!.some((s) => s.block && s.raw === '<p></p>'), 'ย่อหน้าว่างไม่นับเป็นบล็อก')
  assert(segs!.some((s) => !s.block && s.raw.includes('<!-- note -->')), 'comment node ส่งผ่านตามเดิม')
}
{
  const wrapped = `<div class="doc">\n${ARTICLE}\n</div>`
  const segs = splitBlocks(wrapped)
  assert(segs && segs.map((s) => s.raw).join('') === wrapped, 'ตัวครอบเดียว: ต่อกลับได้เหมือนเดิม')
  assert(segs!.filter((s) => s.block).length === 7, 'ตัวครอบเดียว: ลงไปแบ่งข้างใน')
  assert(segs![0].raw.startsWith('<div class="doc">') && !segs![0].block, 'tag เปิดของตัวครอบส่งผ่าน')
}
{
  const segs = splitBlocks('ข้อความเปล่า<p>ย่อหน้า</p><style>p{color:red}</style>')
  assert(segs && segs.filter((s) => s.block).length === 2, 'ข้อความเปล่าระดับบนเป็นบล็อก, style ไม่เป็น')
}

// ── locateQuote ──
{
  const texts = ['รีวิวคลินิก', 'ย่อหน้าแรก พูดถึงบริการทั่วไปของคลินิกแห่งนี้', 'ราคา', 'ข้อหนึ่ง ข้อสอง ที่ลูกค้าอยากให้แก้คำ']
  assert(locateQuote(texts, 'ราคา') === 3, 'ตรงทั้งบล็อก')
  assert(locateQuote(texts, 'ข้อสอง ที่ลูกค้าอยากให้แก้คำ') === 4, 'อยู่ในบล็อก (li ใน ul)')
  assert(locateQuote(texts, 'ไม่มีข้อความนี้ในบทความเลยสักที่') === 0, 'หาไม่เจอ = 0')
  assert(locateQuote(texts, undefined) === 0, 'ไม่มี quote = 0')
  assert(locateQuote(texts, 'ย่อหน้าแรก พูดถึงบริการทั่วไปของคลินิกแ…') === 2, 'quote ที่ถูกตัดท้ายด้วย …')
}

// ── planRevision ──
const plan = planRevision({
  title: 'รีวิวคลินิก',
  sourceHtml: ARTICLE,
  comments: [
    { id: 'c1', text: 'ราคาเปลี่ยนเป็น 6,500 บาท', quote: 'ราคาเริ่มต้น 5,000 บาท ต่อครั้ง ดูราคา' },
    { id: 'c2', text: 'ใช้คำว่า "ผู้รับบริการ" แทน "ลูกค้า" ทั้งบทความ' },
    { id: null, text: '  เพิ่มเบอร์โทรท้ายบทความ  ' },
    { id: 'c4', text: '   ' },
  ],
})
{
  assert(plan.comments.length === 3, 'comment ว่างถูกตัด')
  assert(plan.blockAt.length === 7, 'plan มี 7 บล็อก')
  assert(plan.images.length === 1 && plan.images[0] === IMG, 'เก็บ <img> เดิมไว้')
  assert(plan.user.includes('[[IMG_1]]') && !plan.user.includes('example.com/a.jpg'), 'prompt ใช้โทเคนรูปแทน <img>')
  assert(imageTokensOf(plan.user).length === 1, 'โทเคนรูป 1 ตัวใน prompt')
  assert(plan.user.includes('[4] <p>ราคาเริ่มต้น 5,000 บาท'), 'บล็อกมีเลขกำกับ')
  assert(plan.user.includes('1. ตำแหน่ง: บล็อก [4]'), 'comment ที่มี quote บอกเลขบล็อก')
  assert(plan.user.includes('2. ตำแหน่ง: ไม่ระบุ'), 'comment ไม่มี quote = ไม่ระบุตำแหน่ง')
  assert(plan.user.includes('Comment: เพิ่มเบอร์โทรท้ายบทความ'), 'ข้อความ comment ถูก trim')
}
throws(() => planRevision({ title: '', sourceHtml: ARTICLE, comments: [] }), ReviseInputError, 'ไม่มี comment')
throws(() => planRevision({ title: '', sourceHtml: '  ', comments: [{ id: 'a', text: 'x' }] }), ReviseInputError, 'บทความว่าง')
throws(
  () => planRevision({ title: '', sourceHtml: `<p>${'ก'.repeat(160_000)}</p>`, comments: [{ id: 'a', text: 'x' }] }),
  ReviseInputError,
  'บทความยาวเกิน',
)

// ── applyRevision ──
{
  // ไม่มีรายการแก้ = HTML เดิมทุกตัวอักษร
  const r = applyRevision(plan, '{"edits":[],"unresolved":[]}')
  assert(r.html === ARTICLE && r.changed === 0, 'edits ว่าง = ไม่เปลี่ยน')
}
{
  const answer = JSON.stringify({
    edits: [
      { op: 'replace', block: 4, html: '<p style="color:red" onclick="x()">ราคาเริ่มต้น 6,500 บาท ต่อครั้ง <a href="https://example.com/price">ดูราคา</a></p><script>alert(1)</script>' },
      { op: 'delete', block: 2 },
      { op: 'insert_after', block: 7, html: '<p>โทร 02-000-0000</p>' },
      { op: 'insert_after', block: 0, html: '<p>บทนำใหม่</p>' },
      { op: 'replace', block: 4, html: '<p>ซ้ำ</p>' },
      { op: 'replace', block: 99, html: '<p>เกิน</p>' },
      { op: 'replace', block: 3 },
    ],
    unresolved: [{ comment: 2, reason: 'ขัดข้อจำกัด' }, { comment: 9, reason: 'เลขเกิน' }, { comment: 2, reason: 'ซ้ำ' }],
  })
  const r = applyRevision(plan, '```json\n' + answer + '\n```')
  assert(r.changed === 4, `ใช้ 4 รายการ (ได้ ${r.changed})`)
  assert(r.html.includes('6,500 บาท') && !r.html.includes('5,000 บาท'), 'replace ใช้แล้ว')
  assert(!r.html.includes('<script') && !r.html.includes('onclick') && !r.html.includes('style='), 'HTML ใหม่ถูกล้าง script/attribute')
  assert(r.html.includes('<a href="https://example.com/price">ดูราคา</a>'), 'ลิงก์ยังอยู่')
  assert(!r.html.includes('ย่อหน้าแรก'), 'delete ใช้แล้ว')
  assert(r.html.startsWith('<p>บทนำใหม่</p><h1>รีวิวคลินิก</h1>'), 'insert_after 0 = ต้นบทความ')
  assert(r.html.endsWith('แปลก ๆ</p><p>โทร 02-000-0000</p>'), 'insert_after บล็อกสุดท้าย = ท้ายบทความ')
  assert(r.html.includes('<h2>ราคา</h2>'), 'รายการแก้ที่ไม่มี html ถูกข้าม บล็อกเดิมอยู่')
  assert(r.html.includes(`<figure>${IMG}<figcaption>ภาพคลินิก</figcaption></figure>`), 'บล็อกที่ไม่แก้คงเดิมทุกตัวอักษร (รวม attribute รูป)')
  assert(r.html.includes('<p>ย่อหน้าสุดท้าย   มีช่องว่าง  แปลก ๆ</p>'), 'ช่องว่างในบล็อกที่ไม่แก้ไม่ถูกจัดใหม่')
  assert(r.html.includes('<!-- note -->'), 'ส่วนที่ส่งผ่านยังอยู่')
  assert(r.unresolved[0].commentId === 'c2' && r.unresolved[0].reason === 'ขัดข้อจำกัด', 'unresolved จับคู่ comment ถูก ไม่รับเลขเกิน')
  assert(r.unresolved.filter((u) => u.commentId === 'c2').length === 1, 'unresolved ไม่ซ้ำ')
  // รายการแก้ที่ถูกข้ามไม่ได้บอกเลข Comment = ระบุไม่ได้ว่าข้อไหนยังไม่ได้ปรับ ทุกข้อจึงยังไม่นับว่าปรับแล้ว
  assert(r.unresolved.length === 3 && r.unresolved.some((u) => u.commentId === 'c1') && r.unresolved.some((u) => u.commentId === null), 'รายการแก้ที่ถูกข้ามและไม่บอกเลข Comment = ทุกข้อค้างไว้')
  assert(r.warnings.some((w) => w.includes('3 รายการ')), 'เตือนรายการแก้ที่ใช้ไม่ได้ 3 รายการ')
}
{
  // รายการแก้ที่ถูกข้ามบอกเลข Comment = ค้างเฉพาะข้อนั้น
  const r = applyRevision(
    plan,
    JSON.stringify({
      edits: [
        { op: 'replace', block: 4, comment: 1, html: '<p>ราคาเริ่มต้น 6,500 บาท ต่อครั้ง</p>' },
        { op: 'replace', block: 99, comment: [2, '3', 9, 2], html: '<p>เกิน</p>' },
      ],
      unresolved: [],
    }),
  )
  assert(r.changed === 1, 'ใช้ 1 รายการ')
  assert(r.unresolved.length === 2, `ค้าง 2 ข้อ (ได้ ${r.unresolved.length})`)
  assert(r.unresolved.some((u) => u.commentId === 'c2') && r.unresolved.some((u) => u.commentId === null), 'ค้างเฉพาะ Comment ของรายการที่ถูกข้าม (รับ array, เลขเป็น string, ตัดเลขเกิน/ซ้ำ)')
  assert(!r.unresolved.some((u) => u.commentId === 'c1'), 'Comment ที่รายการแก้ใช้ได้ไม่ค้าง')
}
{
  // รายการแก้ครบทุกข้อใช้ได้ = ไม่มีข้อไหนค้าง
  const r = applyRevision(plan, JSON.stringify({ edits: [{ op: 'replace', block: 4, comment: 1, html: '<p>ราคา 6,500 บาท</p>' }], unresolved: [] }))
  assert(r.changed === 1 && r.unresolved.length === 0, 'ไม่มีรายการถูกข้าม = unresolved ว่าง')
}
{
  // บล็อกที่ระบบใส่ไว้เอง (กล่อง CTA, รูปที่ระบบสร้าง) โมเดลไม่เห็นและแก้ไม่ได้
  const CTA = '<div class="content-cta"><p>โทรเลย 02-111-1111</p></div>'
  const GEN = '<figure data-ua-gen="1"><img src="https://example.com/gen.jpg" alt="สร้าง"></figure>'
  const html = `<h2>หัวข้อ</h2><p>เนื้อหาเดิม</p>${GEN}<p>ท้าย</p>${CTA}`
  const segs = splitBlocks(html)
  assert(segs && segs.map((s) => s.raw).join('') === html, 'บล็อกที่ล็อก: ต่อกลับได้เหมือนเดิม')
  assert(segs!.filter((s) => s.block).length === 3, 'กล่อง CTA และรูปที่ระบบสร้างไม่นับเป็นบล็อก')
  const p = planRevision({ title: 't', sourceHtml: html, comments: [{ id: 'a', text: 'แก้เนื้อหา' }] })
  assert(!p.user.includes('โทรเลย') && !p.user.includes('gen.jpg'), 'โมเดลไม่เห็นบล็อกที่ล็อก')
  const r = applyRevision(p, JSON.stringify({ edits: [{ op: 'replace', block: 2, comment: 1, html: '<p>เนื้อหาใหม่</p>' }, { op: 'delete', block: 3, comment: 1 }] }))
  assert(r.html === `<h2>หัวข้อ</h2><p>เนื้อหาใหม่</p>${GEN}${CTA}`, 'แก้บล็อกรอบข้างแล้วบล็อกที่ล็อกยังเหมือนเดิมทุกตัวอักษร')
}
{
  // ข้อความ [[IMG_n]] ที่อยู่ในบล็อกที่ไม่ได้แก้ต้องไม่ถูกแตะ
  const html = `<p>พิมพ์ [[IMG_1]] ไว้ในเนื้อหา</p><figure>${IMG}</figure><p>ท้าย</p>`
  const p = planRevision({ title: 't', sourceHtml: html, comments: [{ id: 'a', text: 'แก้ท้าย' }] })
  const r = applyRevision(p, JSON.stringify({ edits: [{ op: 'replace', block: 3, comment: 1, html: '<p>ท้ายใหม่</p>' }] }))
  assert(r.html === `<p>พิมพ์ [[IMG_1]] ไว้ในเนื้อหา</p><figure>${IMG}</figure><p>ท้ายใหม่</p>`, 'บล็อกที่ไม่ได้แก้คงเดิม แม้มีข้อความหน้าตาเหมือนโทเคนรูป')
}
{
  // โมเดลใส่โทเคนรูปซ้ำในท่อนใหม่ ทั้งที่รูปเดิมยังอยู่ = เตือน
  const r = applyRevision(plan, JSON.stringify({ edits: [{ op: 'insert_after', block: 7, comment: 3, html: '<p>[[IMG_1]]</p>' }] }))
  assert(r.warnings.some((w) => w.includes('ใส่ซ้ำ')), `รูปซ้ำ = เตือน (ได้ ${JSON.stringify(r.warnings)})`)
}
{
  const plain = buildReviseSystemPrompt({})
  assert(plain.includes('"comment":[1,4]') && plain.includes('ต้องใส่ทุกรายการ'), 'prompt สั่งให้รายการแก้บอกเลข Comment')
}
{
  // รูป: แก้บล็อกที่มีรูปโดยคงโทเคน = <img> เดิมทุกตัวอักษร
  const keep = applyRevision(plan, JSON.stringify({ edits: [{ op: 'replace', block: 5, html: '<figure>[[IMG_1]]<figcaption>ภาพหน้าคลินิก</figcaption></figure>' }] }))
  assert(keep.html.includes(`<figure>${IMG}<figcaption>ภาพหน้าคลินิก</figcaption></figure>`), 'โทเคนรูปกลับเป็น <img> เดิม')
  assert(!keep.warnings.some((w) => w.includes('รูป')), 'รูปยังอยู่ ไม่เตือน')
  const lost = applyRevision(plan, JSON.stringify({ edits: [{ op: 'replace', block: 5, html: '<p>ไม่มีรูปแล้ว [[IMG_7]]</p>' }] }))
  assert(!lost.html.includes('[[IMG_') && !lost.html.includes(IMG), 'โทเคนที่โมเดลแต่งเองถูกตัด')
  assert(lost.warnings.some((w) => w.includes('หายไป 1 รูป')), 'รูปหาย = เตือน')
}
{
  // คำต้องห้าม: แทนเฉพาะท่อนที่แก้ ไม่แตะท่อนเดิมของลูกค้า
  const terms = [{ term: 'ลูกค้า', replacement: 'ผู้รับบริการ' }, { term: 'รักษาหาย', replacement: null }]
  const r = applyRevision(
    plan,
    JSON.stringify({ edits: [{ op: 'replace', block: 4, html: '<p>ลูกค้าจ่าย 6,500 บาท รักษาหายแน่นอน</p>' }] }),
    terms,
  )
  assert(r.html.includes('<p>ผู้รับบริการจ่าย 6,500 บาท'), 'คำที่มีคำแทนถูกแทนในท่อนใหม่')
  assert(r.html.includes('ข้อสอง ที่ลูกค้าอยากให้แก้คำ'), 'ท่อนเดิมที่ไม่ได้แก้ไม่ถูกแทนคำ')
  assert(r.warnings.some((w) => w.includes('"รักษาหาย"')), 'คำต้องห้ามที่ไม่มีคำแทน = เตือน')
}
throws(() => applyRevision(plan, 'ขออภัย ทำไม่ได้'), ReviseOutputError, 'คำตอบไม่ใช่ JSON')
throws(() => applyRevision(plan, '{"edits": [{"op":"replace","block":1,"html":"<p>ตัดกลาง'), ReviseOutputError, 'JSON ไม่ครบ')
throws(() => applyRevision(plan, '{"unresolved":[]}'), ReviseOutputError, 'ไม่มี edits')

// ── system prompt ──
{
  const plain = buildReviseSystemPrompt({})
  assert(plain.includes('"edits"') && !plain.includes('ข้อจำกัดของแบรนด์ (ชนะ Comment ทุกกรณี)'), 'ไม่มีข้อจำกัด = ไม่มีหัวข้อข้อจำกัด')
  const withRules = buildReviseSystemPrompt({ restrictionsBlock: '### คำต้องห้าม\n- "รักษาหาย"', language: 'en' })
  assert(withRules.includes('ข้อจำกัดของแบรนด์ (ชนะ Comment ทุกกรณี)') && withRules.includes('"รักษาหาย"'), 'ใส่ข้อจำกัดท้าย prompt')
  assert(withRules.includes('Write like a knowledgeable person'), 'ภาษาอังกฤษใช้กฎสำนวนอังกฤษ')
}

// ── บทความอังกฤษ + Comment ไทย ──
{
  assert(detectArticleLanguage('Business process automation connects every department end to end.') === 'en', 'เนื้ออังกฤษ = en')
  assert(detectArticleLanguage('ระบบอัตโนมัติช่วยให้ทุกแผนกทำงานต่อกันได้ตั้งแต่ต้นจนจบ ด้วย CRM และ ERP') === 'th', 'เนื้อไทยปนศัพท์อังกฤษ = th')
  assert(detectArticleLanguage('OK') === null, 'ข้อความสั้นเกิน = ตัดสินไม่ได้')

  const enHtml = [
    '<h2>Why automation matters</h2>',
    '<p>Business process automation delivers zero latency across every department.</p>',
    '<p>Teams see results in weeks rather than months.</p>',
  ].join('\n')
  const enPlan = planRevision({
    title: 'What is Business Process Automation?',
    sourceHtml: enHtml,
    comments: [{ id: 'c1', text: 'ลดน้ำเสียงคำว่า zero latency ให้ดูไม่เกินจริง', quote: 'Business process automation delivers zero latency across every department.' }],
  })
  assert(enPlan.language === 'en', 'บทความอังกฤษในโปรเจกต์ใดก็ได้ = en (ดูจากเนื้อ)')
  assert(enPlan.user.includes('ลดน้ำเสียงคำว่า zero latency'), 'Comment ไทยส่งให้โมเดลตามเดิม')

  const enPrompt = buildReviseSystemPrompt({ language: 'th', articleLanguage: 'en' })
  assert(enPrompt.includes('บทความนี้เป็นภาษาอังกฤษ ข้อความทุกตัวใน html ที่ตอบต้องเป็นภาษาอังกฤษ'), 'prompt ล็อกภาษาของบทความ')
  assert(enPrompt.includes('ลูกค้าเขียน Comment ภาษาไทยสั่งแก้บทความภาษาอังกฤษ'), 'prompt บอกว่า Comment ไทยแก้บทความอังกฤษได้')
  assert(enPrompt.includes('Write like a knowledgeable person'), 'ภาษาบทความ en ชนะค่าตั้งโปรเจกต์ th ในกฎสำนวน')
  assert(enPrompt.includes('reason เขียนเป็นภาษาไทยเสมอ'), 'เหตุผลที่ทำไม่ได้เป็นภาษาไทย')
  assert(buildReviseSystemPrompt({}).includes('Comment อาจเขียนคนละภาษากับบทความ'), 'ไม่รู้ภาษา = ยังบอกให้เขียนภาษาของบทความ')

  const good = applyRevision(enPlan, JSON.stringify({
    edits: [{ op: 'replace', block: 2, comment: 1, html: '<p>Business process automation cuts delays across every department.</p>' }],
  }))
  assert(good.changed === 1 && !good.warnings.some((w) => w.includes('ภาษาไทย')), 'แก้เป็นอังกฤษ = ไม่เตือน')
  const leak = applyRevision(enPlan, JSON.stringify({
    edits: [{ op: 'replace', block: 2, comment: 1, html: '<p>Business process automation ลดความล่าช้า across every department.</p>' }],
  }))
  assert(leak.warnings.some((w) => w.includes('1 ท่อนมีข้อความภาษาไทย')), 'มีไทยหลุดในบทความอังกฤษ = เตือน')
  const thaiPlan = planRevision({ title: 'ระบบอัตโนมัติ', sourceHtml: '<p>ระบบอัตโนมัติช่วยให้ทุกแผนกทำงานต่อกันได้</p>', comments: [{ id: 'c1', text: 'แก้คำ' }] })
  const thai = applyRevision(thaiPlan, JSON.stringify({ edits: [{ op: 'replace', block: 1, comment: 1, html: '<p>ระบบอัตโนมัติช่วยทุกแผนก</p>' }] }))
  assert(thaiPlan.language === 'th' && !thai.warnings.some((w) => w.includes('ภาษาไทย')), 'บทความไทยไม่โดนเตือนเรื่องภาษา')
}

// ── บทความ import: ลูกค้าอนุมัติโครงแล้ว แก้แค่ตาม Comment ──
{
  const sys = buildReviseSystemPrompt({})
  assert(sys.includes('ลูกค้าอนุมัติบทความและโครงบทความนี้แล้ว'), 'prompt บอกว่าโครงเดิมลูกค้าอนุมัติแล้ว')
  assert(sys.includes('ห้ามเพิ่ม ลบ ย้าย หรือเปลี่ยนชื่อหัวข้อ'), 'prompt ห้ามเปลี่ยนหัวข้อ')
  assert(sys.includes('ประโยคอื่นในบล็อกเดียวกันต้องคงไว้ทุกตัวอักษร'), 'prompt ให้แก้เฉพาะประโยคที่ชี้')

  const many = Array.from({ length: 10 }, (_v, i) => `<p>ย่อหน้าที่ ${i + 1} ของบทความที่ลูกค้าอนุมัติแล้ว</p>`).join('')
  const p = planRevision({ title: 'ทดสอบ', sourceHtml: many, comments: [{ id: 'c1', text: 'แก้คำในย่อหน้า 2' }] })
  const one = applyRevision(p, JSON.stringify({ edits: [{ op: 'replace', block: 2, comment: 1, html: '<p>ย่อหน้าที่ 2 แก้แล้ว</p>' }] }))
  assert(!one.warnings.some((w) => w.includes('มากกว่าที่ Comment')), 'แก้ 1 บล็อกตาม Comment = ไม่เตือน')
  const wide = applyRevision(p, JSON.stringify({
    edits: [1, 2, 3, 4, 5, 6, 7].map((b) => ({ op: 'replace', block: b, comment: 1, html: `<p>เขียนใหม่ ${b}</p>` })),
  }))
  assert(wide.warnings.some((w) => w.includes('AI แก้ไป 7 จาก 10 บล็อก')), 'แก้กว้างเกิน Comment = เตือนให้ตรวจ/ย้อนกลับ')
}

console.log(`comment-revise: ${passed} passed`)
