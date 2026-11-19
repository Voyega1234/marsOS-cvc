// Brand Radar providers (pure parts): npx tsx src/lib/brand-radar/providers.test.ts
import {
  modelFor, parseAiModeResponse, parseLlmScraperResponse, scraperKeyword, dfsListPrice, requiredEnv, hasCredentials,
  providerStatuses, DEFAULT_MODELS, DFS_LIST_PRICE,
} from './providers'
import { extractSearchQueries } from '../openrouter'

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
delete process.env.BRAND_RADAR_MODEL_PERPLEXITY
eq(modelFor('perplexity'), DEFAULT_MODELS.perplexity, 'default model')
eq(modelFor('perplexity'), 'perplexity/sonar', 'default perplexity slug')
// ChatGPT and Gemini are read from the real apps: no model slug, and no env override can reintroduce one
process.env.BRAND_RADAR_MODEL_OPENAI = 'openai/custom'
eq(modelFor('openai'), '', 'openai has no OpenRouter model')
eq(modelFor('gemini'), '', 'gemini has no OpenRouter model')
eq('openai' in DEFAULT_MODELS || 'gemini' in DEFAULT_MODELS, false, 'no default models for scraper keys')
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
eq(DFS_LIST_PRICE, { google_ai_mode: 0.004, google_ai_overview: 0.004, openai: 0.004, gemini: 0.004 }, 'dfs fallback prices')
for (const k of ['google_ai_mode', 'google_ai_overview', 'openai', 'gemini'] as const) eq(dfsListPrice(k), 0.004, `list price ${k}`)
for (const k of ['perplexity', 'claude', 'grok', 'deepseek'] as const) eq(dfsListPrice(k), null, `no list price ${k}`)
for (const k of ['openai', 'gemini'] as const) eq(requiredEnv(k), ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'], `${k} needs DataForSEO, not OpenRouter`)
eq(requiredEnv('claude'), ['OPENROUTER_API_KEY'], 'claude still needs OpenRouter')

// ChatGPT scraper
const gptFixture = {
  tasks: [{
    status_code: 20000, cost: 0.004,
    result: [{
      model: 'gpt-6',
      markdown: 'Top picks:\n\n1\\. **Acme** ([acme.com](https://acme.com/a?utm_source=chatgpt.com#:~:text=best%20pick))\n\n![logo](https://cdn.x/logo.png)\n\n\n\n\n2\\. Beta https://beta.io/p?x=1&utm_source=chatgpt.com',
      sources: [
        { title: 'Acme', url: 'https://acme.com/a?utm_source=chatgpt.com#:~:text=best' },
        { title: 'Acme again', url: 'https://www.acme.com/a/' },
        { title: 'Mail', url: 'mailto:x@y.z' },
        { title: 'Beta', url: 'https://beta.io/p' },
      ],
      search_results: [
        { url: 'https://WWW.Acme.com/a/?utm_medium=x#frag', title: 'cited variant' },
        { url: 'https://gamma.org/g', title: 'Gamma' },
        { url: 'https://gamma.org/g/', title: 'Gamma dup' },
        { url: 'ftp://nope.org/x', title: 'ftp' },
        { url: 'https://delta.net/', title: 'Delta' },
      ],
      fan_out_queries: [' best crm ', 'best crm', '', 'crm pricing', 7],
    }],
  }],
}
const gpt = parseLlmScraperResponse(gptFixture, 'openai', 'ChatGPT')
eq(gpt.status, 'DONE', 'chatgpt done')
eq(gpt.model, 'gpt-6', 'chatgpt model')
eq(gpt.costUsd, 0.004, 'chatgpt cost')
eq(gpt.citations, [{ url: 'https://acme.com/a', title: 'Acme' }, { url: 'https://beta.io/p', title: 'Beta' }], 'chatgpt citations cleaned, deduped, http(s) only')
eq(gpt.foundSources, [{ url: 'https://gamma.org/g', title: 'Gamma' }, { url: 'https://delta.net/', title: 'Delta' }], 'found sources exclude cited pages (www/utm/fragment variant)')
eq(gpt.searchQueries, ['best crm', 'crm pricing'], 'chatgpt search queries trimmed and deduped')
eq(gpt.text, 'Top picks:\n\n1. **Acme** ([acme.com](https://acme.com/a))\n\n2. Beta https://beta.io/p?x=1', 'chatgpt text cleaned')
eq(gpt.text.includes('![') || gpt.text.includes('utm_') || gpt.text.includes('#:~:'), false, 'no image, utm or fragment left')
const manyFound = parseLlmScraperResponse({ tasks: [{ status_code: 20000, cost: 0, result: [{
  markdown: 'x',
  search_results: Array.from({ length: 80 }, (_, i) => ({ url: `https://s${i}.com/`, title: `S${i}` })),
  fan_out_queries: Array.from({ length: 30 }, (_, i) => `q${i}`),
}] }] }, 'openai', 'ChatGPT')
eq(manyFound.foundSources.length, 50, 'found sources capped at 50')
eq(manyFound.searchQueries.length, 20, 'search queries capped at 20')

// Gemini scraper: never invents found sources or queries
const gem = parseLlmScraperResponse({ tasks: [{ status_code: 20000, cost: 0.004, result: [{
  model: 'Fast',
  markdown: 'Answer about Acme.\n\nMore.\n\nWant a comparison? -> Compare the top three for me',
  sources: [{ title: 'Acme', url: 'https://acme.com/' }],
  search_results: [{ url: 'https://other.com/', title: 'Other' }],
  fan_out_queries: ['should be ignored'],
}] }] }, 'gemini', 'Google Gemini')
const gemKeep = parseLlmScraperResponse({ tasks: [{ status_code: 20000, cost: 0.004, result: [{
  model: 'Fast',
  markdown: 'Answer about Acme.\n\nSetup goes Settings -> Billing and then you are done.',
}] }] }, 'gemini', 'Google Gemini')
eq(gemKeep.text, 'Answer about Acme.\n\nSetup goes Settings -> Billing and then you are done.', 'normal last sentence with an arrow is kept')
eq(gem.status, 'DONE', 'gemini done')
eq(gem.model, 'Fast', 'gemini model')
eq(gem.foundSources, [], 'gemini found sources always empty')
eq(gem.searchQueries, [], 'gemini search queries always empty')
eq(gem.citations, [{ url: 'https://acme.com/', title: 'Acme' }], 'gemini citations')
eq(gem.text, 'Answer about Acme.\n\nMore.', 'gemini follow-up suggestion line stripped')

// errors and empty answers
let scraperThrew: unknown = null
try { parseLlmScraperResponse({ tasks: [{ status_code: 40501, status_message: 'bad', cost: 0.002 }] }, 'openai', 'ChatGPT') } catch (e) { scraperThrew = e }
eq((scraperThrew as { name?: string })?.name, 'ProviderError', 'scraper task error throws ProviderError')
eq((scraperThrew as { costUsd?: number })?.costUsd, 0.002, 'scraper error carries cost')
let noTask = false
try { parseLlmScraperResponse({}, 'gemini', 'Google Gemini') } catch { noTask = true }
eq(noTask, true, 'scraper no task throws')
const empty = parseLlmScraperResponse({ tasks: [{ status_code: 20000, cost: 0.004, result: [{ model: 'gpt-6', markdown: '  ', sources: [{ url: 'https://a.com/' }] }] }] }, 'openai', 'ChatGPT')
eq(empty.status, 'SKIPPED', 'empty markdown skipped')
eq(empty.citations, [], 'skipped has no citations')
eq(empty.costUsd, 0.004, 'skipped keeps cost')
eq(/^ChatGPT returned an empty answer/.test(empty.error || ''), true, 'skipped explains')

// scraperKeyword
eq(scraperKeyword('100% real + more'), '100%25 real %2B more', 'keyword escapes % and +')
eq(scraperKeyword('เครื่องฟอกอากาศ'), 'เครื่องฟอกอากาศ', 'thai text unchanged')
eq(scraperKeyword('a'.repeat(3000)).length, 2000, 'keyword capped at 2000')
const capped = scraperKeyword('%'.repeat(1000))
eq(capped.length, 1998, 'escape never cut in half')
eq(/^(%25)+$/.test(capped), true, 'capped keyword is whole escapes')
eq(scraperKeyword('a'.repeat(1999) + '+'), 'a'.repeat(1999), 'escape that would cross the limit is dropped')

// status derivation
const saveOr = process.env.OPENROUTER_API_KEY
const saveL = process.env.DATAFORSEO_LOGIN
const saveP = process.env.DATAFORSEO_PASSWORD
delete process.env.OPENROUTER_API_KEY
delete process.env.DATAFORSEO_LOGIN
delete process.env.DATAFORSEO_PASSWORD
let s = providerStatuses('{}', ['openai'])
eq(hasCredentials('openai'), false, 'openai needs DataForSEO creds')
eq(s.every((x) => x.connection === 'NOT_CONNECTED'), true, 'no env = NOT_CONNECTED')
eq(s.find((x) => x.key === 'openai')!.enabled, true, 'enabled flag')
eq(s.find((x) => x.key === 'gemini')!.enabled, false, 'not enabled')
eq(s.find((x) => x.key === 'google_ai_mode')!.requiredEnv, ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'], 'ai mode env names')
process.env.OPENROUTER_API_KEY = 'x'
s = providerStatuses('{}', [])
eq(s.find((x) => x.key === 'claude')!.connection, 'UNTESTED', 'untested')
eq(s.find((x) => x.key === 'openai')!.connection, 'NOT_CONNECTED', 'openai does not ride the openrouter key')
eq(s.find((x) => x.key === 'gemini')!.connection, 'NOT_CONNECTED', 'gemini does not ride the openrouter key')
eq(s.find((x) => x.key === 'google_ai_mode')!.connection, 'NOT_CONNECTED', 'ai mode still not connected')
eq(s.find((x) => x.key === 'google_ai_overview')!.connection, 'NOT_CONNECTED', 'ai overview still not connected')
eq(s.find((x) => x.key === 'deepseek')!.connection, 'UNTESTED', 'deepseek rides openrouter key')
s = providerStatuses(JSON.stringify({ claude: { ok: true, testedAt: 't' }, grok: { ok: false, error: 'boom', testedAt: 't2' } }), [])
eq(s.find((x) => x.key === 'claude')!.connection, 'CONNECTED', 'connected')
eq(s.find((x) => x.key === 'grok')!.connection, 'ERROR', 'error')
eq(s.find((x) => x.key === 'grok')!.error, 'boom', 'error text')
process.env.DATAFORSEO_LOGIN = 'l'
process.env.DATAFORSEO_PASSWORD = 'p'
s = providerStatuses('{}', [])
eq(s.find((x) => x.key === 'openai')!.connection, 'UNTESTED', 'openai connects through DataForSEO creds')
eq(s.find((x) => x.key === 'gemini')!.model, '', 'gemini status shows no model')
delete process.env.DATAFORSEO_LOGIN
delete process.env.DATAFORSEO_PASSWORD
eq(providerStatuses('not json', []).length, 8, 'bad json tolerated, all eight listed')
if (saveOr === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = saveOr
if (saveL !== undefined) process.env.DATAFORSEO_LOGIN = saveL
if (saveP !== undefined) process.env.DATAFORSEO_PASSWORD = saveP

// extractSearchQueries (lives in openrouter.ts, used by the OpenAI/Claude Responses API path)
const sq = (action: unknown) => ({ type: 'web_search_call', action })
eq(extractSearchQueries(null), [], 'search queries: non-array')
eq(extractSearchQueries('x'), [], 'search queries: string')
eq(extractSearchQueries([]), [], 'search queries: empty')
eq(extractSearchQueries([null, 5, {}, { action: null }, sq({ type: 'open_page', query: 'no' })]), [], 'search queries: non-search items ignored')
eq(extractSearchQueries([sq({ type: 'search', query: 'best crm' })]), ['best crm'], 'search queries: single query (Anthropic shape)')
eq(extractSearchQueries([sq({ type: 'search', query: 'a', queries: ['a', 'b'] })]), ['a', 'b'], 'search queries: queries[] preferred over query')
eq(extractSearchQueries([sq({ type: 'search', query: 'Best  CRM' }), sq({ type: 'search', query: 'best crm' })]), ['Best CRM'], 'search queries: deduped case-insensitively, whitespace collapsed')
eq(extractSearchQueries([sq({ type: 'search', queries: ['a', 7, '  ', 'b'] })]), ['a', 'b'], 'search queries: non-string and blank dropped')
eq(extractSearchQueries([sq({ type: 'search', queries: ['a', 'b', 'c'] })], 2), ['a', 'b'], 'search queries: max cap')
eq(extractSearchQueries([sq({ type: 'search', query: 'x'.repeat(50) })], 20, 10), ['x'.repeat(10)], 'search queries: maxLen cap')

console.log(`providers.test.ts: ${passed} checks passed`)
