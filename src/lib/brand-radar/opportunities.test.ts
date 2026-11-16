// Brand Radar opportunities: npx tsx src/lib/brand-radar/opportunities.test.ts
import { buildOpportunities, confidenceFor, scoreOpportunity, type OpportunityDraft } from './opportunities'
import type { CitationRow, Dataset, MentionRow, PromptLite, RespRow } from './metrics'
import type { CitationOwner, ProviderKey } from './types'

let passed = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`FAIL: ${msg}\n  actual:   ${a}\n  expected: ${e}`)
  passed++
}

function resp(id: string, promptId: string, o: Partial<RespRow> = {}): RespRow {
  return {
    id, runId: 'r1', promptId, provider: 'openai', collectedAt: new Date('2026-11-10T03:00:00.000Z'),
    brandMentioned: false, brandOccurrences: 0, brandRecommended: false, ownedCited: false, citationCount: 0, ...o,
  }
}
function men(responseId: string, promptId: string, entityType: 'brand' | 'competitor', key: string, o: Partial<MentionRow> = {}): MentionRow {
  return {
    responseId, runId: 'r1', promptId, provider: 'openai', entityType, entityKey: key,
    competitorId: entityType === 'competitor' ? key : null, entityName: key === 'c1' ? 'Rival' : key, occurrences: 1, recommended: false, compared: false, position: 1, ...o,
  }
}
function cit(responseId: string, promptId: string, domain: string, ownerType: CitationOwner, o: Partial<CitationRow> = {}): CitationRow {
  return {
    responseId, runId: 'r1', promptId, provider: 'openai', url: `https://${domain}/a`, normalizedUrl: `${domain}/a`, domain, title: '',
    ownerType, competitorId: ownerType === 'competitor' ? 'c1' : null, createdAt: null, ...o,
  }
}
const prompt = (id: string, o: Partial<PromptLite> = {}): PromptLite => ({ id, text: `คำถาม ${id}`, topic: 'crm', intent: 'recommendation', searchVolume: null, priority: 'medium', ...o })
const base = (o: Partial<Dataset>): Dataset => ({ brandName: 'Acme', responses: [], mentions: [], citations: [], prompts: [], competitors: [{ id: 'c1', name: 'Rival' }], ...o })
function near(actual: number, expected: number, msg: string) {
  if (Math.abs(actual - expected) > 1e-9) throw new Error(`FAIL: ${msg}\n  actual: ${actual}\n  expected: ${expected}`)
  passed++
}
const find = (ops: OpportunityDraft[], type: string, key?: string) => ops.find((o) => o.type === type && (key === undefined || o.key === key))
const has = (ops: OpportunityDraft[], type: string, key?: string) => find(ops, type, key) !== undefined

// scoring
eq(scoreOpportunity(1, 'high', 1000, 1000), 100, 'max score')
eq(scoreOpportunity(0.5, 'medium', 500, 1000), 53, 'known volume half of max')
eq(scoreOpportunity(0.5, 'medium', null, 1000), 53, 'unknown volume = 0.5 weight (same as half)')
eq(scoreOpportunity(0.5, 'medium', 500, null), 53, 'unknown max volume = 0.5 weight')
eq(scoreOpportunity(0.5, null, null, null), 53, 'no prompt = priority 0.6, volume 0.5')
eq(scoreOpportunity(0, 'low', null, 1000), 19, 'low priority, zero strength, unknown volume')
eq(scoreOpportunity(0, 'low', 0, 1000), 9, 'known zero volume is 0, not unknown (0.5)')
eq(scoreOpportunity(1 / 3, 'high', 100, 300), 53.3, 'rounded to 1 decimal')
eq(scoreOpportunity(2, 'high', 5000, 1000), 100, 'clamped to 100')
eq(scoreOpportunity(-1, 'low', 0, 1000), 9, 'negative strength clamped to 0')
eq(scoreOpportunity(0, 'high', 1000, 1000), 50, 'priority + volume only')

