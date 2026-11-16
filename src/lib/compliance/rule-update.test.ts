/**
 * Compliance AI rule update (pure functions) — Run: npx tsx src/lib/compliance/rule-update.test.ts
 */
import {
  MAX_PROPOSALS_PER_SOURCE, UPDATE_SYSTEM_PROMPT, buildUpdateUserPrompt, computeTrust, diffAgainstRule, dropCoveredTerms,
  evidenceProblems, groupRulesBySource, hostOf, isOfficialHost, issueYearOf, mapLimit, normText, normalizeDate, sanitizeChanges,
  validateProposals, weakensRule,
  type RuleForUpdate, type SourceGroup,
} from './rule-update'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`)
  passed++
  console.log(`  ✓ ${msg}`)
}

function rule(over: Partial<RuleForUpdate> = {}): RuleForUpdate {
  return {
    id: 'r1', version: 1, industry: 'beauty_clinic', code: 'BC-002', title: 'การันตี', description: 'ห้ามรับประกัน',
    ruleType: 'PROHIBITED_TERM', terms: ['การันตี', 'Guarantee'], severity: 'HIGH', guidance: 'ใช้ถ้อยคำเป็นกลาง',
    sourceName: 'ประกาศ ก', sourceUrl: 'https://www.tm.mahidol.ac.th/law', sourceRef: 'ข้อ 1', effectiveDate: '2025-01-01', status: 'ACTIVE', ...over,
  }
}
const TODAY = '2026-11-15'
function group(rules: RuleForUpdate[] = [rule()]): SourceGroup {
  return { sourceName: 'ประกาศ ก', sourceUrl: 'https://www.tm.mahidol.ac.th/law', rules }
}
function validate(raw: unknown, extra: { rules?: RuleForUpdate[]; citations?: { url: string }[]; taken?: string[] } = {}) {
  return validateProposals({
    raw, group: group(extra.rules), citations: extra.citations ?? [], takenCodes: new Set(extra.taken ?? []), today: TODAY, idPrefix: 'p-',
  })
}

// hostOf
{
  assert(hostOf('https://www.FDA.moph.go.th/x') === 'fda.moph.go.th', 'hostOf lowercases and strips www')
  assert(hostOf('ftp://a.go.th') === '', 'hostOf ftp -> empty')
  assert(hostOf('javascript:alert(1)') === '', 'hostOf javascript -> empty')
  assert(hostOf('not a url') === '', 'hostOf junk -> empty')
  assert(hostOf('') === '', 'hostOf empty -> empty')
}

// isOfficialHost
{
  for (const h of ['fda.moph.go.th', 'ratchakitcha.soc.go.th', 'bot.or.th', 'www2.sec.or.th', 'oic.or.th']) assert(isOfficialHost(h), `official: ${h}`)
  for (const h of ['', 'example.com', 'go.th.evil.com', 'evil-bot.or.th.example.com', 'fakebot.or.th', 'notgo.th', 'xgo.th']) assert(!isOfficialHost(h), `not official: "${h}"`)
}

// normalizeDate
{
  assert(normalizeDate('2026-01-16', TODAY) === '2026-01-16', 'normalizeDate keeps CE date')
  assert(normalizeDate('2569-01-16', TODAY) === '2026-01-16', 'normalizeDate converts BE')
  for (const v of ['2026-02-30', '16/01/2026', null, 123, '1850-01-01', '2031-01-01']) assert(normalizeDate(v, TODAY) === undefined, `normalizeDate rejects ${JSON.stringify(v)}`)
}

// sanitizeChanges
{
  const s = sanitizeChanges({
    ruleType: 'BAD', severity: 'EXTREME', sourceUrl: 'javascript:alert(1)', title: 'ก'.repeat(400),
    terms: ['คำหนึ่ง', 'คำหนึ่ง', 'x', 5, null, 'Best', 'best'], effectiveDate: '2569-01-16',
    status: 'ACTIVE', organizationId: 'o1', id: 'zzz',
  }, TODAY)
  assert(!('ruleType' in s) && !('severity' in s), 'sanitize drops bad enums')
  assert(!('sourceUrl' in s), 'sanitize drops non-http sourceUrl')
  assert(s.title?.length === 300, 'sanitize truncates title to 300')
  assert(JSON.stringify(s.terms) === JSON.stringify(['คำหนึ่ง', 'Best']), 'sanitize parses terms (dedupe, drop short, ignore non-strings)')
  assert(s.effectiveDate === '2026-01-16', 'sanitize converts BE date')
  assert(!('status' in s) && !('organizationId' in s) && !('id' in s), 'sanitize ignores unknown keys')
  assert(JSON.stringify(sanitizeChanges(null, TODAY)) === '{}', 'sanitize null -> {}')
  assert(JSON.stringify(sanitizeChanges([1], TODAY)) === '{}', 'sanitize array -> {}')
  assert(JSON.stringify(sanitizeChanges('x', TODAY)) === '{}', 'sanitize string -> {}')
  assert(sanitizeChanges({ sourceUrl: 'https://a.go.th/x' }, TODAY).sourceUrl === 'https://a.go.th/x', 'sanitize keeps https sourceUrl')
}

// diffAgainstRule
{
  const r = rule()
  const d1 = diffAgainstRule(r, { title: r.title, severity: 'CRITICAL', guidance: r.guidance })
  assert(Object.keys(d1.changes).join() === 'severity', 'diff drops equal fields')
  assert(d1.before.severity === 'HIGH', 'diff before holds old value')
  const d2 = diffAgainstRule(r, { terms: ['guarantee', 'การันตี'] })
  assert(!('terms' in d2.changes), 'diff terms compared order/case-insensitively')
  const d3 = diffAgainstRule(r, { terms: ['การันตี', 'ใหม่'] })
  assert(d3.changes.terms?.length === 2 && d3.before.terms?.length === 2, 'diff keeps real terms change')
  const d4 = diffAgainstRule(r, { terms: [] })
  assert(!('terms' in d4.changes) && !('terms' in d4.before), 'diff drops empty terms on PROHIBITED rule')
  const ctx = rule({ ruleType: 'CONTEXT', terms: [] })
  const d5 = diffAgainstRule(ctx, { ruleType: 'PROHIBITED_TERM' })
  assert(!('ruleType' in d5.changes), 'diff drops CONTEXT->PROHIBITED with no terms')
  const d6 = diffAgainstRule(ctx, { ruleType: 'PROHIBITED_TERM', terms: ['คำใหม่'] })
  assert(d6.changes.ruleType === 'PROHIBITED_TERM' && d6.changes.terms?.length === 1, 'diff allows type change when terms supplied')
}

// weakensRule
{
  const r = rule()
  assert(weakensRule(r, { terms: ['การันตี'] }), 'weakens: term removed')
  assert(weakensRule(r, { severity: 'LOW' }), 'weakens: severity lowered')
  assert(weakensRule(r, { ruleType: 'RISKY_TERM' }), 'weakens: PROHIBITED->RISKY')
  assert(weakensRule(r, { ruleType: 'CONTEXT' }), 'weakens: PROHIBITED->CONTEXT')
  assert(!weakensRule(r, { terms: ['การันตี', 'Guarantee', 'เพิ่ม'] }), 'not weakening: terms only added')
  assert(!weakensRule(r, { severity: 'CRITICAL' }), 'not weakening: severity raised')
  assert(!weakensRule(r, { title: 'x', description: 'y', guidance: 'z' }), 'not weakening: text only')
}

// computeTrust
{
  const base = { sourceUrls: ['https://www.tm.mahidol.ac.th/law'], weakens: false }
  const t1 = computeTrust({ ...base, evidenceUrl: '', citations: [] })
  assert(!t1.trusted && t1.trustNote.length > 0, 'trust: no URL untrusted')
  const t2 = computeTrust({ ...base, evidenceUrl: 'https://blog.example.com/a', citations: [{ url: 'https://blog.example.com/a' }] })
  assert(!t2.trusted && t2.trustNote.length > 0, 'trust: non-official foreign host untrusted')
  const t3 = computeTrust({ ...base, evidenceUrl: 'https://fda.moph.go.th/a', citations: [{ url: 'https://other.go.th/' }] })
  assert(!t3.trusted && t3.trustNote.length > 0, 'trust: official but not cited untrusted')
  const t4 = computeTrust({ ...base, evidenceUrl: 'https://fda.moph.go.th/a', citations: [{ url: 'https://fda.moph.go.th/b' }] })
  assert(t4.trusted && t4.trustNote.length > 0, 'trust: official and cited trusted')
  const t5 = computeTrust({ ...base, evidenceUrl: 'https://www.tm.mahidol.ac.th/other', citations: [{ url: 'https://tm.mahidol.ac.th/x' }] })
  assert(t5.trusted, 'trust: same host as rule source and cited trusted')
  const t6 = computeTrust({ ...base, weakens: true, evidenceUrl: 'https://fda.moph.go.th/a', citations: [{ url: 'https://fda.moph.go.th/b' }] })
  assert(!t6.trusted && t6.trustNote.length > 0, 'trust: weakening untrusted')
}

// groupRulesBySource
{
  const rs = [
    rule({ id: 'a', sourceName: 'A' }), rule({ id: 'b', sourceName: 'B' }), rule({ id: 'c', sourceName: 'B' }),
    rule({ id: 'd', sourceName: 'B' }), rule({ id: 'e', sourceName: 'C' }), rule({ id: 'f', sourceName: '' }), rule({ id: 'g', sourceName: ' ' }),
  ]
  const g = groupRulesBySource(rs, 10)
  assert(g.groups[0].sourceName === 'B' && g.groups[0].rules.length === 3, 'group: biggest first')
  assert(g.groups.length === 4 && g.skipped.length === 0, 'group: all groups returned under max')
  const empties = g.groups.find((x) => x.rules.some((r) => r.id === 'f'))
  assert(!!empties && empties.rules.length === 2, 'group: empty sourceNames grouped together')
  const g2 = groupRulesBySource(rs, 2)
  assert(g2.groups.length === 2 && g2.skipped.length === 7 - g2.groups.reduce((n, x) => n + x.rules.length, 0), 'group: maxGroups respected, leftovers skipped')
  assert(g2.skipped.length > 0, 'group: skipped is non-empty')
}

// validateProposals
{
  const cite = [{ url: 'https://www.tm.mahidol.ac.th/law2' }]
  const ev = 'https://www.tm.mahidol.ac.th/law2'
  const r1 = validate({ proposals: [{ ruleId: 'nope', changes: { severity: 'LOW' }, reason: 'x' }] })
  assert(r1.proposals.length === 0 && r1.dropped === 1, 'validate: unknown ruleId dropped + counted')
  const r2 = validate({ proposals: [{ ruleId: 'r1', changes: { title: 'การันตี' }, reason: 'x' }] })
  assert(r2.proposals.length === 0 && r2.dropped === 1, 'validate: no-op change dropped + counted')
  const r3 = validate({ proposals: [{ ruleId: 'r1', changes: { severity: 'CRITICAL' } }] })
  assert(r3.proposals.length === 0 && r3.dropped === 1, 'validate: missing reason dropped')
  const r4 = validate({
    summary: 'สรุป',
    proposals: [
      { ruleId: 'r1', changes: { severity: 'CRITICAL' }, reason: 'a', evidenceUrl: ev },
      { ruleId: 'r1', changes: { guidance: 'ใหม่' }, reason: 'b', evidenceUrl: ev },
    ],
  }, { citations: cite })
  assert(r4.proposals.length === 1 && r4.dropped === 1, 'validate: second proposal for same ruleId dropped')
  const u = r4.proposals[0]
  assert(u.kind === 'update' && u.ruleStatus === 'ACTIVE' && u.before.severity === 'HIGH' && u.changes.severity === 'CRITICAL', 'validate: update has before/changes/ruleStatus')
  assert(u.trusted === true, 'validate: same-host cited evidence trusted')
  assert(r4.summary === 'สรุป', 'validate: summary passes through')
  const draft = validate({ proposals: [{ ruleId: 'r1', changes: { severity: 'CRITICAL' }, reason: 'a' }] }, { rules: [rule({ status: 'DRAFT' })] })
  assert(draft.proposals[0].ruleStatus === 'DRAFT', 'validate: ruleStatus follows rule status')

  const n1 = validate({ proposals: [{ ruleId: null, code: 'AI-X', changes: { title: 'ใหม่', description: 'รายละเอียด' }, reason: 'r' }] })
  const np = n1.proposals[0]
  assert(np.kind === 'new' && np.ruleStatus === null && Object.keys(np.before).length === 0, 'validate: new kind, ruleStatus null, before {}')
  assert(np.changes.ruleType === 'CONTEXT' && np.changes.severity === 'MEDIUM' && np.changes.terms?.length === 0, 'validate: new defaults CONTEXT/MEDIUM/[]')
  assert(np.changes.sourceName === 'ประกาศ ก', 'validate: new sourceName defaults to group.sourceName')
  const n2 = validate({ proposals: [{ ruleId: null, code: 'BC-002', changes: { title: 'ใหม่', description: 'd' }, reason: 'r' }] }, { taken: ['bc-002'] })
  assert(n2.proposals[0].ruleCode !== 'BC-002' && n2.proposals[0].ruleCode.startsWith('BC-002'), 'validate: taken code gets suffix')
  const n3 = validate({
    proposals: [
      { ruleId: null, code: 'DUP', changes: { title: 'a', description: 'd' }, reason: 'r' },
      { ruleId: null, code: 'DUP', changes: { title: 'b', description: 'd' }, reason: 'r' },
    ],
  })
  assert(n3.proposals.length === 2 && n3.proposals[0].ruleCode !== n3.proposals[1].ruleCode, 'validate: two new with same code get different codes')
  const n4 = validate({ proposals: [{ ruleId: null, changes: { description: 'd' }, reason: 'r' }] })
  assert(n4.proposals.length === 0 && n4.dropped === 1, 'validate: new without title dropped')
  const n5 = validate({ proposals: [{ ruleId: null, changes: { title: 't', description: 'd' }, reason: 'r', evidenceUrl: 'javascript:alert(1)' }] })
  assert(n5.proposals[0].evidenceUrl === '' && !n5.proposals[0].trusted, 'validate: non-http evidenceUrl blanked and untrusted')
  const ids = validate({
    proposals: [
      { ruleId: null, code: 'A', changes: { title: 'a', description: 'd' }, reason: 'r' },
      { ruleId: null, code: 'B', changes: { title: 'b', description: 'd' }, reason: 'r' },
    ],
  }).proposals.map((p) => p.id)
  assert(ids.every((i) => i.startsWith('p-')) && new Set(ids).size === ids.length, 'validate: ids use idPrefix and are unique')
  for (const raw of [null, 'text', { proposals: 'x' }, { proposals: {} }]) {
    const r = validate(raw)
    assert(r.proposals.length === 0, `validate: bad raw ${JSON.stringify(raw)} -> zero proposals`)
  }
  const many = Array.from({ length: MAX_PROPOSALS_PER_SOURCE + 5 }, (_, i) => ({ ruleId: null, code: `C${i}`, changes: { title: `t${i}`, description: 'd' }, reason: 'r' }))
  const capped = validate({ proposals: many })
  assert(capped.proposals.length === MAX_PROPOSALS_PER_SOURCE, 'validate: capped at MAX_PROPOSALS_PER_SOURCE')
}

// normText
{
  assert(normText('É') === 'é', 'normText: NFC composes e + acute')
  assert(normText('๒๕๖๙-๐๑-๑๖') === '2569-01-16', 'normText: Thai digits -> Arabic')
  assert(normText(' a\tb\n c d​e ') === 'abcde', 'normText: strips whitespace, nbsp, zero-width space')
  assert(normText('"A" ‘b’ “c” \'d\' `e`') === 'abcde', 'normText: strips quote characters')
  assert(normText('ABC Def') === 'abcdef', 'normText: lowercases')
  assert(normText('นํา') === 'นำ', 'normText: nikhahit+sara aa -> sara am')
  assert(normText(null as unknown as string) === '', 'normText: null -> empty')
}

// issueYearOf
{
  assert(issueYearOf('ประกาศกระทรวง พ.ศ. 2560') === 2017, 'issueYearOf: BE year minus 543')
  assert(issueYearOf('ประกาศ พ.ศ. ๒๕๖๕') === 2022, 'issueYearOf: Thai digits accepted')
  assert(issueYearOf('ประกาศ ก') === null, 'issueYearOf: no year -> null')
  assert(issueYearOf('ฉบับที่ 2 พ.ศ. 2565 แก้ไข พ.ศ. 2560') === 2017, 'issueYearOf: two years -> smaller')
  assert(issueYearOf('เลขที่ 12560') === null, 'issueYearOf: year embedded in a longer number ignored')
  assert(issueYearOf('ปี 2026') === null, 'issueYearOf: CE year (20xx) ignored')
}

// dropCoveredTerms
{
  assert(dropCoveredTerms(['บารากู่', 'บารากู่ไฟฟ้า']).join() === 'บารากู่', 'dropCovered: longer Thai term containing shorter Thai term dropped')
  assert(dropCoveredTerms(['บารากู่ไฟฟ้า', 'บารากู่']).join() === 'บารากู่', 'dropCovered: independent of order')
  assert(dropCoveredTerms(['vape', 'vape pen']).join('|') === 'vape|vape pen', 'dropCovered: ASCII terms never cover each other')
  assert(dropCoveredTerms(['รักษา', 'ยา', 'บารากู่', 'บารากู่ไฟฟ้า', 'vape']).join() === 'รักษา,ยา,บารากู่,vape', 'dropCovered: survivors keep order')
  assert(dropCoveredTerms(['การันตี', 'การันตี']).length === 2, 'dropCovered: identical duplicates both kept (equal term does not cover itself)')
  assert(dropCoveredTerms(['Vape', 'vape']).length === 2, 'dropCovered: case-only duplicates both kept')
  assert(dropCoveredTerms(['รักษา', 'รักษาหาย vape']).join() === 'รักษา', 'dropCovered: mixed Thai/ASCII term covered by Thai term')
  assert(dropCoveredTerms([]).length === 0, 'dropCovered: empty list')
}

// weakensRule (coverage-aware, extra cases)
{
  const r = rule({ terms: ['บารากู่ไฟฟ้า', 'vape pen'], ruleType: 'RISKY_TERM', severity: 'MEDIUM' })
  assert(!weakensRule(r, { terms: ['บารากู่', 'vape pen'] }), 'weakens: old term replaced by shorter Thai term it contains is not weakening')
  assert(weakensRule(r, { terms: ['บารากู่ไฟฟ้า'] }), 'weakens: removing term with nothing covering it is weakening')
  assert(weakensRule(r, { terms: ['บารากู่ไฟฟ้า', 'vape'] }), 'weakens: shorter ASCII term does not cover old ASCII term')
  assert(weakensRule(r, { terms: ['บุหรี่', 'vape pen'] }), 'weakens: unrelated replacement is weakening')
  assert(weakensRule(r, { severity: 'LOW' }), 'weakens: MEDIUM -> LOW')
  assert(!weakensRule(r, { severity: 'MEDIUM' }), 'weakens: same severity is not weakening')
  assert(weakensRule(r, { ruleType: 'CONTEXT' }), 'weakens: RISKY -> CONTEXT')
  assert(!weakensRule(r, { ruleType: 'PROHIBITED_TERM' }), 'weakens: RISKY -> PROHIBITED is stronger')
  assert(weakensRule(rule({ ruleType: 'PROHIBITED_TERM' }), { ruleType: 'RISKY_TERM' }), 'weakens: PROHIBITED -> RISKY')
  assert(!weakensRule(rule({ ruleType: 'CONTEXT' }), { ruleType: 'RISKY_TERM' }), 'weakens: CONTEXT -> RISKY is stronger')
}

// evidenceProblems
{
  const URL1 = 'https://www.tm.mahidol.ac.th/law2'
  const base = { sourceName: 'ประกาศ ก', evidenceUrl: URL1, evidenceQuote: '', citations: [] as { url: string; content?: string }[] }
  const LONG = 'ประกาศนี้ให้ใช้บังคับตั้งแต่วันถัดจากวันประกาศในราชกิจจานุเบกษา'
  const has = (ps: string[], t: string) => ps.some((p) => p.includes(t))

  const a = evidenceProblems({ ...base, sourceName: 'ประกาศ พ.ศ. 2565', changes: { effectiveDate: '2020-01-01' }, evidenceQuote: 'ใช้บังคับ 2020' })
  assert(has(a, 'อยู่ก่อนปีที่ออกกฎหมาย'), 'evidence: date year before issue year flagged')
  assert(!has(a, 'ไม่มีปีของวันที่'), 'evidence: quote with the year does not add the missing-year problem')
  const a2 = evidenceProblems({ ...base, sourceName: 'ประกาศ พ.ศ. 2565', changes: { effectiveDate: '2022-01-01' }, evidenceQuote: '2022' })
  assert(!has(a2, 'อยู่ก่อนปีที่ออกกฎหมาย'), 'evidence: date in issue year not flagged as before issue year')
  const a3 = evidenceProblems({ ...base, changes: { effectiveDate: '2020-01-01' }, evidenceQuote: '2020' })
  assert(a3.length === 0, 'evidence: no year in sourceName -> no before-issue check')

  const b = evidenceProblems({ ...base, changes: { effectiveDate: '2026-01-16' }, evidenceQuote: 'ใช้บังคับตั้งแต่วันที่ 16 มกราคม' })
  assert(b.length === 1 && has(b, 'ไม่มีปีของวันที่มีผลบังคับใช้'), 'evidence: quote without year flagged')
  const b2 = evidenceProblems({ ...base, changes: { effectiveDate: '2026-01-16' }, evidenceQuote: '' })
  assert(has(b2, 'ไม่มีปีของวันที่มีผลบังคับใช้'), 'evidence: empty quote flagged for missing year')

  const c1 = evidenceProblems({ ...base, changes: { effectiveDate: '2026-01-16' }, evidenceQuote: 'ใช้บังคับ 16 มกราคม พ.ศ. 2569' })
  assert(c1.length === 0, 'evidence: BE year in Arabic digits accepted')
  const c2 = evidenceProblems({ ...base, changes: { effectiveDate: '2026-01-16' }, evidenceQuote: 'ใช้บังคับ 16 มกราคม พ.ศ. ๒๕๖๙' })
  assert(c2.length === 0, 'evidence: BE year in Thai digits accepted')
  const c3 = evidenceProblems({ ...base, changes: { effectiveDate: '2026-01-16' }, evidenceQuote: 'effective 16 January 2026' })
  assert(c3.length === 0, 'evidence: CE year accepted')

  const d = evidenceProblems({ ...base, sourceName: 'ประกาศ พ.ศ. 2565', changes: { effectiveDate: '2020-01-01' }, evidenceQuote: 'ไม่มีปี', knownDates: ['2020-01-01'] })
  assert(d.length === 0, 'evidence: known date -> no date problems at all')
  const d2 = evidenceProblems({ ...base, changes: { effectiveDate: '2026-01-16' }, evidenceQuote: 'ไม่มีปี', knownDates: ['2025-01-01'] })
  assert(has(d2, 'ไม่มีปีของวันที่'), 'evidence: different known date does not exempt')

  const sameHost = (content: string) => [{ url: 'https://tm.mahidol.ac.th/other', content }]
  const e = evidenceProblems({ ...base, changes: {}, evidenceQuote: 'สั้นมาก', citations: sameHost('เนื้อหาหน้าเว็บ ' + LONG) })
  assert(e.length === 1 && e[0] === 'AI ไม่ได้ยกข้อความจากหน้าเว็บมาให้ตรวจ', 'evidence: short quote (<20 chars) with page content flagged')
  const e2 = evidenceProblems({ ...base, changes: {}, evidenceQuote: 'ก ข ค ง จ ฉ ช ซ ฌ ญ ฎ ฏ ฐ ฑ ฒ ณ ด ต ถ ท', citations: sameHost('เนื้อหา ' + LONG) })
  assert(has(e2, 'ไม่พบข้อความที่ยกมา'), 'evidence: 20+ chars quote spaced out normalises past threshold (not the short-quote problem)')
  assert(!e2.includes('AI ไม่ได้ยกข้อความจากหน้าเว็บมาให้ตรวจ'), 'evidence: spaces do not count towards the 20-char minimum')

  const f = evidenceProblems({ ...base, changes: {}, evidenceQuote: 'ข้อความที่ไม่มีอยู่ในหน้าเว็บเลยสักนิดเดียว', citations: sameHost('เนื้อหา ' + LONG) })
  assert(f.length === 1 && has(f, 'ไม่พบข้อความที่ยกมา') && has(f, 'tm.mahidol.ac.th'), 'evidence: quote absent from page content flagged with host')

  const g = evidenceProblems({ ...base, changes: {}, evidenceQuote: 'ให้ใช้บังคับ ตั้งแต่ 16 มกราคม ๒๕๖๙ เป็นต้นไป', citations: sameHost('ข้อ 1\n  ให้ใช้บังคับตั้งแต่   16 มกราคม 2569\nเป็นต้นไป') })
  assert(g.length === 0, 'evidence: quote found despite whitespace / Thai-digit differences')
  const g2 = evidenceProblems({ ...base, changes: {}, evidenceQuote: '“ให้ใช้บังคับตั้งแต่วันถัดจากวันประกาศ”', citations: sameHost(LONG) })
  assert(g2.length === 0, 'evidence: quote wrapped in curly quotes still matches')

  const h1 = evidenceProblems({ ...base, changes: {}, evidenceQuote: 'ข้อความที่ไม่มีอยู่ในหน้าเว็บเลยสักนิดเดียว', citations: [{ url: URL1 }] })
  assert(h1.length === 0, 'evidence: same-host citation without content -> quote check skipped')
  const h2 = evidenceProblems({ ...base, changes: {}, evidenceQuote: 'ข้อความที่ไม่มีอยู่ในหน้าเว็บเลยสักนิดเดียว', citations: [{ url: URL1, content: '' }] })
  assert(h2.length === 0, 'evidence: empty content -> quote check skipped')
  const h3 = evidenceProblems({ ...base, changes: {}, evidenceQuote: 'สั้น', citations: [{ url: 'https://other.example.com/x', content: LONG }] })
  assert(h3.length === 0, 'evidence: citation on another host -> quote check skipped')
  const h4 = evidenceProblems({ ...base, evidenceUrl: '', changes: {}, evidenceQuote: 'สั้น', citations: [{ url: URL1, content: LONG }] })
  assert(h4.length === 0, 'evidence: no evidenceUrl -> quote check skipped')
  const h5 = evidenceProblems({ ...base, changes: {}, evidenceQuote: 'สั้น', citations: [{ url: 'https://other.example.com/x', content: LONG }, { url: 'https://tm.mahidol.ac.th/q' }] })
  assert(h5.length === 0, 'evidence: only content-less same-host pages -> skipped even if other hosts have content')
}

// validateProposals + evidence problems
{
  const ev = 'https://www.tm.mahidol.ac.th/law2'
  const cite = [{ url: ev }]
  const okUpdate = validate({ proposals: [{ ruleId: 'r1', changes: { severity: 'CRITICAL' }, reason: 'a', evidenceUrl: ev }] }, { citations: cite })
  assert(okUpdate.proposals[0].trusted === true, 'validate+evidence: baseline same-host cited update trusted')

  const bad = validate({
    proposals: [{ ruleId: 'r1', changes: { effectiveDate: '2026-01-16' }, reason: 'a', evidenceUrl: ev, evidenceQuote: 'ใช้บังคับตั้งแต่วันที่ 16 มกราคม' }],
  }, { citations: cite })
  const bp = bad.proposals[0]
  assert(bp.trusted === false, 'validate+evidence: evidence problem -> trusted false')
  assert(bp.trustNote.includes('ไม่มีปีของวันที่มีผลบังคับใช้'), 'validate+evidence: trustNote includes the problem text')

  const good = validate({
    proposals: [{ ruleId: 'r1', changes: { effectiveDate: '2026-01-16' }, reason: 'a', evidenceUrl: ev, evidenceQuote: 'ใช้บังคับ 16 มกราคม พ.ศ. 2569' }],
  }, { citations: cite })
  assert(good.proposals[0].trusted === true, 'validate+evidence: quote with year keeps proposal trusted')

  const dated = rule({ effectiveDate: '2025-01-01' })
  const nk = validate({
    proposals: [{ ruleId: null, code: 'N1', changes: { title: 't', description: 'd', effectiveDate: '2025-01-01' }, reason: 'r', evidenceUrl: ev }],
  }, { rules: [dated], citations: cite })
  assert(nk.proposals[0].kind === 'new' && nk.proposals[0].trusted === true, 'validate+evidence: new rule reusing a known date is not flagged')
  const nu = validate({
    proposals: [{ ruleId: null, code: 'N2', changes: { title: 't', description: 'd', effectiveDate: '2024-06-01' }, reason: 'r', evidenceUrl: ev }],
  }, { rules: [dated], citations: cite })
  assert(nu.proposals[0].trusted === false && nu.proposals[0].trustNote.includes('ไม่มีปีของวันที่'), 'validate+evidence: new rule with unknown date and no quote is flagged')
}

// mapLimit + prompts
async function main(): Promise<void> {
  let running = 0
  let peak = 0
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n, i) => {
    running++
    peak = Math.max(peak, running)
    await new Promise((r) => setTimeout(r, 10 - i))
    running--
    return n * 10
  })
  assert(out.join() === '10,20,30,40,50,60,70', 'mapLimit keeps result order')
  assert(peak <= 3 && peak > 1, `mapLimit concurrency capped (peak ${peak})`)
  assert((await mapLimit([], 3, async (x: number) => x)).length === 0, 'mapLimit empty array')

  const g = group([rule({ id: 'rule-aaa' }), rule({ id: 'rule-bbb' })])
  const p = buildUpdateUserPrompt({ industryLabel: 'คลินิก', group: g, today: TODAY })
  assert(p.includes('ประกาศ ก') && p.includes('rule-aaa') && p.includes('rule-bbb') && p.includes(TODAY), 'buildUpdateUserPrompt contains source, ids, today')
  assert(typeof UPDATE_SYSTEM_PROMPT === 'string' && UPDATE_SYSTEM_PROMPT.length > 0 && UPDATE_SYSTEM_PROMPT.includes('JSON'), 'UPDATE_SYSTEM_PROMPT mentions JSON')

  console.log(`\n${passed} passed`)
}
main().catch((e) => { console.error(e); process.exit(1) })
