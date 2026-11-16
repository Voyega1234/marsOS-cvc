// Brand Radar prompts: npx tsx src/lib/brand-radar/prompts.test.ts
import {
  classifyIntent, classifyJourney, findDuplicate, guessTopic, markDuplicates, parsePromptCsv, promptsToCsv, textKey, trigramSimilarity,
} from './prompts'
import { LIMITS, type PromptCandidate, type PromptDTO, type PromptIntent, type PromptStats } from './types'

let passed = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`FAIL: ${msg}\n  actual:   ${a}\n  expected: ${e}`)
  passed++
}

// textKey
eq(textKey('Best CRM in Thailand?'), textKey(' best crm in  thailand '), 'case/punct/space same key')
eq(textKey('Best CRM in Thailand?'), 'best crm in thailand', 'key value')
eq(textKey('ร้านกาแฟ ที่ไหนดี?'), textKey('ร้านกาแฟ  ที่ไหนดี'), 'thai same key')
eq(textKey('ร้านกาแฟ​ที่ไหนดี'), 'ร้านกาแฟที่ไหนดี', 'zero width removed, thai marks kept')
eq(textKey('ที่ไหนดี'), 'ที่ไหนดี', 'thai vowels/tone marks preserved')
eq(textKey('Ｂｅｓｔ ＣＲＭ'), 'best crm', 'NFKC')
eq(textKey('  ?!  '), '', 'only punctuation')

// similarity
eq(trigramSimilarity('Best CRM in Thailand?', ' best crm in  thailand '), 1, 'identical keys = 1')
eq(trigramSimilarity('ab', 'ab'), 1, 'short equal')
eq(trigramSimilarity('ab', 'ac'), 0, 'short differ')
eq(trigramSimilarity('abc', 'xyz'), 0, 'disjoint')
const near = trigramSimilarity('best crm software for small business in thailand', 'best crm software for small businesses in thailand')
eq(near >= LIMITS.similarityThreshold, true, `near duplicate above threshold (${near})`)
const far = trigramSimilarity('best crm software for small business in thailand', 'how to cook rice in a pot')
eq(far < LIMITS.similarityThreshold, true, 'unrelated below threshold')
eq(findDuplicate('Best CRM?', ['something else entirely', 'best crm']), { text: 'best crm', similarity: 1 }, 'findDuplicate best match')
eq(findDuplicate('hello world foo', ['completely different text']), null, 'findDuplicate none')
eq(findDuplicate('best crm software tools', ['best crm software tool'], 0.99), null, 'custom threshold stricter')

// markDuplicates
const cands: PromptCandidate[] = [
  { text: 'Best CRM in Thailand?', source: 'manual' },
  { text: 'best crm in thailand', source: 'manual' },
  { text: 'what is the weather in bangkok', source: 'manual' },
  { text: 'Existing prompt here!', source: 'manual' },
]
const marked = markDuplicates(cands, ['existing prompt here'])
eq(marked.map((c) => c.text), cands.map((c) => c.text), 'order preserved')
eq(marked[0].duplicateOf, undefined, 'first is not a duplicate')
eq(marked[1].duplicateOf?.kind, 'batch', 'later candidate duplicates earlier = batch')
eq(marked[1].duplicateOf?.text, 'Best CRM in Thailand?', 'batch dup points at earlier text')
eq(marked[2].duplicateOf, undefined, 'unique has no duplicateOf')
eq(marked[3].duplicateOf?.kind, 'existing', 'existing dup')
eq('duplicateOf' in marked[0], false, 'no duplicateOf key on non-duplicates')

// intents
const intents: Array<[string, PromptIntent]> = [
  ['HubSpot vs Salesforce', 'brand_comparison'],
  ['compare hubspot and zoho', 'brand_comparison'],
  ['hubspot or zoho for startups', 'brand_comparison'],
  ['เปรียบเทียบ CRM สองตัว', 'brand_comparison'],
  ['hubspot หรือ zoho ดีกว่ากัน', 'brand_comparison'],
  ['Best CRM for startups', 'recommendation'],
  ['which CRM should I use', 'recommendation'],
  ['แนะนำ CRM สำหรับร้านค้า', 'recommendation'],
  ['ร้านอาหารที่ไหนดี', 'recommendation'],
  ['buy CRM software', 'transactional'],
  ['CRM pricing', 'transactional'],
  ['ราคา CRM', 'transactional'],
  ['ส่วนลด โปรโมชั่น เดือนนี้', 'transactional'],
  ['how to fix login error', 'problem_solving'],
  ['why is my site slow', 'problem_solving'],
  ['วิธีแก้ ปัญหาเว็บช้า', 'problem_solving'],
  ['hubspot review', 'commercial_investigation'],
  ['hubspot pros and cons', 'commercial_investigation'],
  ['รีวิว CRM', 'commercial_investigation'],
  ['hubspot คุ้มไหม', 'commercial_investigation'],
  ['hubspot login', 'navigational'],
  ['hubspot official site', 'navigational'],
  ['เบอร์ติดต่อ สาขาสีลม', 'navigational'],
  ['what is a CRM', 'informational'],
  ['CRM คืออะไร', 'informational'],
]
for (const [text, want] of intents) eq(classifyIntent(text), want, `intent: ${text}`)
eq(classifyIntent('best crm vs zoho'), 'brand_comparison', 'comparison wins over recommendation')