// confidence
eq([0, 3, 4, 9, 10, 50].map(confidenceFor), ['low', 'low', 'medium', 'medium', 'high', 'high'], 'confidence thresholds')

// clean dataset: brand mentioned and own domain cited everywhere, no competitors, no external citations
{
  const clean = base({
    competitors: [],
    prompts: [prompt('P', { searchVolume: 100 })],
    responses: Array.from({ length: 6 }, (_, n) => resp(`c${n}`, 'P', { brandMentioned: true, brandRecommended: true, ownedCited: true, provider: n % 2 ? 'gemini' : 'openai' })),
    mentions: Array.from({ length: 6 }, (_, n) => men(`c${n}`, 'P', 'brand', 'brand')),
    citations: Array.from({ length: 6 }, (_, n) => cit(`c${n}`, 'P', 'acme.com', 'own')),
  })
  eq(buildOpportunities(clean), [], 'clean dataset fires nothing')
  eq(buildOpportunities(base({})), [], 'empty dataset fires nothing')
  eq(buildOpportunities(base({ prompts: [prompt('P')] })), [], 'prompt with no responses fires nothing')
}

// missing_brand_mention
{
  const ds = base({
    prompts: [prompt('M', { searchVolume: 1000, priority: 'high' })],
    responses: [resp('1', 'M'), resp('2', 'M'), resp('3', 'M'), resp('4', 'M')],
    mentions: [men('1', 'M', 'competitor', 'c1'), men('2', 'M', 'competitor', 'c1'), men('3', 'M', 'competitor', 'c1')],
  })
  const ops = buildOpportunities(ds)
  const o = find(ops, 'missing_brand_mention', 'M')!
  eq(o !== undefined, true, 'missing_brand_mention fires')
  eq(o.promptId, 'M', 'promptId')
  eq(o.competitorId, 'c1', 'top competitor')
  eq(o.score, scoreOpportunity(0.75, 'high', 1000, 1000), 'score uses share of responses mentioning a competitor')
  eq(o.score, 87.5, 'score value')
  eq(o.priority, 'high', 'score >= 70 -> high')
  eq(o.confidence, 'medium', '4 responses -> medium')
  eq(o.evidence.responses, 4, 'evidence responses')
  eq(o.evidence.competitorResponses, 3, 'evidence competitor responses')
  eq(o.evidence.competitor, 'Rival', 'evidence competitor name')
  eq(/Rival/.test(o.detail) && /3/.test(o.detail) && /4/.test(o.detail), true, 'detail quotes numbers and competitor')
  // brand mentioned once -> no longer missing
  const ds2 = { ...ds, responses: [resp('1', 'M', { brandMentioned: true }), ...ds.responses.slice(1)] }
  eq(has(buildOpportunities(ds2), 'missing_brand_mention'), false, 'brand mentioned -> not missing')
  // no competitor mentioned -> not fired
  eq(has(buildOpportunities({ ...ds, mentions: [] }), 'missing_brand_mention'), false, 'no competitor mention -> not fired')
}

// citation_gap
{
  const ds = base({
    prompts: [prompt('G')],
    responses: [resp('1', 'G'), resp('2', 'G')],
    citations: [cit('1', 'G', 'rival.com', 'competitor')],
  })
  const o = find(buildOpportunities(ds), 'citation_gap', 'G')!
  eq(o !== undefined, true, 'citation_gap fires')
  eq(o.evidence.competitorCitingResponses, 1, 'evidence')
  eq(o.score, scoreOpportunity(0.5, 'medium', null, null), 'strength 0.5')
  eq(o.confidence, 'low', '2 responses -> low')
  // an own citation anywhere on the prompt cancels the gap
  eq(has(buildOpportunities({ ...ds, citations: [...ds.citations, cit('2', 'G', 'acme.com', 'own')] }), 'citation_gap'), false, 'own cited -> no gap')
  eq(has(buildOpportunities({ ...ds, responses: [resp('1', 'G'), resp('2', 'G', { ownedCited: true })] }), 'citation_gap'), false, 'ownedCited flag cancels the gap')
  eq(has(buildOpportunities({ ...ds, citations: [cit('1', 'G', 'news.com', 'external')] }), 'citation_gap'), false, 'external only -> no gap')
}

