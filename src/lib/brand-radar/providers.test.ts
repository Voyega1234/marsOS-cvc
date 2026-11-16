// Brand Radar providers (pure parts): npx tsx src/lib/brand-radar/providers.test.ts
import { modelFor, parseAiModeResponse, providerStatuses, DEFAULT_MODELS, DFS_LIST_PRICE } from './providers'

let passed = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`FAIL: ${msg}\n  actual:   ${a}\n  expected: ${e}`)
  passed++
}

const fixture = {
  status_code: 20000,
  tasks: [{
    status_code: 20000, cost: 0.004,
    result: [{ items: [
      { type: 'organic', title: 'x' },
      { type: 'ai_overview', markdown: 'Acme is a good pick.', references: [{ url: 'https://a.com/1', title: 'A' }],
        items: [{ type: 'ai_overview_element', text: 'more', references: [{ url: 'https://b.com/2', title: 'B' }], links: [{ url: 'https://c.com/3' }] }] },
    ] }],
  }],
}
const p = parseAiModeResponse(fixture)
eq(p.status, 'DONE', 'ai mode done')
eq(p.text, 'Acme is a good pick.', 'ai mode text')
eq(p.costUsd, 0.004, 'ai mode cost')
eq(p.citations.map((c) => c.url), ['https://a.com/1', 'https://b.com/2', 'https://c.com/3'], 'ai mode citations')

const noAnswer = parseAiModeResponse({ tasks: [{ status_code: 20000, cost: 0.004, result: [{ items: [{ type: 'organic' }] }] }] })
eq(noAnswer.status, 'SKIPPED', 'no ai_overview skipped')
eq(noAnswer.text, '', 'skipped text empty')
eq(noAnswer.costUsd, 0.004, 'skipped cost kept')
eq(/no answer/.test(noAnswer.error || ''), true, 'skipped explains')

// fallback: no markdown, join nested text
const fb = parseAiModeResponse({ tasks: [{ status_code: 20000, cost: 0, result: [{ items: [{ type: 'ai_overview', items: [{ text: 'one' }, { text: 'two' }] }] }] }] })
eq(fb.text, 'one\n\ntwo', 'fallback joins nested text')

let threw = false
try { parseAiModeResponse({ tasks: [{ status_code: 40501, status_message: 'bad loc', cost: 0 }] }) } catch { threw = true }
eq(threw, true, 'task error throws')

// model env override
delete process.env.BRAND_RADAR_MODEL_OPENAI
eq(modelFor('openai'), DEFAULT_MODELS.openai, 'default model')
eq(modelFor('openai'), 'openai/gpt-5.6-luna', 'default openai slug')
eq(modelFor('perplexity'), 'perplexity/sonar', 'default perplexity slug')
process.env.BRAND_RADAR_MODEL_OPENAI = 'openai/custom'
eq(modelFor('openai'), 'openai/custom', 'env override')
eq(modelFor('google_ai_mode'), '', 'ai mode has no model')
eq(modelFor('google_ai_overview'), '', 'ai overview has no model')
delete process.env.BRAND_RADAR_MODEL_OPENAI
delete process.env.BRAND_RADAR_MODEL_GROK
delete process.env.BRAND_RADAR_MODEL_DEEPSEEK
eq(modelFor('grok'), 'x-ai/grok-4.3', 'default grok slug')
eq(modelFor('deepseek'), 'deepseek/deepseek-v4.1-flash', 'default deepseek slug')
process.env.BRAND_RADAR_MODEL_GROK = 'x-ai/custom'
eq(modelFor('grok'), 'x-ai/custom', 'grok env override')
delete process.env.BRAND_RADAR_MODEL_GROK

// AI Overview reuses the parser with its own "no answer" wording
const aoNone = parseAiModeResponse({ tasks: [{ status_code: 20000, cost: 0.004, result: [{ items: [{ type: 'organic' }] }] }] }, 'Google AI Overview')
eq(aoNone.status, 'SKIPPED', 'ai overview absent skipped')
eq(/^Google AI Overview returned no answer/.test(aoNone.error || ''), true, 'ai overview skip names itself')
eq(DFS_LIST_PRICE, { google_ai_mode: 0.004, google_ai_overview: 0.004 }, 'dfs fallback prices')

// status derivation
const saveOr = process.env.OPENROUTER_API_KEY
const saveL = process.env.DATAFORSEO_LOGIN
const saveP = process.env.DATAFORSEO_PASSWORD
delete process.env.OPENROUTER_API_KEY
delete process.env.DATAFORSEO_LOGIN
delete process.env.DATAFORSEO_PASSWORD
let s = providerStatuses('{}', ['openai'])
eq(s.every((x) => x.connection === 'NOT_CONNECTED'), true, 'no env = NOT_CONNECTED')
eq(s.find((x) => x.key === 'openai')!.enabled, true, 'enabled flag')
eq(s.find((x) => x.key === 'gemini')!.enabled, false, 'not enabled')
eq(s.find((x) => x.key === 'google_ai_mode')!.requiredEnv, ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'], 'ai mode env names')
process.env.OPENROUTER_API_KEY = 'x'
s = providerStatuses('{}', [])
eq(s.find((x) => x.key === 'openai')!.connection, 'UNTESTED', 'untested')
eq(s.find((x) => x.key === 'google_ai_mode')!.connection, 'NOT_CONNECTED', 'ai mode still not connected')
eq(s.find((x) => x.key === 'google_ai_overview')!.connection, 'NOT_CONNECTED', 'ai overview still not connected')
eq(s.find((x) => x.key === 'deepseek')!.connection, 'UNTESTED', 'deepseek rides openrouter key')
s = providerStatuses(JSON.stringify({ openai: { ok: true, testedAt: 't' }, gemini: { ok: false, error: 'boom', testedAt: 't2' } }), [])
eq(s.find((x) => x.key === 'openai')!.connection, 'CONNECTED', 'connected')
eq(s.find((x) => x.key === 'gemini')!.connection, 'ERROR', 'error')
eq(s.find((x) => x.key === 'gemini')!.error, 'boom', 'error text')
eq(providerStatuses('not json', []).length, 8, 'bad json tolerated, all eight listed')
if (saveOr === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = saveOr
if (saveL !== undefined) process.env.DATAFORSEO_LOGIN = saveL
if (saveP !== undefined) process.env.DATAFORSEO_PASSWORD = saveP

console.log(`providers.test.ts: ${passed} checks passed`)
