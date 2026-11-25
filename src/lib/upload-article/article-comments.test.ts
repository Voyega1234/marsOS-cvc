// รัน: npx tsx src/lib/upload-article/article-comments.test.ts
import { Document, Packer, Paragraph, TextRun, CommentRangeStart, CommentRangeEnd, CommentReference, HeadingLevel } from 'docx'
import {
  ARTICLE_COMMENTS_KEY, MAX_COMMENT_CHARS, MAX_COMMENTS_PER_ARTICLE, MAX_COMMENT_TOTAL_CHARS, MAX_QUOTE_CHARS,
  articleCommentCounts, extractGoogleDocsComments, extractMammothComments, extractTextComments, isPendingComment,
  manualComment, readArticleComments, sanitizeArticleComments, toImportedComments, withArticleComments,
  MAX_CHANGE_CHARS, MAX_CHANGE_CONTEXT_CHARS, MAX_CHANGE_TOTAL_CHARS, MAX_CHANGES_PER_COMMENT,
  describeChange, keepStoredChanges, setCommentChanges,
  type ArticleComment,
} from './article-comments'
import { importFromFile, importFromText } from './import-source'

let passed = 0
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
}
const eq = (a: unknown, b: unknown, msg: string) =>
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`)

const NOW = '2026-11-01T00:00:00.000Z'
const mk = (o: Partial<ArticleComment> & { text: string }): ArticleComment => ({
  id: 'x1', source: 'manual', createdAt: NOW, enabled: true, ...o,
})

async function main() {
  // ── 1. Google Docs HTML ──
  {
    const html = [
      '<html><body>',
      '<p>ย่อหน้าแรกของบทความ<sup><a href="#cmnt1" id="cmnt_ref1">[a]</a></sup></p>',
      '<p>ย่อหน้าที่สอง ราคาเริ่มต้น<sup><a href="#cmnt2" id="cmnt_ref2">[b]</a></sup></p>',
      '<div><p><a href="#cmnt_ref1" id="cmnt1">[a]</a><span>เปลี่ยนคำว่า รักษา</span></p></div>',
      '<div><p><a href="#cmnt_ref2" id="cmnt2">[b]</a><span>ใส่ราคา 990 บาท</span></p></div>',
      '</body></html>',
    ].join('')
    const c = extractGoogleDocsComments(html)
    assert(c.length === 2, 'gdocs: พบ 2 comment')
    eq(c[0].text, 'เปลี่ยนคำว่า รักษา', 'gdocs: ข้อความ comment แรก')
    eq(c[1].text, 'ใส่ราคา 990 บาท', 'gdocs: ข้อความ comment สอง')
    eq(c[0].quote, 'ย่อหน้าแรกของบทความ', 'gdocs: quote แรก ไม่มี [a]')
    eq(c[1].quote, 'ย่อหน้าที่สอง ราคาเริ่มต้น', 'gdocs: quote สอง ไม่มี [b]')
    eq(extractGoogleDocsComments('<p>ไม่มี comment</p>'), [], 'gdocs: ไม่มี comment = []')
    eq(extractGoogleDocsComments(''), [], 'gdocs: ว่าง = []')
  }

  // ── 2. text ──
  {
    const txt = ['หัวข้อ', 'ย่อหน้าแรก[a] ต่อท้าย', 'ย่อหน้าสอง[b]', '', '[a]แก้คำนี้', '[b]เพิ่มราคา'].join('\n')
    const c = extractTextComments(txt)
    assert(c.length === 2, 'text: พบ 2 comment')
    eq(c.map((x) => x.text), ['แก้คำนี้', 'เพิ่มราคา'], 'text: ข้อความ comment')
    eq(c[0].quote, 'ย่อหน้าแรก ต่อท้าย', 'text: quote แรก')
    eq(c[1].quote, 'ย่อหน้าสอง', 'text: quote สอง')
    eq(extractTextComments('ข้อความธรรมดา [อ้างอิง] ไม่มี marker\nบรรทัดสอง'), [], 'text: ไม่มี marker = []')
    const imp = importFromText(txt)
    assert(imp.comments?.length === 2, 'importFromText: ได้ comments 2 รายการ')
    assert(!imp.html.includes('[a]') && !imp.html.includes('แก้คำนี้'), 'importFromText: html ไม่มี marker/ข้อความ comment')
  }

  // ── 3. mammoth shape ──
  {
    const html = [
      '<h1>หัวข้อ</h1>',
      '<p>ย่อหน้าแรก <sup><a href="#comment-0" id="comment-ref-0">[SK1]</a></sup></p>',
      '<p>ย่อหน้าสอง<sup><a href="#comment-1" id="comment-ref-1">[SK2]</a></sup></p>',
      '<dl><dt id="comment-0">Comment [SK1]</dt><dd><p>เปลี่ยนคำ <a href="#comment-ref-0">↑</a></p></dd>',
      '<dt id="comment-1">Comment [SK2]</dt><dd><p>บรรทัดหนึ่ง</p><p>บรรทัดสอง <a href="#comment-ref-1">↑</a></p></dd></dl>',
    ].join('')
    const c = extractMammothComments(html)
    assert(c.length === 2, 'mammoth: พบ 2 comment')
    eq(c[0].text, 'เปลี่ยนคำ', 'mammoth: ข้อความแรก (ตัดลูกศรย้อน)')
    eq(c[1].text, 'บรรทัดหนึ่ง\nบรรทัดสอง', 'mammoth: ข้อความหลายย่อหน้าคั่น \\n')
    eq(c[0].quote, 'ย่อหน้าแรก', 'mammoth: quote แรก')
    eq(c[1].quote, 'ย่อหน้าสอง', 'mammoth: quote สอง')
    eq(extractMammothComments('<p>ไม่มี</p>'), [], 'mammoth: ไม่มี comment = []')
  }

  // ── 4. .docx end to end ──
  {
    const build = async (withComments: boolean) => {
      const ref = (id: number) => (withComments ? [new TextRun({ children: [new CommentReference(id)] })] : [])
      const start = (id: number) => (withComments ? [new CommentRangeStart(id)] : [])
      const end = (id: number) => (withComments ? [new CommentRangeEnd(id)] : [])
      const doc = new Document({
        ...(withComments ? {
          comments: { children: [
            { id: 0, author: 'Somchai K', initials: 'SK', date: new Date('2026-11-01'), children: [new Paragraph({ children: [new TextRun('เปลี่ยนคำว่า รักษา เป็น ดูแล')] })] },
            { id: 1, author: 'Somchai K', initials: 'SK', date: new Date('2026-11-01'), children: [new Paragraph({ children: [new TextRun('เพิ่มราคาเริ่มต้น 990 บาท')] })] },
          ] },
        } : {}),
        sections: [{ children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('หัวข้อหลัก')] }),
          new Paragraph({ children: [new TextRun('ย่อหน้าแรก '), ...start(0), new TextRun('คลินิกรักษาฟัน'), ...end(0), ...ref(0), new TextRun(' ต่อท้าย')] }),
          new Paragraph({ children: [...start(1), new TextRun('ย่อหน้าสอง ราคา'), ...end(1), ...ref(1)] }),
        ] }],
      })
      return Buffer.from(await Packer.toBuffer(doc))
    }
    const withC = await importFromFile('with.docx', await build(true))
    const without = await importFromFile('without.docx', await build(false))
    assert(withC.comments?.length === 2, 'docx: ได้ 2 comment')
    eq(withC.comments?.map((c) => c.text), ['เปลี่ยนคำว่า รักษา เป็น ดูแล', 'เพิ่มราคาเริ่มต้น 990 บาท'], 'docx: ข้อความ comment')
    assert(withC.comments!.every((c) => !!c.quote && c.quote.length > 0), 'docx: ทุก comment มี quote ไม่ว่าง')
    assert(withC.comments![0].quote!.includes('คลินิกรักษาฟัน'), 'docx: quote แรกมีข้อความที่ถูก comment')
    assert(!withC.html.includes('เปลี่ยนคำว่า') && !withC.html.includes('เพิ่มราคาเริ่มต้น'), 'docx: html ไม่มีข้อความ comment')
    assert(!/\[[A-Za-z]{1,4}\d*\]/.test(withC.html), 'docx: html ไม่มี marker แบบ [a]/[SK1]')
    assert(!without.comments || without.comments.length === 0, 'docx ไม่มี comment: comments ว่างหรือ undefined')
    eq(withC.html, without.html, 'docx: comment ไม่เปลี่ยนเนื้อหา body ที่นำเข้า')
  }

  // ── 5. toImportedComments ──
  {
    const list = toImportedComments([{ text: 'a', quote: 'q' }, { text: 'b' }, { text: 'c' }])
    assert(list.length === 3, 'toImported: ครบ 3')
    assert(list.every((c) => c.source === 'import' && c.enabled === true && c.appliedAt === undefined), 'toImported: source import, enabled, ไม่มี appliedAt')
    assert(new Set(list.map((c) => c.id)).size === 3, 'toImported: id ไม่ซ้ำ')
    assert(list.every((c) => /^[\w-]{1,64}$/.test(c.id)), 'toImported: id ตรง pattern')
    eq(list[0].quote, 'q', 'toImported: เก็บ quote')
  }

  // ── 6. manualComment ──
  {
    const m = manualComment('  สวัสดี  ')
    assert(m?.text === 'สวัสดี' && m.source === 'manual' && m.enabled === true, 'manual: trim + source manual')
    assert(manualComment('') === null, 'manual: ว่าง = null')
    assert(manualComment('  \n\t ') === null, 'manual: ช่องว่างล้วน = null')
    assert(manualComment('ก'.repeat(MAX_COMMENT_CHARS + 500))!.text.length === MAX_COMMENT_CHARS, 'manual: clip ที่ MAX_COMMENT_CHARS')
  }

  // ── 7. sanitize ──
  {
    eq(sanitizeArticleComments('x'), [], 'sanitize: string = []')
    eq(sanitizeArticleComments(null), [], 'sanitize: null = []')
    eq(sanitizeArticleComments({}), [], 'sanitize: object = []')
    const s = sanitizeArticleComments([{ id: 'a1', text: 'ok' }, { id: 'a2' }, { id: 'a3', text: '   ' }, null, 5])
    assert(s.length === 1 && s[0].id === 'a1', 'sanitize: ตัดรายการที่ไม่มี text/ไม่ใช่ object')
    const bad = sanitizeArticleComments([{ id: 'bad id!', text: 'x' }])
    assert(bad.length === 1 && bad[0].id !== 'bad id!' && /^[\w-]{1,64}$/.test(bad[0].id), 'sanitize: id ไม่ถูกต้องถูกแทนใหม่')
    const dup = sanitizeArticleComments([{ id: 'd', text: 'one' }, { id: 'd', text: 'two' }])
    assert(dup.length === 1 && dup[0].text === 'one', 'sanitize: id ซ้ำถูกตัด')
    const many = sanitizeArticleComments(Array.from({ length: 80 }, (_, i) => ({ id: `i${i}`, text: 't' })))
    assert(many.length === MAX_COMMENTS_PER_ARTICLE, 'sanitize: เพดานจำนวน comment')
    const big = sanitizeArticleComments(Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, text: 'ก'.repeat(MAX_COMMENT_CHARS) })))
    const sum = big.reduce((n, c) => n + c.text.length, 0)
    assert(sum <= MAX_COMMENT_TOTAL_CHARS && big.length === Math.floor(MAX_COMMENT_TOTAL_CHARS / MAX_COMMENT_CHARS), `sanitize: หยุดที่ MAX_COMMENT_TOTAL_CHARS (ได้ ${big.length} รายการ)`)
    const q = sanitizeArticleComments([{ id: 'q', text: 't', quote: 'ข'.repeat(MAX_QUOTE_CHARS + 100) }])
    assert(q[0].quote!.length === MAX_QUOTE_CHARS, 'sanitize: clip quote ที่ MAX_QUOTE_CHARS')
    const ap = sanitizeArticleComments([{ id: 'p1', text: 't', appliedAt: NOW }, { id: 'p2', text: 't', appliedAt: 'not a date' }])
    assert(ap[0].appliedAt === NOW, 'sanitize: เก็บ appliedAt ที่ถูกต้อง')
    assert(ap[1].appliedAt === undefined && !('appliedAt' in ap[1]), 'sanitize: ทิ้ง appliedAt ที่ไม่ถูกต้อง')
    assert(sanitizeArticleComments([{ id: 'e', text: 't', enabled: false }])[0].enabled === false, 'sanitize: enabled false คงไว้')
  }

  // ── 8. with/read round trip ──
  {
    const prefs = { theme: 'dark', [ARTICLE_COMMENTS_KEY]: { other: [mk({ id: 'o1', text: 'อื่น' })] } }
    const snapshot = JSON.stringify(prefs)
    const next = withArticleComments(prefs, 'art1', [mk({ id: 'n1', text: 'ใหม่' })])
    assert(JSON.stringify(prefs) === snapshot, 'with: ไม่ mutate prefs เดิม')
    eq(readArticleComments(next, 'art1').map((c) => c.text), ['ใหม่'], 'round trip: อ่านกลับได้')
    eq(readArticleComments(next, 'other').map((c) => c.text), ['อื่น'], 'round trip: comment บทความอื่นไม่ถูกแตะ')
    assert(next.theme === 'dark', 'round trip: key อื่นของ prefs ไม่ถูกแตะ')
    const cleared = withArticleComments(next, 'art1', [])
    assert(!('art1' in (cleared[ARTICLE_COMMENTS_KEY] as object)), 'เขียนรายการว่าง = ลบ key ของบทความนั้นทิ้ง')
    assert(readArticleComments(cleared, 'other').length === 1, 'เขียนรายการว่าง: บทความอื่นยังอยู่')
    const last = withArticleComments({ theme: 'x', [ARTICLE_COMMENTS_KEY]: { only: [mk({ text: 'a' })] } }, 'only', [])
    assert(!(ARTICLE_COMMENTS_KEY in last) && last.theme === 'x', 'เขียนรายการว่างของบทความสุดท้าย = ลบ articleComments ทั้ง key')
    eq(readArticleComments(null, 'x'), [], 'read: prefs null = []')
  }

  // ── 9. pending + counts ──
  {
    const prefs = withArticleComments({}, 'a', [
      mk({ id: 'c1', text: 'ปิด', enabled: false }),
      mk({ id: 'c2', text: 'ปรับแล้ว', appliedAt: NOW }),
      mk({ id: 'c3', text: 'รอ' }),
    ])
    eq(articleCommentCounts(prefs), { a: { total: 3, pending: 1 } }, 'counts: total 3 pending 1')
    assert(isPendingComment(mk({ text: 'x' })) && !isPendingComment(mk({ text: 'x', enabled: false })) && !isPendingComment(mk({ text: 'x', appliedAt: NOW })), 'isPending: เงื่อนไข')
    eq(articleCommentCounts({}), {}, 'counts: ไม่มี comment = {}')
  }

  // ── บันทึกว่า AI แก้อะไรไป (การ์ดใต้ Comment) ──
  {
    const before = 'Automation handles recurring routines, eliminating the need for human intervention across departments.'
    const after = 'Automation handles recurring routines, reducing manual work and human intervention in recurring routines while preserving human approval or review where needed across departments.'
    const ch = describeChange('replace', before, after)
    eq(ch.kind, 'replace', 'แก้วลี = replace')
    assert(!!ch.before && ch.before.includes('eliminating the need for') && !ch.before.includes('Automation'), `เดิม = เฉพาะท่อนที่ถูกแก้ (${ch.before})`)
    assert(!!ch.after && ch.after.startsWith('reducing manual work') && !ch.after.includes('Automation'), `ใหม่ = เฉพาะท่อนที่ถูกแก้ (${ch.after})`)
    assert(!!ch.lead && ch.lead.endsWith('routines, '), `lead = ข้อความก่อนหน้าที่ไม่ได้แก้ (${JSON.stringify(ch.lead)})`)
    assert(!!ch.tail && ch.tail.trim().endsWith('departments.'), `tail = ข้อความต่อท้ายที่ไม่ได้แก้ (${JSON.stringify(ch.tail)})`)
    const longLead = describeChange('replace', `${'word '.repeat(60)}old end`, `${'word '.repeat(60)}new end`)
    assert((longLead.lead ?? '').length <= MAX_CHANGE_CONTEXT_CHARS && (longLead.lead ?? '').startsWith('…'), 'lead ยาว = ตัดด้านหน้า เติม …')
    eq([longLead.before, longLead.after], ['old', 'new'], 'ข้อความรอบ ๆ ยาว ยังได้ท่อนที่แก้ถูก')

    const thai = describeChange('replace', 'ราคาเริ่มต้น 5,000 บาท ต่อครั้ง', 'ราคาเริ่มต้น 4,500 บาท ต่อครั้ง')
    eq([thai.before, thai.after], ['5,000', '4,500'], 'ภาษาไทย: ได้เฉพาะคำที่เปลี่ยน')

    const whole = describeChange('replace', 'ข้อความเก่าทั้งย่อหน้า', 'Completely different text')
    assert(!whole.lead && !whole.tail && whole.before === 'ข้อความเก่าทั้งย่อหน้า', 'เขียนใหม่ทั้งบล็อก = ไม่มี lead/tail')
    const long = describeChange('replace', 'ก'.repeat(50), 'x '.repeat(600))
    assert((long.after ?? '').length <= MAX_CHANGE_CHARS && (long.after ?? '').endsWith('…'), 'ข้อความใหม่ยาว = ตัดที่เพดาน เติม …')

    eq(describeChange('replace', 'same  text', 'same text'), { kind: 'format', after: 'same text' }, 'ข้อความเท่าเดิม = format')
    eq(describeChange('insert', '', 'ย่อหน้าใหม่'), { kind: 'insert', after: 'ย่อหน้าใหม่' }, 'insert มีแต่ข้อความใหม่')
    eq(describeChange('delete', 'ย่อหน้าที่ลบ', ''), { kind: 'delete', before: 'ย่อหน้าที่ลบ' }, 'delete มีแต่ข้อความเดิม')
    eq(describeChange('delete', '', ''), { kind: 'delete' }, 'ลบบล็อกที่ไม่มีข้อความ (รูป)')
    const added = describeChange('replace', 'ประโยคเดิม', 'ประโยคเดิม และเพิ่มท่อนใหม่')
    assert(!added.before && !!added.after && added.lead === 'ประโยคเดิม ', `เพิ่มต่อท้ายในบล็อกเดิม = ไม่มี "เดิม" (${JSON.stringify(added)})`)

    // sanitiser เก็บ changes ที่ถูกรูป ทิ้งของแปลก
    const withChanges = sanitizeArticleComments([{
      ...mk({ text: 'แก้คำ', appliedAt: NOW }),
      changes: [ch, { kind: 'hack', before: 'x' }, 'bad', { kind: 'delete', before: 'ลบ', extra: 1 }],
      moreChanges: 2,
    }])
    eq(withChanges[0].changes?.length, 2, 'changes ที่ kind ไม่รู้จัก/ไม่ใช่ object ถูกทิ้ง')
    eq(withChanges[0].changes?.[0], ch, 'change ที่ถูกรูปผ่าน sanitiser ได้ค่าเดิม (รวมช่องว่างที่ขอบ lead/tail)')
    eq(withChanges[0].changes?.[1], { kind: 'delete', before: 'ลบ' }, 'field แปลกใน change ถูกตัด')
    eq(withChanges[0].moreChanges, 2, 'moreChanges คงไว้')
    eq(sanitizeArticleComments(sanitizeArticleComments(withChanges)), withChanges, 'sanitise ซ้ำได้ค่าเดิม')
    const noChanges = sanitizeArticleComments([{ ...mk({ text: 'ไม่มี' }), changes: [], moreChanges: 5 }])
    assert(!('changes' in noChanges[0]) && !('moreChanges' in noChanges[0]), 'ไม่มี change = ไม่มี field (comment เก่าได้รูปเดิม)')
    const many = sanitizeArticleComments([{ ...mk({ text: 'เยอะ' }), changes: Array.from({ length: 12 }, () => ({ kind: 'insert', after: 'a' })) }])
    eq(many[0].changes?.length, MAX_CHANGES_PER_COMMENT, 'changes ต่อ comment ไม่เกินเพดาน')
    const heavy = sanitizeArticleComments(Array.from({ length: 30 }, (_v, i) => ({
      ...mk({ text: `c${i}` }), id: `h${i}`,
      changes: Array.from({ length: 5 }, () => ({ kind: 'replace', before: 'ก'.repeat(400), after: 'ข'.repeat(400) })),
    })))
    const heavyChars = heavy.reduce((n, c) => n + (c.changes ?? []).reduce((m, x) => m + (x.before ?? '').length + (x.after ?? '').length, 0), 0)
    assert(heavyChars <= MAX_CHANGE_TOTAL_CHARS && heavy.length === 30, `บันทึกรวมไม่เกินเพดาน แต่ comment อยู่ครบ (${heavyChars})`)

    // PUT จากหน้าจอ: changes ใช้ของที่เก็บไว้เสมอ
    const storedList = [setCommentChanges(mk({ text: 'หนึ่ง', appliedAt: NOW }), [ch], 0), mk({ text: 'สอง' })]
    storedList[0].id = 's1'; storedList[1].id = 's2'
    const fromScreen: ArticleComment[] = [
      { ...mk({ text: 'หนึ่ง' }), id: 's1', enabled: true },
      { ...mk({ text: 'สอง' }), id: 's2', changes: [{ kind: 'insert', after: 'แต่งเอง' }] },
      { ...mk({ text: 'ใหม่' }), id: 's3' },
    ]
    const kept = keepStoredChanges(fromScreen, storedList)
    eq(kept[0].changes, [ch], 'หน้าจอเก่าไม่ส่ง changes มา = ของที่เก็บไว้ยังอยู่ (กด "ใช้อีกครั้ง" แล้วการ์ดไม่หาย)')
    assert(!kept[0].appliedAt, 'ค่าอื่นใช้ของที่หน้าจอส่งมา')
    assert(!('changes' in kept[1]), 'changes ที่หน้าจอแต่งมาเองถูกทิ้ง')
    assert(!('changes' in kept[2]), 'comment ใหม่ไม่มี changes')
    eq(keepStoredChanges([], storedList), [], 'ลบ comment = หายไปพร้อมบันทึก')
    assert(!('changes' in setCommentChanges(storedList[0], [])), 'setCommentChanges รายการว่าง = ลบบันทึก')
    eq(setCommentChanges(mk({ text: 'x' }), Array.from({ length: 8 }, () => ch), 3).moreChanges, 3, 'setCommentChanges เก็บจำนวนที่เกิน')
  }

  console.log(`article-comments: ${passed} passed`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