// recommendation_gap
{
  const ds = base({
    prompts: [prompt('R')],
    responses: [resp('1', 'R', { brandMentioned: true, ownedCited: true }), resp('2', 'R')],
    mentions: [
      men('1', 'R', 'brand', 'brand'),
      men('1', 'R', 'competitor', 'c1', { recommended: true }),
      men('2', 'R', 'competitor', 'c1', { recommended: true }),
    ],
    citations: [cit('1', 'R', 'acme.com', 'own')],
  })
  const ops = buildOpportunities(ds)
  const o = find(ops, 'recommendation_gap', 'R')!
  eq(o !== undefined, true, 'recommendation_gap fires')
  eq(o.score, scoreOpportunity(1, 'medium', null, null), 'strength = (2-0)/2')
  eq(o.evidence.competitorRecommended, 2, 'evidence competitorRecommended')
  eq(o.evidence.brandRecommended, 0, 'evidence brandRecommended')
  // brand recommended as often -> no gap
  const even = { ...ds, responses: [resp('1', 'R', { brandMentioned: true, brandRecommended: true, ownedCited: true }), resp('2', 'R', { brandRecommended: true })] }
  eq(has(buildOpportunities(even), 'recommendation_gap'), false, 'brand recommended as often -> no gap')
}

// unlinked_mention
{
  const ds = base({
    competitors: [],
    prompts: [prompt('U')],
    responses: [resp('1', 'U', { brandMentioned: true }), resp('2', 'U', { brandMentioned: true }), resp('3', 'U')],
  })
  const o = find(buildOpportunities(ds), 'unlinked_mention', 'U')!
  eq(o !== undefined, true, 'unlinked_mention fires')
  near(o.score, scoreOpportunity(2 / 3, 'medium', null, null), 'strength = brand mention rate')
  eq(o.evidence.brandMentions, 2, 'evidence')
  const linked = { ...ds, responses: [resp('1', 'U', { brandMentioned: true, ownedCited: true }), ...ds.responses.slice(1)] }
  eq(has(buildOpportunities(linked), 'unlinked_mention'), false, 'own domain cited -> not unlinked')
  eq(has(buildOpportunities({ ...ds, responses: [resp('3', 'U')] }), 'unlinked_mention'), false, 'brand never mentioned -> not fired')
}

// source_to_pitch
{
  const ds = base({
    competitors: [],
    prompts: [prompt('S1'), prompt('S2')],
    responses: [resp('1', 'S1'), resp('2', 'S2'), resp('3', 'S2'), resp('4', 'S2')],
    citations: [
      cit('1', 'S1', 'news.com', 'external'), cit('2', 'S2', 'news.com', 'external'),
      cit('3', 'S2', 'once.com', 'external'),
      cit('4', 'S2', 'acme.com', 'own'), cit('4', 'S2', 'rival.com', 'competitor'),
    ],
  })
  const ops = buildOpportunities(ds)
  const o = find(ops, 'source_to_pitch', 'news.com')!
  eq(o !== undefined, true, 'source_to_pitch fires for external domain cited in 2 responses')
  eq(o.domain, 'news.com', 'domain')
  eq(o.promptId, null, 'no prompt')
  eq(o.evidence.citingResponses, 2, 'evidence citing responses')
  eq(o.score, scoreOpportunity(2 / 4, null, null, null), 'strength = 2 / 4 responses with citations')
  eq(has(ops, 'source_to_pitch', 'once.com'), false, 'single citation does not fire')
  eq(has(ops, 'source_to_pitch', 'acme.com'), false, 'own domain not pitched')
  eq(has(ops, 'source_to_pitch', 'rival.com'), false, 'competitor domain not pitched')
  eq(/ลองพิจารณา/.test(o.suggestedAction) && /news\.com/.test(o.suggestedAction), true, 'action mentions outreach/link on the site')
}

