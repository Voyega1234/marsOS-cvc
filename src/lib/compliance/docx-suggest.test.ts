/**
 * docx-suggest — Run: npx tsx src/lib/compliance/docx-suggest.test.ts
 */
import assert from 'node:assert/strict'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import {
  annotateDocumentXml, buildCommentsXml, docxBodyText, ensureCommentsPart, findingsToItems, plainDocxParts,
} from './docx-suggest'
import type { SuggestItem, XmlDom } from './docx-suggest'
import type { Finding } from './types'

const dom: XmlDom = {
  parse: (x) => {
    const errs: string[] = []
    const d = new DOMParser({ errorHandler: { warning: () => {}, error: (m: string) => errs.push(m), fatalError: (m: string) => errs.push(m) } }).parseFromString(x, 'application/xml') as unknown as Document
    if (errs.length) throw new Error('xml parse: ' + errs[0])
    return d
  },
  serialize: (d) => new XMLSerializer().serializeToString(d as any),
}
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

let n = 0
function t(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => { n++; console.log(`  ok ${name}`) })
}

const wrap = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
const r = (text: string, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`
const para = (...inner: string[]) => `<w:p>${inner.join('')}</w:p>`
const item = (over: Partial<SuggestItem> & { id: string }): SuggestItem => ({ quote: '', comment: 'c-' + over.id, ...over })

function annotate(xml: string, items: SuggestItem[], extra: { existingCommentsXml?: string | null } = {}) {
  return annotateDocumentXml(xml, items, { dom, date: '2026-11-16T10:00:00Z', ...extra })
}
function els(xml: string, name: string): Element[] {
  const d = dom.parse(xml)
  const nl = d.getElementsByTagNameNS(W, name)
  const out: Element[] = []
  for (let i = 0; i < nl.length; i++) out.push(nl.item(i) as Element)
  return out
}
function mutate(xml: string, fn: (d: Document) => void): string {
  const d = dom.parse(xml)
  fn(d)
  return dom.serialize(d)
}
function unwrap(el: Element) {
  const p = el.parentNode!
  while (el.firstChild) p.insertBefore(el.firstChild, el)
  p.removeChild(el)
}
function list(d: Document, name: string): Element[] {
  const nl = d.getElementsByTagNameNS(W, name)
  const out: Element[] = []
  for (let i = 0; i < nl.length; i++) out.push(nl.item(i) as Element)
  return out
}
function acceptAll(xml: string): string {
  return docxBodyText(mutate(xml, (d) => {
    list(d, 'del').forEach((e) => e.parentNode!.removeChild(e))
    list(d, 'ins').forEach(unwrap)
  }), dom)
}
function rejectAll(xml: string): string {
  return docxBodyText(mutate(xml, (d) => {
    list(d, 'ins').forEach((e) => e.parentNode!.removeChild(e))
    list(d, 'del').forEach(unwrap)
    list(d, 'delText').forEach((e) => {
      const t2 = d.createElementNS(W, 'w:t')
      t2.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
      t2.appendChild(d.createTextNode(e.textContent || ''))
      e.parentNode!.replaceChild(t2, e)
    })
  }), dom)
}
function check(xml: string, original: string, target: string, replacement: string) {
  assert.equal(rejectAll(xml), original)
  assert.equal(acceptAll(xml), original.replace(target, replacement))
  dom.parse(xml)
}

async function main() {
  await t('docxBodyText model', () => {
    const xml = wrap(
      para(r('ราย'), r('การ'), '<w:r><w:tab/><w:t>x</w:t><w:br/><w:t>y</w:t></w:r>') +
      '<w:tbl><w:tr><w:tc><w:p>' + r('cell1') + '</w:p></w:tc><w:tc><w:p>' + r('cell2') + '</w:p></w:tc></w:tr></w:tbl>' +
      para('<w:hyperlink>' + r('link') + '</w:hyperlink>') +
      para(r('keep'), '<w:del><w:r><w:delText>gone</w:delText></w:r></w:del>', '<w:ins>' + r('added') + '</w:ins>') +
      '<w:p/><w:p/>',
    )
    assert.equal(docxBodyText(xml, dom), 'รายการ\tx\ny\ncell1\ncell2\nlink\nkeepadded')
  })

  await t('replacement inside one run', () => {
    const xml = wrap(para(r('hello cheap world today')))
    const res = annotate(xml, [item({ id: 'a', quote: 'cheap', fixTarget: 'cheap', replacement: 'low-cost' })])
    assert.equal(res.changes, 1)
    check(res.xml, 'hello cheap world today', 'cheap', 'low-cost')
    assert.ok(res.xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'))
    assert.equal(res.xml.split('<?xml').length, 2)
  })

  await t('target across three runs, rPr of first kept on ins', () => {
    const xml = wrap(para(r('say gua'), r('ran', '<w:b/>'), r('teed now', '<w:i/>')))
    const res = annotate(xml, [item({ id: 'a', quote: 'guaranteed', fixTarget: 'guaranteed', replacement: 'expected' })])
    check(res.xml, 'say guaranteed now', 'guaranteed', 'expected')
    const ins = els(res.xml, 'ins')[0]
    assert.equal(els(res.xml, 'del').length, 3)
    assert.equal(ins.getElementsByTagNameNS(W, 'i').length, 0)
    assert.equal(ins.getElementsByTagNameNS(W, 'b').length, 0)
    // first covered run has no rPr (partial prefix kept) -> ins has none either
    const res2 = annotate(wrap(para(r('guaranteed ', '<w:b/>'), r('result'))), [item({ id: 'a', quote: 'guaranteed result', fixTarget: 'guaranteed result', replacement: 'x' })])
    assert.equal(els(res2.xml, 'ins')[0].getElementsByTagNameNS(W, 'b').length, 1)
  })

  await t('target partly inside hyperlink', () => {
    const xml = wrap(para(r('buy now '), '<w:hyperlink r:id="rId5" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + r('best price') + '</w:hyperlink>', r(' here')))
    const res = annotate(xml, [item({ id: 'a', quote: 'now best price', fixTarget: 'now best price', replacement: 'see price' })])
    assert.equal(res.changes, 1)
    check(res.xml, 'buy now best price here', 'now best price', 'see price')
    for (const d of els(res.xml, 'del')) {
      const ln = (d.parentNode as Element).localName
      assert.ok(ln === 'p' || ln === 'hyperlink', ln || '')
    }
  })

  await t('whitespace / zero-width / case tolerance', () => {
    const orig = 'ผล  100% การัน​ตี ได้แน่นอน'
    const xml = wrap(para(r(orig)))
    const res = annotate(xml, [item({ id: 'a', quote: 'ผล 100% การันตี', fixTarget: 'ผล 100% การันตี', replacement: 'ผลลัพธ์' })])
    assert.equal(res.changes, 1)
    assert.equal(rejectAll(res.xml), orig)
    assert.equal(acceptAll(res.xml), 'ผลลัพธ์ ได้แน่นอน')
    const ci = annotate(wrap(para(r('This is GUARANTEED ok'))), [item({ id: 'b', quote: 'guaranteed', fixTarget: 'guaranteed', replacement: 'likely' })])
    assert.equal(ci.changes, 1)
    assert.equal(acceptAll(ci.xml), 'This is likely ok')
  })

  await t('Thai text split across runs', () => {
    const xml = wrap(para(r('คลินิก'), r('รักษา'), r('หายขาด'), r(' 100% แน่นอน')))
    const res = annotate(xml, [item({ id: 'a', quote: 'รักษาหายขาด 100%', fixTarget: 'รักษาหายขาด 100%', replacement: 'ช่วยดูแล' })])
    assert.equal(res.changes, 1)
    check(res.xml, 'คลินิกรักษาหายขาด 100% แน่นอน', 'รักษาหายขาด 100%', 'ช่วยดูแล')
  })

  await t('same quote hits 1st and 2nd occurrence', () => {
    const xml = wrap(para(r('best deal. best deal again')))
    const res = annotate(xml, [
      item({ id: 'a', quote: 'best', fixTarget: 'best', replacement: 'good' }),
      item({ id: 'b', quote: 'best', fixTarget: 'best', replacement: 'fine' }),
    ])
    assert.equal(res.changes, 2)
    assert.equal(acceptAll(res.xml), 'good deal. fine deal again')
    assert.equal(rejectAll(res.xml), 'best deal. best deal again')
  })

  await t('overlap: sentence change + word comment', () => {
    const xml = wrap(para(r('Intro. We guarantee full results. Outro.')))
    const res = annotate(xml, [
      item({ id: 'a', quote: 'We guarantee full results.', fixTarget: 'We guarantee full results.', replacement: 'Results vary.' }),
      item({ id: 'b', quote: 'guarantee' }),
    ])
    assert.equal(res.changes, 1)
    assert.equal(els(res.xml, 'del').length, 1)
    assert.equal(els(res.xml, 'ins').length, 1)
    assert.equal(res.comments.length, 2)
    assert.equal(els(res.xml, 'commentRangeStart').length, 2)
    assert.equal(acceptAll(res.xml), 'Intro. Results vary. Outro.')
    assert.equal(rejectAll(res.xml), 'Intro. We guarantee full results. Outro.')
  })

  await t('overlap: two replacements -> one change, two comments', () => {
    const xml = wrap(para(r('This miracle cure works.')))
    const res = annotate(xml, [
      item({ id: 'a', quote: 'miracle cure', fixTarget: 'miracle cure', replacement: 'treatment' }),
      item({ id: 'b', quote: 'cure works', fixTarget: 'cure works', replacement: 'may help' }),
    ])
    assert.equal(res.changes, 1)
    assert.equal(res.comments.length, 2)
    assert.equal(acceptAll(res.xml), 'This treatment works.')
  })

  await t('comment-only item', () => {
    const xml = wrap(para(r('plain claim here')))
    const res = annotate(xml, [item({ id: 'a', quote: 'claim' })])
    assert.equal(res.changes, 0)
    assert.equal(els(res.xml, 'del').length + els(res.xml, 'ins').length, 0)
    const s = els(res.xml, 'commentRangeStart'), e = els(res.xml, 'commentRangeEnd'), f = els(res.xml, 'commentReference')
    assert.equal(s.length, 1); assert.equal(e.length, 1); assert.equal(f.length, 1)
    const id = s[0].getAttributeNS(W, 'id')
    assert.equal(e[0].getAttributeNS(W, 'id'), id)
    assert.equal(f[0].getAttributeNS(W, 'id'), id)
    assert.equal(docxBodyText(res.xml, dom), 'plain claim here')
    assert.deepEqual(res.placed, ['a'])
  })

  await t('unplaced item', () => {
    const xml = wrap(para(r('some text')))
    const res = annotate(xml, [item({ id: 'a', quote: 'not in document' }), item({ id: 'b', quote: 'text' })])
    assert.deepEqual(res.unplaced, ['a'])
    assert.deepEqual(res.placed, ['b'])
    assert.equal(res.comments.length, 2)
    assert.ok(res.comments.some((c) => c.text.startsWith('ตำแหน่งในไฟล์หาไม่เจอ 1 จุด')))
    assert.equal(docxBodyText(res.xml, dom), 'some text')
  })

  await t('run inside existing ins -> comment only', () => {
    const xml = wrap(para(r('keep '), '<w:ins w:id="2" w:author="x" w:date="d">' + r('risky claim') + '</w:ins>'))
    const res = annotate(xml, [item({ id: 'a', quote: 'risky claim', fixTarget: 'risky claim', replacement: 'safe' })])
    assert.equal(res.changes, 0)
    assert.equal(els(res.xml, 'del').length, 0)
    assert.equal(res.comments.length, 1)
    assert.equal(docxBodyText(res.xml, dom), 'keep risky claim')
  })

  await t('ids continue after existing ids; comments appended', () => {
    const xml = wrap(para('<w:commentRangeStart w:id="3"/>' + r('old note') + '<w:commentRangeEnd w:id="3"/><w:r><w:commentReference w:id="3"/></w:r>', '<w:ins w:id="7" w:author="x" w:date="d">' + r(' extra') + '</w:ins>', r(' cheap stuff')))
    const existing = `<w:comments xmlns:w="${W}"><w:comment w:id="3" w:author="a" w:date="d"><w:p><w:r><w:t>old</w:t></w:r></w:p></w:comment></w:comments>`
    const res = annotate(xml, [item({ id: 'a', quote: 'cheap', fixTarget: 'cheap', replacement: 'low-cost' })], { existingCommentsXml: existing })
    assert.ok(res.comments[0].id > 3)
    const newIns = els(res.xml, 'ins').filter((e) => e.getAttributeNS(W, 'id') !== '7')
    assert.equal(newIns.length, 1)
    for (const e of [...els(res.xml, 'del'), ...newIns]) assert.ok(Number(e.getAttributeNS(W, 'id')) > 7)
    const cx = buildCommentsXml(existing, res.comments, { dom, author: 'A', date: '2026-11-16T10:00:00Z' })
    assert.equal(els(cx, 'comment').length, 2)
    assert.ok(cx.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'))
    assert.equal(els(cx, 'comment')[0].getAttributeNS(W, 'id'), '3')
  })

  await t('ensureCommentsPart', () => {
    const ct = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'
    const rels = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="a.xml"/><Relationship Id="rId4" Type="y" Target="b.xml"/></Relationships>'
    const a = ensureCommentsPart(ct, rels, dom)
    assert.equal(a.target, 'word/comments.xml')
    assert.ok(a.rels.includes('rId5'))
    assert.equal(a.contentTypes.split('/word/comments.xml').length, 2)
    const b = ensureCommentsPart(a.contentTypes, a.rels, dom)
    assert.equal(b.contentTypes, a.contentTypes)
    assert.equal(b.rels, a.rels)
    assert.equal(b.target, 'word/comments.xml')
    const c = ensureCommentsPart(ct, '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="/word/cmts.xml"/></Relationships>', dom)
    assert.equal(c.target, 'word/cmts.xml')
    assert.equal(c.contentTypes, ct)
    const d = ensureCommentsPart(ct, null, dom)
    assert.ok(d.rels.includes('rId1'))
  })

  await t('findingsToItems', () => {
    const base: Finding = {
      id: 'f1', ruleId: 'r', ruleVersion: 1, ruleCode: 'BC-1', ruleTitle: 'การันตี', severity: 'HIGH', origin: 'ai', term: 't',
      quote: 'q', excerpt: 'e', reason: 'เหตุ', suggestion: 'แนะนำ', verdict: 'violation', sourceName: 'อย.', sourceRef: 'ข้อ 1', sourceUrl: '',
    }
    const items = findingsToItems([
      base,
      { ...base, id: 'f2', verdict: 'likely_ok' },
      { ...base, id: 'f3', origin: 'rule', fixTarget: 'a', replacement: 'b' },
    ])
    assert.equal(items.length, 2)
    assert.ok(!items[0].comment.includes('ข้อความที่เสนอ'))
    assert.ok(items[0].comment.includes('· AI'))
    assert.ok(items[1].comment.includes('ข้อความที่เสนอ: b'))
    assert.ok(items[1].comment.includes('อ้างอิง: อย. ข้อ 1'))
  })

  await t('plainDocxParts escapes + round trip', () => {
    const parts = plainDocxParts('T <1>', 'a & b\u0001c\n\nline\tx')
    assert.ok(!parts['word/document.xml'].includes('\u0001'))
    assert.equal(docxBodyText(parts['word/document.xml'], dom), 'T <1>\na & bc\n\nline\tx')
    for (const k of Object.keys(parts)) dom.parse(parts[k])
  })

  await t('newline in replacement -> w:br', () => {
    const res = annotate(wrap(para(r('one two three'))), [item({ id: 'a', quote: 'two', fixTarget: 'two', replacement: 'x\ny' })])
    const ins = els(res.xml, 'ins')[0]
    assert.equal(ins.getElementsByTagNameNS(W, 'br').length, 1)
    assert.equal(acceptAll(res.xml), 'one x\ny three')
  })

  await t('full round trip with jszip + mammoth', async () => {
    const parts = plainDocxParts('Title', 'We guarantee results for you.\nSecond line.')
    const zip = new JSZip()
    for (const k of Object.keys(parts)) zip.file(k, parts[k])
    const buf0 = await zip.generateAsync({ type: 'nodebuffer' })
    const z = await JSZip.loadAsync(buf0)
    const docXml = await z.file('word/document.xml')!.async('string')
    const res = annotate(docXml, findingsToItems([{
      id: 'f', ruleId: 'r', ruleVersion: 1, ruleCode: 'X-1', ruleTitle: 'T', severity: 'HIGH', origin: 'rule', term: 't',
      quote: 'guarantee results', excerpt: '', reason: 'r', suggestion: 's', verdict: 'violation', sourceName: '', sourceRef: '', sourceUrl: '',
      fixTarget: 'guarantee results', replacement: 'aim for good results',
    }]))
    const cp = ensureCommentsPart(await z.file('[Content_Types].xml')!.async('string'), await z.file('word/_rels/document.xml.rels')!.async('string'), dom)
    z.file('word/document.xml', res.xml)
    z.file(cp.target, buildCommentsXml(null, res.comments, { dom, author: 'MarsOS Compliance', date: '2026-11-16T10:00:00Z' }))
    z.file('[Content_Types].xml', cp.contentTypes)
    z.file('word/_rels/document.xml.rels', cp.rels)
    const buf = await z.generateAsync({ type: 'nodebuffer' })
    const z2 = await JSZip.loadAsync(buf)
    for (const name of Object.keys(z2.files)) {
      if (name.endsWith('.xml') || name.endsWith('.rels')) dom.parse(await z2.file(name)!.async('string'))
    }
    assert.ok(z2.file('word/comments.xml'))
    const out = await mammoth.extractRawText({ buffer: buf })
    assert.ok(out.value.includes('aim for good results'), out.value)
  })

  await t('control characters and half surrogates never reach the XML', () => {
    const bad = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    const xml = wrap(para(r('hello cheap world')))
    const res = annotate(xml, [item({ id: 'a', quote: 'cheap', fixTarget: 'cheap', replacement: 'low\u0001-cost\u000Bnext \uD83D', comment: 'note\u0000 one\u000Ctwo \uDE00' })])
    assert.equal(res.changes, 1)
    assert.ok(!bad.test(res.xml), 'document.xml clean')
    const ins = els(res.xml, 'ins')[0]
    assert.equal(ins.getElementsByTagNameNS(W, 'br').length, 1)
    assert.equal(ins.textContent, 'low-costnext ')
    const cx = buildCommentsXml(null, res.comments, { dom, author: 'Mars\u0002OS', date: '2026-11-16T10:00:00Z' })
    assert.ok(!bad.test(cx), 'comments.xml clean')
    dom.parse(cx)
    assert.equal(rejectAll(res.xml), 'hello cheap world')
  })

  await t('target is taken where its quote is, not at its first occurrence', () => {
    const xml = wrap(para(r('we guarantee results.')) + para(r('we guarantee results.')))
    const res = annotate(xml, [
      item({ id: 'a', quote: 'guarantee' }),
      item({ id: 'b', quote: 'guarantee', fixTarget: 'we guarantee results', replacement: 'we aim for results' }),
    ])
    assert.equal(res.changes, 1)
    assert.equal(res.unplaced.length, 0)
    const paras = els(res.xml, 'p')
    assert.equal(paras[0].getElementsByTagNameNS(W, 'del').length, 0, 'first paragraph keeps its text')
    assert.equal(paras[0].getElementsByTagNameNS(W, 'commentRangeStart').length, 1)
    assert.ok(paras[1].getElementsByTagNameNS(W, 'del').length > 0, 'change is in the second paragraph')
    assert.equal(acceptAll(res.xml), 'we guarantee results.\nwe aim for results.')
    assert.equal(rejectAll(res.xml), 'we guarantee results.\nwe guarantee results.')
  })

  await t('a comment that bridges two replacements does not merge them', () => {
    const xml = wrap(para(r('aaa bbb ccc ddd eee')))
    const res = annotate(xml, [
      item({ id: 'a', quote: 'aaa bbb', fixTarget: 'aaa bbb', replacement: 'X' }),
      item({ id: 'b', quote: 'bbb ccc ddd' }),
      item({ id: 'c', quote: 'ddd eee', fixTarget: 'ddd eee', replacement: 'Y' }),
    ])
    assert.equal(res.changes, 2)
    assert.equal(res.comments.length, 3)
    assert.equal(res.unplaced.length, 0)
    assert.equal(acceptAll(res.xml), 'X ccc Y')
    assert.equal(rejectAll(res.xml), 'aaa bbb ccc ddd eee')
    assert.equal(els(res.xml, 'commentRangeStart').length, els(res.xml, 'commentRangeEnd').length)
    assert.equal(els(res.xml, 'commentReference').length, 3)
  })

  await t('text box fallback copy is neither read nor edited', () => {
    const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
    const box = '<w:txbxContent>' + para(r('box cheap offer')) + '</w:txbxContent>'
    const xml = wrap(
      para(r('outer text'), `<w:r><mc:AlternateContent xmlns:mc="${MC}"><mc:Choice Requires="wps">${box}</mc:Choice><mc:Fallback>${box}</mc:Fallback></mc:AlternateContent></w:r>`),
    )
    assert.equal(docxBodyText(xml, dom).split('box cheap offer').length - 1, 1, 'read once')
    const res = annotate(xml, [item({ id: 'a', quote: 'cheap', fixTarget: 'cheap', replacement: 'fair' })])
    assert.equal(res.changes, 1)
    const d = dom.parse(res.xml)
    const fb = d.getElementsByTagNameNS(MC, 'Fallback').item(0) as Element
    assert.equal(fb.getElementsByTagNameNS(W, 'del').length, 0)
    assert.equal(fb.getElementsByTagNameNS(W, 'ins').length, 0)
    assert.equal(fb.textContent, 'box cheap offer')
    const ch = d.getElementsByTagNameNS(MC, 'Choice').item(0) as Element
    assert.equal(ch.getElementsByTagNameNS(W, 'ins').length, 1)
  })

  await t('revision ids stay unique next to bookmarks and format changes', () => {
    const rPr = '<w:b/><w:rPrChange w:id="7" w:author="A" w:date="2026-01-01T00:00:00Z"><w:rPr/></w:rPrChange>'
    const xml = wrap(para('<w:bookmarkStart w:id="50" w:name="x"/>', r('hello cheap world', rPr), '<w:bookmarkEnd w:id="50"/>'))
    const res = annotate(xml, [item({ id: 'a', quote: 'cheap', fixTarget: 'cheap', replacement: 'fair' })])
    assert.equal(res.changes, 1)
    const rev = ['ins', 'del', 'rPrChange'].flatMap((nm) => els(res.xml, nm)).map((e) => e.getAttributeNS(W, 'id'))
    assert.equal(new Set(rev).size, rev.length, 'unique: ' + rev.join(','))
    assert.equal(els(res.xml, 'rPrChange').length, 3, 'one per piece of the split run')
    for (const e of ['ins', 'del'].flatMap((nm) => els(res.xml, nm))) assert.ok(Number(e.getAttributeNS(W, 'id')) > 50)
    assert.equal(els(res.xml, 'ins')[0].getElementsByTagNameNS(W, 'rPrChange').length, 0, 'inserted text carries no format change')
    assert.equal(els(res.xml, 'ins')[0].getElementsByTagNameNS(W, 'b').length, 1)
    assert.equal(rejectAll(res.xml), 'hello cheap world')
  })

  await t('summary comment for unplaced items avoids pending insertions', () => {
    const xml = wrap(para('<w:ins w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z">' + r('added ') + '</w:ins>', r('normal text')))
    const res = annotate(xml, [item({ id: 'a', quote: 'not in the file at all' })])
    assert.equal(res.unplaced.length, 1)
    assert.equal(res.comments.length, 1)
    assert.equal(res.paragraphs, 1)
    for (const nm of ['commentRangeStart', 'commentRangeEnd', 'commentReference']) {
      const e = els(res.xml, nm)[0]
      assert.ok(e, nm)
      for (let c = e.parentNode as Element | null; c; c = c.parentNode as Element | null) assert.notEqual(c.localName, 'ins', nm + ' inside w:ins')
    }
  })

  await t('a file with no readable paragraphs reports zero paragraphs and no comments', () => {
    const strict = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main"><w:body><w:p><w:r><w:t>hello cheap world</w:t></w:r></w:p></w:body></w:document>'
    const res = annotate(strict, [item({ id: 'a', quote: 'cheap', fixTarget: 'cheap', replacement: 'fair' })])
    assert.equal(res.paragraphs, 0)
    assert.equal(res.comments.length, 0)
    assert.equal(res.changes, 0)
  })

  console.log(`${n} passed`)
}

main().catch((e) => { console.error(e); process.exit(1) })