// journey
eq(classifyJourney('informational'), 'awareness', 'journey informational')
eq(classifyJourney('problem_solving'), 'awareness', 'journey problem')
eq(classifyJourney('commercial_investigation'), 'consideration', 'journey commercial')
eq(classifyJourney('brand_comparison'), 'consideration', 'journey comparison')
eq(classifyJourney('recommendation'), 'consideration', 'journey recommendation')
eq(classifyJourney('transactional'), 'decision', 'journey transactional')
eq(classifyJourney('navigational'), 'retention', 'journey navigational')

// topic
eq(guessTopic('anything', 'crm software'), 'crm software', 'topic = keyword')
eq(guessTopic('anything'), '', 'no keyword = empty, not invented')

// CSV parse
const csv = '﻿Text,Topic,Intent,journey_stage,Country,Language,Keyword,search_volume,Priority\r\n' +
  '"Best CRM, for ""SMEs""\nin Thailand?",crm,recommendation,consideration,TH,en,crm software,"1,200",high\r\n' +
  'plain prompt,,bogus,bogus,,,,n/a,urgent\r\n' +
  ',x,,,,,,,\r\n' +
  'zero volume,,,,,,,0,low\r\n' +
  `${'a'.repeat(LIMITS.promptTextMax + 1)},,,,,,,,\r\n`
const parsed = parsePromptCsv(csv)
eq(parsed.rows.length, 3, 'three valid rows')
eq(parsed.rows[0].text, 'Best CRM, for "SMEs"\nin Thailand?', 'quoted comma/quote/newline')
eq(parsed.rows[0].searchVolume, 1200, 'volume with thousands comma')
eq(parsed.rows[0].intent, 'recommendation', 'intent kept')
eq(parsed.rows[0].journeyStage, 'consideration', 'journey_stage alias')
eq(parsed.rows[0].priority, 'high', 'priority kept')
eq(parsed.rows[1].intent, undefined, 'invalid intent -> undefined')
eq(parsed.rows[1].journeyStage, undefined, 'invalid journey -> undefined')
eq(parsed.rows[1].priority, undefined, 'invalid priority -> undefined')
eq(parsed.rows[1].searchVolume, null, 'n/a volume -> null, not 0')
eq(parsed.rows[2].searchVolume, 0, 'explicit 0 stays 0')
eq(parsed.errors.length, 2, 'two errors')
eq(/Row 4/.test(parsed.errors[0]), true, 'empty text error names row 4')
eq(/Row 6/.test(parsed.errors[1]), true, 'too long error names row 6')
eq(parsePromptCsv('topic,intent\nx,y').rows.length, 0, 'no text column = no rows')
eq(parsePromptCsv('topic,intent\nx,y').errors.length, 1, 'no text column = error')
eq(parsePromptCsv('prompt,volume\nhello there,-\nsecond,12').rows.map((r) => r.searchVolume), [null, 12], 'prompt/volume aliases, "-" null')
eq(parsePromptCsv('text\nonly text').rows[0].searchVolume, undefined, 'no volume column -> undefined')
eq(parsePromptCsv('').rows.length, 0, 'empty file')

// CSV export
const dto = (o: Partial<PromptDTO> & { stats?: PromptStats }): PromptDTO & { stats?: PromptStats } => ({
  id: 'p1', projectId: 'pr', text: 'Best CRM, "pro"\nline', topic: 'crm', intent: 'recommendation', journeyStage: 'consideration',
  country: 'TH', language: 'th', source: 'manual', keyword: 'crm', searchVolume: null, priority: 'high', status: 'ACTIVE', note: '',
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', ...o,
})
const out = promptsToCsv([
  dto({}),
  dto({
    id: 'p2', text: 'ร้านกาแฟที่ไหนดี', searchVolume: 500,
    stats: { responses: 4, brandMentions: 1, mentionRate: 0.25, brandRecommended: 0, ownedCited: 0, citationRate: 0, topCompetitor: null, lastCollectedAt: null },
  }),
  dto({
    id: 'p3', text: 'no data yet',
    stats: { responses: 0, brandMentions: 0, mentionRate: null, brandRecommended: 0, ownedCited: 0, citationRate: null, topCompetitor: null, lastCollectedAt: null },
  }),
])
eq(out.charCodeAt(0), 0xfeff, 'starts with BOM')
const lines = out.slice(1).split('\r\n')
eq(lines[0], 'text,topic,intent,journeyStage,country,language,source,keyword,searchVolume,priority,status,responses,brandMentions,mentionRate,citationRate', 'header')
eq(lines.length, 5, 'header + 3 rows + trailing empty; quoted newline stays inside its cell')
eq(lines[1].endsWith('manual,crm,,high,ACTIVE,,,,'), true, 'null volume and missing stats are empty cells')
eq(lines[2], 'ร้านกาแฟที่ไหนดี,crm,recommendation,consideration,TH,th,manual,crm,500,high,ACTIVE,4,1,0.25,0', 'stats row; real 0 citation rate kept')
eq(lines[3].endsWith('ACTIVE,0,0,,'), true, 'null rates empty, real zero counts kept')

// round trip
const rt = parsePromptCsv(out)
eq(rt.errors, [], 'round trip no errors')
eq(rt.rows.length, 3, 'round trip rows')
eq(rt.rows[0].text, 'Best CRM, "pro"\nline', 'round trip text with comma, quotes, newline')
eq(rt.rows[0].searchVolume, null, 'round trip: null volume stays null (blank cell)')
eq(rt.rows[1].searchVolume, 500, 'round trip volume')
eq(rt.rows[1].text, 'ร้านกาแฟที่ไหนดี', 'round trip thai')

console.log(`prompts.test.ts: ${passed} assertions passed`)