// weak_platform
{
  const mk = (openaiHits: number, geminiHits: number, n = 5): Dataset => base({
    competitors: [],
    prompts: [prompt('W')],
    responses: [
      ...Array.from({ length: n }, (_, i) => resp(`o${i}`, 'W', { provider: 'openai' as ProviderKey, brandMentioned: i < openaiHits, ownedCited: true })),
      ...Array.from({ length: n }, (_, i) => resp(`g${i}`, 'W', { provider: 'gemini' as ProviderKey, brandMentioned: i < geminiHits, ownedCited: true })),
    ],
  })
  const ops = buildOpportunities(mk(4, 0))
  const o = find(ops, 'weak_platform', 'gemini')!
  eq(o !== undefined, true, 'weak_platform fires for gemini')
  eq(has(ops, 'weak_platform', 'openai'), false, 'strong provider does not fire')
  near(o.score, scoreOpportunity(0.8, null, null, null), 'strength = gap 0.8')
  eq(o.evidence.responses, 5, 'evidence responses')
  eq(o.evidence.gap, 0.8, 'evidence gap')
  eq(o.confidence, 'medium', '5 responses -> medium')
  eq(has(buildOpportunities(mk(4, 3)), 'weak_platform', 'gemini'), true, 'gap of exactly 0.2 fires')
  eq(has(buildOpportunities(mk(4, 4)), 'weak_platform'), false, 'equal rates -> no fire')
  eq(has(buildOpportunities(mk(3, 0, 4)), 'weak_platform'), false, 'fewer than 5 responses per provider -> no fire')
  const few = mk(5, 0)
  eq(has(buildOpportunities({ ...few, responses: few.responses.filter((r) => r.provider === 'gemini' || r.id < 'o3') }), 'weak_platform'), false, 'other providers need 5 responses too')
}

// stable keys across scans, sort order, wording
{
  const scan1 = base({
    prompts: [prompt('M', { searchVolume: 1000, priority: 'high' }), prompt('L', { priority: 'low' })],
    responses: [resp('1', 'M'), resp('2', 'M'), resp('3', 'L'), resp('4', 'L')],
    mentions: [men('1', 'M', 'competitor', 'c1'), men('2', 'M', 'competitor', 'c1'), men('3', 'L', 'competitor', 'c1')],
  })
  const a = buildOpportunities(scan1)
  const scan2 = { ...scan1, responses: [...scan1.responses, resp('5', 'M'), resp('6', 'M')], mentions: [...scan1.mentions, men('5', 'M', 'competitor', 'c1')] }
  const b = buildOpportunities(scan2)
  eq(a.map((o) => `${o.type}:${o.key}`).sort(), b.map((o) => `${o.type}:${o.key}`).sort(), 'keys identical between scans')
  eq(a.map((o) => o.key).sort(), ['L', 'M'], 'keys are prompt ids')
  eq(a.every((o, i) => i === 0 || a[i - 1].score >= o.score), true, 'sorted by score desc')
  eq(a[0].key, 'M', 'higher priority/volume first')
  const all = [...a, ...b]
  eq(all.every((o) => !/รับประกัน|จะติดอันดับ|แน่นอน/.test(o.title + o.detail + o.suggestedAction)), true, 'no promises in wording')
  eq(all.every((o) => o.score >= 0 && o.score <= 100 && ['high', 'medium', 'low'].includes(o.priority)), true, 'score range and priority')
  eq(all.map((o) => o.priority === (o.score >= 70 ? 'high' : o.score >= 40 ? 'medium' : 'low')).every(Boolean), true, 'priority follows score thresholds')
}

console.log(`opportunities.test.ts: ${passed} assertions passed`)
