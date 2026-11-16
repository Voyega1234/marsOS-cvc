// Brand Radar queries (pure helpers): npx tsx src/lib/brand-radar/queries.test.ts
import { createRequire } from 'node:module'
import type { PromptRowDTO, PromptStats } from './types'

// queries.ts pulls in auth.ts, which uses react.cache (only exists inside Next): add a no-op stand-in.
const react = createRequire(`${process.cwd()}/`)('react') as { cache?: unknown }
if (typeof react.cache !== 'function') react.cache = <T,>(fn: T): T => fn

let passed = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`FAIL: ${msg}\n  actual:   ${a}\n  expected: ${e}`)
  passed++
}

async function main() {
const { parseFilters, sortPromptRows } = await import('./queries')
const { cleanPromptInput, cleanPromptPatch } = await import('./prompt-input')
const { DEFAULT_PROVIDERS, cleanCompetitorInput, cleanProfileInput } = await import('./profile-input')
const { looksLikeQuestion } = await import('./prompt-sources')

// parseFilters
const f = parseFilters(new URLSearchParams('from=2026-11-01&to=2026-11-16&country=th&language=TH&provider=gemini'))
eq(f, { from: '2026-11-01', to: '2026-11-16', country: 'TH', language: 'th', provider: 'gemini' }, 'filters normalised')
eq(parseFilters(new URLSearchParams('')), { from: '', to: '', country: 'all', language: 'all', provider: 'all' }, 'empty = all')
eq(parseFilters(new URLSearchParams('from=bad&to=2026-13-99x&provider=bogus&country=all')).provider, 'all', 'bad provider = all')
eq(parseFilters(new URLSearchParams('from=bad')).from, '', 'bad date dropped')

// sorting: null mention rate sorts last in both directions, never as 0
function row(id: string, rate: number | null, vol: number | null, priority: 'high' | 'medium' | 'low', created: string): PromptRowDTO {
  const stats: PromptStats = {
    responses: rate === null ? 0 : 10, brandMentions: 0, mentionRate: rate, brandRecommended: 0, ownedCited: 0, citationRate: null,
    topCompetitor: null, lastCollectedAt: null,
  }
  return {
    id, projectId: 'p', text: id, topic: '', intent: 'informational', journeyStage: 'awareness', country: 'TH', language: 'th',
    source: 'manual', keyword: '', searchVolume: vol, priority, status: 'ACTIVE', note: '', createdAt: created, updatedAt: created, stats,
  }
}
const rows = [
  row('a', null, 100, 'low', '2026-11-01T00:00:00Z'),
  row('b', 0, null, 'high', '2026-11-02T00:00:00Z'),
  row('c', 0.5, 500, 'medium', '2026-11-03T00:00:00Z'),
  row('d', 0.2, 50, 'high', '2026-11-04T00:00:00Z'),
]
const ids = (s: Parameters<typeof sortPromptRows>[1]) => sortPromptRows(rows, s).map((r) => r.id).join('')
eq(ids('mention_rate_asc'), 'bdca', 'asc: 0 first, null last')
eq(ids('mention_rate_desc'), 'cdba', 'desc: null still last')
eq(ids('volume_desc'), 'cadb', 'volume desc: null last')
eq(ids('priority'), 'dbca', 'priority high first then newest')
eq(ids('recent'), 'dcba', 'recent')
eq(rows.map((r) => r.id).join(''), 'abcd', 'input not mutated')

// prompt input
const d = { country: 'TH', language: 'th' }
const ok = cleanPromptInput({ text: '  best condo in bangkok  ' }, d)
eq(ok.ok && ok.value.text, 'best condo in bangkok', 'trimmed')
eq(ok.ok && ok.value.intent, 'recommendation', 'intent derived')
eq(ok.ok && ok.value.status, 'CANDIDATE', 'default status')
eq(ok.ok && ok.value.searchVolume, null, 'unknown volume stays null')
eq(cleanPromptInput({ text: '   ' }, d).ok, false, 'empty text rejected')
eq(cleanPromptInput({ text: 'x'.repeat(501) }, d).ok, false, 'too long rejected')
const vol0 = cleanPromptInput({ text: 'q one', searchVolume: 0 }, d)
eq(vol0.ok && vol0.value.searchVolume, 0, 'explicit 0 volume kept')
const volBad = cleanPromptInput({ text: 'q two', searchVolume: -5 }, d)
eq(volBad.ok && volBad.value.searchVolume, null, 'negative volume = unknown')
eq(cleanPromptPatch({ status: 'NOPE' }).ok, false, 'bad enum in patch rejected')
const patch = cleanPromptPatch({ priority: 'high' })
eq(patch.ok && Object.keys(patch.data), ['priority'], 'patch keeps only sent keys')

// profile input
eq(DEFAULT_PROVIDERS, ['openai', 'gemini', 'perplexity', 'claude', 'grok', 'deepseek', 'google_ai_mode', 'google_ai_overview'], 'default providers = all eight')
const pr = cleanProfileInput({ providers: ['claude', 'bogus', 'openai'], monthlyBudgetUsd: null, primaryDomain: 'https://www.Example.com/x' })
eq(pr.ok && pr.data.providers, ['openai', 'claude'], 'providers filtered and ordered')
eq(pr.ok && pr.data.monthlyBudgetUsd, null, 'null budget kept')
eq(pr.ok && pr.data.primaryDomain, 'example.com', 'primary domain normalised')
eq(cleanProfileInput({ country: 'ZZ' }).ok, false, 'unknown country')
eq(cleanProfileInput({ schedule: 'hourly' }).ok, false, 'unknown schedule')
eq(cleanProfileInput({ maxPromptsPerRun: 9999 }).ok, false, 'max prompts out of range')
eq(cleanProfileInput({ samplesPerPrompt: 7 }).ok, false, 'samples must be a listed option')
eq(cleanProfileInput({ samplesPerPrompt: 0 }).ok, false, 'zero samples rejected')
const s20 = cleanProfileInput({ samplesPerPrompt: 20 })
eq(s20.ok && s20.data.samplesPerPrompt, 20, '20 samples accepted')
const s10 = cleanProfileInput({ samplesPerPrompt: '10' })
eq(s10.ok && s10.data.samplesPerPrompt, 10, 'numeric string accepted')
eq(cleanProfileInput({ monthlyBudgetUsd: -1 }).ok, false, 'negative budget')
eq(Object.keys((cleanProfileInput({ industry: 'x' }) as { data: object }).data), ['industry'], 'absent keys stay absent')
eq(cleanCompetitorInput({ name: ' ' }).ok, false, 'competitor name required')

// question detection (GSC source)
eq(looksLikeQuestion('how to choose a condo'), true, 'english how')
eq(looksLikeQuestion('คอนโดไหนดี ราคาเท่าไหร่'), true, 'thai question')
eq(looksLikeQuestion('condo bangkok'), false, 'plain keyword is not a question')

console.log(`queries.test.ts: ${passed} assertions passed`)
process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
