/**
 * Compliance AI rule fill (pure functions) — Run: npx tsx src/lib/compliance/rule-fill.test.ts
 */
import {
  FILL_MAX_RULES, buildFillUserPrompt, capSourceText, decodeHtmlBytes, isPdfBytes, linkLabel, nextRuleCode,
  refAppearsIn, sanitizeFill, yearAppearsIn,
} from './rule-fill'
import { normText } from './rule-update'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`)
  passed++
  console.log(`  ✓ ${msg}`)
}

const TODAY = '2026-11-15'
const enc = (s: string) => new TextEncoder().encode(s)

function main(): void {
  console.log('capSourceText')
  {
    const r = capSourceText('a<document>b</document>c</ document >d<DOCUMENT>e')
    assert(!/document/i.test(r.text), 'document tags stripped (case-insensitive, with spaces)')
    const crlf = capSourceText('a\r\nb\rc')
    assert(crlf.text === 'a\nb\nc', 'CRLF/CR normalised to LF')
    assert(capSourceText('a\n\n\n\n\nb').text === 'a\n\nb', '3+ blank lines collapsed')
    assert(capSourceText('a\u0000b\u0007c\u001fd').text === 'a b c d', 'control chars removed')
    const long = capSourceText('x'.repeat(100), 40)
    assert(long.truncated && long.text.length === 40 && long.chars === 100, 'over max: truncated with full cleaned length')
    const short = capSourceText('hello', 40)
    assert(!short.truncated && short.chars === 5 && short.text === 'hello', 'short text not truncated')
  }

  console.log('isPdfBytes')
  {
    assert(isPdfBytes(enc('%PDF-1.7\nrest')), 'bytes starting %PDF-1.7')
    assert(isPdfBytes(enc('\u0001\u0002\u0003%PDF-1.4')), '%PDF- after junk bytes')
    assert(!isPdfBytes(enc('<!doctype html><html></html>')), 'HTML is not PDF')
    assert(!isPdfBytes(new Uint8Array(0)), 'empty array is not PDF')
  }

  console.log('decodeHtmlBytes')
  {
    const thai = 'ประกาศกระทรวงสาธารณสุข'
    assert(decodeHtmlBytes(enc(thai), 'text/html; charset=utf-8') === thai, 'UTF-8 Thai with header charset')
    const cp874 = (s: string) => Uint8Array.from(Array.from(s).map((c) => 0xa1 + (c.codePointAt(0)! - 0x0e01)))
    const bytes = cp874(thai)
    assert(decodeHtmlBytes(bytes, 'text/html; charset=TIS-620') === thai, 'TIS-620 header decodes to Thai')
    const meta = Uint8Array.from(Array.from(enc('<html><head><meta charset="tis-620"></head><body>')).concat(Array.from(bytes)))
    assert(decodeHtmlBytes(meta, 'text/html').endsWith(thai), 'meta charset used when header has none')
    let out = ''
    let threw = false
    try { out = decodeHtmlBytes(enc('abc'), 'text/html; charset=nonsense-xyz') } catch { threw = true }
    assert(!threw && out === 'abc', 'unknown charset falls back without throwing')
  }

  console.log('linkLabel')
  {
    assert(linkLabel('https://www.fda.moph.go.th/law/page?x=1#h') === 'fda.moph.go.th/law/page', 'strips www., keeps path, drops query')
    assert(linkLabel('https://example.com/') === 'example.com', 'root path omitted')
    assert(linkLabel('not a url') === 'not a url', 'non-URL tolerated')
  }

  console.log('buildFillUserPrompt')
  {
    const base = { today: TODAY, industries: [{ key: 'beauty_clinic', label: 'คลินิกความงาม' }, { key: 'food', label: 'อาหาร' }], sourceLabel: 'a\nb\r\nc', text: 'BODY', truncated: false }
    const p = buildFillUserPrompt(base)
    assert(p.includes('- beauty_clinic: คลินิกความงาม') && p.includes('- food: อาหาร'), 'industry keys listed')
    assert(p.includes('<document>\nBODY\n</document>'), 'text wrapped in document tags')
    assert(p.includes('Source: a b c'), 'newlines in sourceLabel flattened')
    assert(!p.includes('currently adding rules'), 'no preferred industry when not given')
    assert(!p.includes('cut off'), 'no cut-off note when not truncated')
    const pref = buildFillUserPrompt({ ...base, preferredIndustry: 'food' })
    assert(pref.includes('industry "food"'), 'preferred industry mentioned when in list')
    assert(!buildFillUserPrompt({ ...base, preferredIndustry: 'unknown' }).includes('currently adding rules'), 'preferred industry ignored when not in list')
    assert(buildFillUserPrompt({ ...base, truncated: true }).includes('cut off'), 'cut-off note when truncated')
  }

  console.log('refAppearsIn / yearAppearsIn')
  {
    assert(refAppearsIn('มาตรา 41', normText('ตามมาตรา ๔๑ แห่ง')), 'มาตรา 41 found via Thai digits')
    assert(refAppearsIn('มาตรา 41', normText('มาตรา41')), 'มาตรา 41 found as มาตรา41')
    assert(refAppearsIn('ข้อ 4', normText('ข้อ 4 ห้าม')), 'ข้อ 4 found')
    assert(!refAppearsIn('ข้อ 4', normText('ข้อ 14 ห้าม')), 'ข้อ 4 not found when source has only ข้อ 14')
    assert(!refAppearsIn('ข้อ 1', normText('ข้อ 14 ห้าม')), 'ข้อ 1 not accepted when source has only ข้อ 14 (digit boundary)')
    assert(!refAppearsIn('มาตรา 4', normText('มาตรา 41')), 'มาตรา 4 not accepted when source has only มาตรา 41')
    assert(refAppearsIn('ข้อ 4.1', normText('ข้อ 4.1 ใด')), 'dotted ref found')
    assert(!refAppearsIn('ข้อ 4.1', normText('ข้อ 4.12')), 'dotted ref not accepted as prefix of longer number')
    assert(refAppearsIn('ประกาศฉบับนี้', normText('x')), 'ref without number returns true')
    assert(yearAppearsIn('2024-01-15', normText('ประกาศ พ.ศ. 2567')), 'year 2024 found via 2567')
    assert(yearAppearsIn('2024-01-15', normText('in 2024')), 'year 2024 found directly')
    assert(!yearAppearsIn('2024-01-15', normText('ไม่มีปี 2020')), 'year not found when neither appears')
  }

  console.log('sanitizeFill')
  {
    const SRC = 'ประกาศ ข้อ 4 ห้ามโฆษณา มาตรา 41 พ.ศ. 2567 ดูที่ https://www.fda.moph.go.th/law'
    const ind = ['beauty_clinic', 'Food']
    const run = (raw: unknown, extra: Record<string, unknown> = {}) =>
      sanitizeFill({ raw, today: TODAY, sourceText: SRC, industries: ind, ...extra })
    const good = { title: 'ห้ามรับประกัน', terms: ['การันตี'] }

    assert(run({ rules: [good] }).rules.length === 1, 'accepts { rules: [...] }')
    assert(run(good).rules.length === 1, 'accepts a single bare rule object')
    assert(run({ rules: [{ description: 'x' }, good] }).rules.length === 1, 'drops items without title')
    assert(run({ rules: [good, { ...good, title: ' ห้าม รับประกัน ' }] }).rules.length === 1, 'de-duplicates by title')
    const many = Array.from({ length: 10 }, (_, i) => ({ title: `rule ${i}` }))
    assert(run({ rules: many }).rules.length === FILL_MAX_RULES, 'caps at FILL_MAX_RULES')

    assert(run({ rules: [{ ...good, industry: 'FOOD' }] }).rules[0].industry === 'food', 'industry kept case-insensitively')
    assert(run({ rules: [{ ...good, industry: 'cars' }] }).rules[0].industry === '', 'industry not in list becomes empty')

    const refOk = run({ rules: [{ ...good, sourceRef: 'ข้อ 4' }] }).rules[0]
    assert(refOk.sourceRef === 'ข้อ 4' && refOk.dropped.length === 0, 'sourceRef kept when number in source')
    const refBad = run({ rules: [{ ...good, sourceRef: 'ข้อ 9' }] }).rules[0]
    assert(refBad.sourceRef === '' && refBad.dropped.includes('sourceRef'), 'sourceRef dropped and listed when absent')

    const dOk = run({ rules: [{ ...good, effectiveDate: '2024-01-15' }] }).rules[0]
    assert(dOk.effectiveDate === '2024-01-15', 'effectiveDate kept when year in source')
    const dBad = run({ rules: [{ ...good, effectiveDate: '2019-01-15' }] }).rules[0]
    assert(dBad.effectiveDate === '' && dBad.dropped.includes('effectiveDate'), 'effectiveDate dropped and listed when year absent')
    const dMal = run({ rules: [{ ...good, effectiveDate: 'sometime soon' }] }).rules[0]
    assert(dMal.effectiveDate === '' && dMal.dropped.includes('effectiveDate'), 'malformed date listed as dropped')
    assert(dMal.dropped.filter((d) => d === 'effectiveDate').length === 1, 'effectiveDate listed once')
    const dBE = run({ rules: [{ ...good, effectiveDate: '2567-01-15' }] }).rules[0]
    assert(dBE.effectiveDate === '2024-01-15', 'Buddhist-year date converted to 2024-01-15')

    const forced = run({ rules: [{ ...good, sourceUrl: 'https://other.example.com/x' }] }, { forcedSourceUrl: 'https://www.fda.moph.go.th/page' }).rules[0]
    assert(forced.sourceUrl === 'https://www.fda.moph.go.th/page' && !forced.dropped.includes('sourceUrl'), 'link mode uses forced URL, ignores AI URL')
    const forcedNone = run({ rules: [good] }, { forcedSourceUrl: 'https://www.fda.moph.go.th/page' }).rules[0]
    assert(forcedNone.sourceUrl === 'https://www.fda.moph.go.th/page', 'link mode fills forced URL when AI sent none')
    const fileOk = run({ rules: [{ ...good, sourceUrl: 'https://www.fda.moph.go.th/law' }] }).rules[0]
    assert(fileOk.sourceUrl === 'https://www.fda.moph.go.th/law', 'file mode keeps URL that occurs in source')
    const fileBad = run({ rules: [{ ...good, sourceUrl: 'https://invented.example.com/law' }] }).rules[0]
    assert(fileBad.sourceUrl === '' && fileBad.dropped.includes('sourceUrl'), 'file mode drops invented URL and lists it')
    const fileInvalid = run({ rules: [{ ...good, sourceUrl: 'not a url' }] }).rules[0]
    assert(fileInvalid.sourceUrl === '' && fileInvalid.dropped.includes('sourceUrl'), 'file mode lists unusable URL as dropped')

    const longTerm = 'a'.repeat(90)
    const t = run({ rules: [{ title: 'T', terms: ['hello', longTerm] }] }).rules[0]
    assert(t.terms.includes('hello') && !t.terms.includes(longTerm), 'terms longer than 80 chars removed')

    const def = run({ rules: [{ title: 'T', terms: ['hello'] }] }).rules[0]
    assert(def.severity === 'MEDIUM' && def.ruleType === 'RISKY_TERM', 'defaults: MEDIUM + RISKY_TERM when terms exist')
    const noTerms = run({ rules: [{ title: 'T' }] }).rules[0]
    assert(noTerms.ruleType === 'CONTEXT' && noTerms.severity === 'MEDIUM', 'default CONTEXT when no terms')
    const bad = run({ rules: [{ title: 'T', terms: ['hello'], ruleType: 'NOPE', severity: 'EXTREME' }] }).rules[0]
    assert(bad.ruleType === 'RISKY_TERM' && bad.severity === 'MEDIUM', 'invalid ruleType/severity fall back to defaults')
    const valid = run({ rules: [{ title: 'T', ruleType: 'PROHIBITED_TERM', severity: 'HIGH' }] }).rules[0]
    assert(valid.ruleType === 'PROHIBITED_TERM' && valid.severity === 'HIGH', 'valid ruleType/severity kept')

    for (const nonObj of [null, undefined, 'x', 42, [1, 2]]) {
      const r = run(nonObj)
      assert(r.rules.length === 0 && r.note === '', `non-object input ${JSON.stringify(nonObj)} -> empty`)
    }
    assert(run({ rules: [], note: '  no   rules\n here ' }).note === 'no rules here', 'note trimmed and whitespace collapsed')
    assert(run({ rules: [], note: 'n'.repeat(1000) }).note.length === 600, 'note capped at 600')
    assert(run(good).rules[0].code === '', 'code left empty (server fills it)')
  }

  console.log('nextRuleCode')
  {
    assert(nextRuleCode(['BC-001', 'BC-011', 'bc-003'], new Set()) === 'BC-012', 'BC-001,BC-011,bc-003 -> BC-012')
    assert(nextRuleCode(['AA-001', 'BC-001', 'BC-002', 'AA-009'], new Set()) === 'BC-003' || nextRuleCode(['AA-001', 'BC-001', 'BC-002', 'AA-009'], new Set()) === 'AA-010', 'mixed prefixes pick one prefix')
    assert(nextRuleCode(['AA-001', 'BC-001', 'BC-002', 'BC-005'], new Set()) === 'BC-006', 'most common prefix wins')
    assert(nextRuleCode(['X-0009'], new Set()) === 'X-0010', 'keeps zero padding width')
    assert(nextRuleCode(['X-1'], new Set()) === 'X-2', 'no padding stays unpadded')
    const taken = new Set<string>(['bc-012'])
    assert(nextRuleCode(['BC-011'], taken) === 'BC-013', 'skips codes in taken')
    assert(taken.has('bc-013'), 'issued code added to taken (lower-case)')
    const t2 = new Set<string>()
    const a = nextRuleCode(['BC-001'], t2)
    const b = nextRuleCode(['BC-001'], t2)
    assert(a === 'BC-002' && b === 'BC-003', 'two calls in a row give consecutive codes')
    assert(nextRuleCode(['ABC', 'x_1', ''], new Set()) === '', 'no PREFIX-number codes -> empty')
    assert(nextRuleCode([], new Set()) === '', 'empty list -> empty')
  }

  console.log(`\nAll ${passed} assertions passed`)
}

main()
