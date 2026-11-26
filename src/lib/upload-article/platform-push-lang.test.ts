import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { pushWixLang, pushWebflowLang, customLangPublish } from './platform-push-lang'
import { publishToSite, type PublishPayload } from '../sitePublishers'
import { pushArticleToWebflow, type WebflowPushInput } from './webflow-push'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

interface Call { url: string; method: string; body: string }
type Handler = (c: Call) => Response | undefined

function stub(handlers: Handler[]) {
  const calls: Call[] = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const c: Call = { url: String(url), method: (init?.method ?? 'GET').toUpperCase(), body: typeof init?.body === 'string' ? init.body : '' }
    calls.push(c)
    for (const h of handlers) {
      const r = h(c)
      if (r) return r
    }
    return new Response(JSON.stringify({ message: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return calls
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const body = (c: Call) => JSON.parse(c.body || '{}')
const writes = (calls: Call[]) => calls.filter(c => c.method !== 'GET')

// ── Wix ──
const WIX = 'https://www.wixapis.com'
const wixCfg = { apiKey: 'k', siteId: 's', memberId: 'm' }
const wixPayload = (over: Partial<PublishPayload> = {}): PublishPayload => ({ title: 'T', html: '<p>x</p>', publishMode: 'publish', ...over })
const propsOk = (extra: Record<string, unknown> = {}) => (c: Call) =>
  c.method === 'GET' && c.url === `${WIX}/site-properties/v4/properties`
    ? json({ properties: { language: 'en', multilingual: { supportedLanguages: [{ languageCode: 'en', isPrimary: true }, { languageCode: 'th', isPrimary: false, resolutionMethod: 'SUBDIRECTORY', ...extra }] } } })
    : undefined
const draftCreate = (id = 'd1') => (c: Call) => (c.method === 'POST' && c.url === `${WIX}/blog/v3/draft-posts` ? json({ draftPost: { id } }) : undefined)
const draftGet = (id: string, language: string | undefined) => (c: Call) =>
  c.method === 'GET' && c.url === `${WIX}/blog/v3/draft-posts/${id}` ? json({ draftPost: { id, language } }) : undefined
const draftPublish = (id: string) => (c: Call) => (c.method === 'POST' && c.url === `${WIX}/blog/v3/draft-posts/${id}/publish` ? json({}) : undefined)
const postGet = (id: string, url: unknown) => (c: Call) => (c.method === 'GET' && c.url.startsWith(`${WIX}/blog/v3/posts/${id}`) ? json({ post: { url } }) : undefined)

test('W1 preflight 403 -> error, zero writes', async () => {
  const calls = stub([(c) => (c.url.includes('site-properties') ? json({}, 403) : undefined)])
  const r = await pushWixLang(wixCfg, wixPayload(), { lang: 'th' })
  assert.equal(r.ok, false)
  assert.match(r.error!, /HTTP 403/)
  assert.equal(writes(calls).length, 0)
})

test('W2 language missing -> error, zero writes', async () => {
  const calls = stub([(c) => (c.url.includes('site-properties') ? json({ properties: { multilingual: { supportedLanguages: [{ languageCode: 'en', isPrimary: true }] } } }) : undefined)])
  const r = await pushWixLang(wixCfg, wixPayload(), { lang: 'th' })
  assert.equal(r.ok, false)
  assert.match(r.error!, /ยังไม่มีภาษา \/th/)
  assert.equal(writes(calls).length, 0)
})

test('W3 language is primary -> error', async () => {
  const calls = stub([(c) => (c.url.includes('site-properties') ? json({ properties: { language: 'th', multilingual: { supportedLanguages: [{ languageCode: 'th-TH', isPrimary: true }, { languageCode: 'en', isPrimary: false }] } } }) : undefined)])
  const r = await pushWixLang(wixCfg, wixPayload(), { lang: 'th' })
  assert.equal(r.ok, false)
  assert.match(r.error!, /ภาษาหลัก/)
  assert.equal(writes(calls).length, 0)
})

test('W4 new: draft with language, read-back, publish, langRecord', async () => {
  const calls = stub([propsOk(), draftCreate('d1'), draftGet('d1', 'th'), draftPublish('d1'), postGet('d1', { base: 'https://x.com/', path: '/th/post' })])
  const r = await pushWixLang(wixCfg, wixPayload(), { lang: 'th' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.langRecord, { lang: 'th', mode: 'platform', postId: 'd1' })
  assert.equal(r.status, 'publish')
  assert.equal(r.postUrl, 'https://x.com/th/post')
  assert.equal(r.warning, undefined)
  const create = calls.find(c => c.method === 'POST' && c.url === `${WIX}/blog/v3/draft-posts`)!
  assert.equal(body(create).draftPost.language, 'th')
  assert.equal(body(create).publish, false)
  assert.ok(calls.some(c => c.url.endsWith('/d1/publish')))
})

test('W5 read-back wrong language -> no publish, no langRecord', async () => {
  const calls = stub([propsOk(), draftCreate('d1'), draftGet('d1', 'en'), draftPublish('d1')])
  const r = await pushWixLang(wixCfg, wixPayload(), { lang: 'th' })
  assert.equal(r.ok, false)
  assert.equal(r.langRecord, undefined)
  assert.match(r.error!, /ไม่เผยแพร่/)
  assert.equal(calls.some(c => c.url.endsWith('/publish')), false)
})

test('W6 existing id with other language -> refuse, no PATCH', async () => {
  const calls = stub([propsOk(), draftGet('e1', 'en')])
  const r = await pushWixLang(wixCfg, wixPayload(), { lang: 'th', existingId: 'e1' })
  assert.equal(r.ok, false)
  assert.match(r.error!, /ไม่ push ทับ/)
  assert.equal(writes(calls).length, 0)
})

test('W7 existing id 404 on read -> creates new', async () => {
  const calls = stub([propsOk(), draftCreate('d2'), draftGet('d2', 'th'), draftPublish('d2'), postGet('d2', 'https://x.com/th/a')])
  const r = await pushWixLang(wixCfg, wixPayload(), { lang: 'th', existingId: 'gone' })
  assert.equal(r.ok, true)
  assert.equal(r.postId, 'd2')
  assert.ok(calls.some(c => c.method === 'POST' && c.url === `${WIX}/blog/v3/draft-posts`))
})

test('W8 existing same language -> single PATCH without language, no create', async () => {
  const calls = stub([
    propsOk(), draftGet('e1', 'th'),
    (c) => (c.method === 'PATCH' && c.url === `${WIX}/blog/v3/draft-posts/e1` ? json({ draftPost: { id: 'e1' } }) : undefined),
    postGet('e1', 'https://x.com/th/a'),
  ])
  const r = await pushWixLang(wixCfg, wixPayload(), { lang: 'th', existingId: 'e1' })
  assert.equal(r.ok, true)
  assert.equal(r.postId, 'e1')
  const w = writes(calls)
  assert.equal(w.length, 1)
  assert.equal(w[0].method, 'PATCH')
  assert.equal('language' in body(w[0]).draftPost, false)
  assert.equal(body(w[0]).action, 'UPDATE_PUBLISH')
})

test('W9 strictExisting PATCH 404 -> error, no create', async () => {
  const calls = stub([])
  const r = await publishToSite('wix', { wix: wixCfg }, { ...wixPayload(), existingId: 'e1', strictExisting: true })
  assert.equal(r.ok, false)
  assert.match(r.error!, /404/)
  assert.equal(calls.some(c => c.method === 'POST'), false)
})

test('W10 publishMode draft -> no publish call', async () => {
  const calls = stub([propsOk(), draftCreate('d1'), draftGet('d1', 'th')])
  const r = await pushWixLang(wixCfg, wixPayload({ publishMode: 'draft' }), { lang: 'th' })
  assert.equal(r.ok, true)
  assert.equal(r.status, 'draft')
  assert.equal(calls.some(c => c.url.endsWith('/publish')), false)
})

test('W11 wixPublish without language: create body has no language key', async () => {
  const calls = stub([draftCreate('d1')])
  const r = await publishToSite('wix', { wix: wixCfg }, wixPayload({ publishMode: 'draft' }))
  assert.equal(r.ok, true)
  const create = calls.find(c => c.method === 'POST')!
  assert.equal('language' in body(create).draftPost, false)
})

// ── Webflow ──
const WF = 'https://api.webflow.com/v2'
const CID = 'a'.repeat(24)
const IID = 'b'.repeat(24)
const LOC = 'c'.repeat(24)
const wfCfg = { apiToken: 't', siteId: 'site1', collectionId: CID, collectionSlug: 'blog', siteUrl: 'example.com', bodyField: 'post-body' }
const wfInput = (over: Partial<WebflowPushInput> = {}): WebflowPushInput => ({ title: 'T', html: '<p>x</p>', slug: 'my-post', publishMode: 'publish', ...over })
const siteOk = (secondary: unknown[] = [{ cmsLocaleId: LOC, enabled: true, subdirectory: 'th', tag: 'th-TH' }], primary: unknown = { cmsLocaleId: 'p', subdirectory: '', tag: 'en-US' }) =>
  (c: Call) => (c.method === 'GET' && c.url === `${WF}/sites/site1` ? json({ locales: { primary, secondary } }) : undefined)
const itemGet = (id: string, loc?: string) => (c: Call) =>
  c.method === 'GET' && c.url.startsWith(`${WF}/collections/${CID}/items/${id}`) ? json({ id, ...(loc ? { cmsLocaleId: loc } : {}), fieldData: { slug: 'my-post' } }) : undefined
const itemCreate = (c: Call) => (c.method === 'POST' && c.url === `${WF}/collections/${CID}/items` ? json({ id: IID, fieldData: { slug: 'my-post' } }) : undefined)
const itemPublish = (c: Call) => (c.method === 'POST' && c.url === `${WF}/collections/${CID}/items/publish` ? json({ publishedItemIds: [IID] }) : undefined)

test('F1 sites 403 -> error, zero writes and zero asset uploads', async () => {
  const calls = stub([(c) => (c.url === `${WF}/sites/site1` ? json({}, 403) : undefined)])
  const png = Buffer.from('abc').toString('base64')
  const r = await pushWebflowLang(wfCfg, wfInput({ coverBase64: png }), { lang: 'th' })
  assert.equal(r.ok, false)
  assert.match(r.error!, /sites:read/)
  assert.equal(writes(calls).length, 0)
  assert.equal(calls.some(c => c.url.includes('/assets')), false)
})

test('F2 no th locale -> error', async () => {
  const calls = stub([siteOk([{ cmsLocaleId: 'x', enabled: true, subdirectory: 'fr', tag: 'fr' }])])
  const r = await pushWebflowLang(wfCfg, wfInput(), { lang: 'th' })
  assert.equal(r.ok, false)
  assert.match(r.error!, /ยังไม่มีภาษา \/th/)
  assert.equal(writes(calls).length, 0)
})

test('F3 th primary -> error', async () => {
  const calls = stub([siteOk([], { cmsLocaleId: 'p', subdirectory: '', tag: 'th-TH' })])
  const r = await pushWebflowLang(wfCfg, wfInput(), { lang: 'th' })
  assert.equal(r.ok, false)
  assert.match(r.error!, /ภาษาหลัก/)
  assert.equal(writes(calls).length, 0)
})

test('F4 new publish: staged create with cmsLocaleId, read-back, publish body, url under /th/', async () => {
  const calls = stub([siteOk(), itemCreate, itemGet(IID, LOC), itemPublish])
  const r = await pushWebflowLang(wfCfg, wfInput(), { lang: 'th' })
  assert.equal(r.ok, true)
  assert.equal(r.status, 'publish')
  assert.deepEqual(r.langRecord, { lang: 'th', mode: 'platform', postId: IID })
  assert.ok(r.postUrl!.includes('/th/'))
  assert.equal(calls.some(c => c.url.includes('/live')), false)
  const create = calls.find(c => c.method === 'POST' && c.url === `${WF}/collections/${CID}/items`)!
  assert.equal(body(create).cmsLocaleId, LOC)
  assert.equal(body(create).isDraft, false)
  assert.ok(calls.some(c => c.method === 'GET' && c.url.includes(`/items/${IID}?cmsLocaleId=${LOC}`)))
  const pub = calls.find(c => c.url.endsWith('/items/publish'))!
  assert.deepEqual(body(pub), { items: [{ id: IID, cmsLocaleIds: [LOC] }] })
})

test('F5 read-back wrong locale -> ok:false, no publish', async () => {
  const calls = stub([siteOk(), itemCreate, itemGet(IID, 'other'), itemPublish])
  const r = await pushWebflowLang(wfCfg, wfInput(), { lang: 'th' })
  assert.equal(r.ok, false)
  assert.equal(r.langRecord, undefined)
  assert.equal(calls.some(c => c.url.endsWith('/items/publish')), false)
})

test('F6 existing item in other locale -> refuse, no PATCH', async () => {
  const calls = stub([siteOk(), itemGet(IID, 'other')])
  const r = await pushWebflowLang(wfCfg, wfInput({ existingItemId: IID }), { lang: 'th' })
  assert.equal(r.ok, false)
  assert.match(r.error!, /ไม่ push ทับ/)
  assert.equal(writes(calls).length, 0)
})

test('F7 PATCH 404 in lang mode -> error, no POST', async () => {
  const calls = stub([siteOk(), itemGet(IID, LOC)])
  const r = await pushWebflowLang(wfCfg, wfInput({ existingItemId: IID }), { lang: 'th' })
  assert.equal(r.ok, false)
  assert.match(r.error!, /404/)
  assert.equal(calls.some(c => c.method === 'POST'), false)
  assert.ok(calls.some(c => c.method === 'PATCH' && !c.url.includes('/live')))
})

test('F8 no lang -> original sequence (POST items/live)', async () => {
  const calls = stub([(c) => (c.method === 'POST' && c.url === `${WF}/collections/${CID}/items/live` ? json({ id: IID, fieldData: { slug: 'my-post' } }) : undefined)])
  const r = await pushArticleToWebflow(wfCfg, wfInput())
  assert.equal(r.ok, true)
  assert.equal(r.postUrl, 'https://example.com/blog/my-post')
  assert.deepEqual(calls.map(c => `${c.method} ${c.url}`), [`POST ${WF}/collections/${CID}/items/live`])
  assert.equal('cmsLocaleId' in body(calls[0]), false)
})

// ── Custom ──
const customOk = (data: Record<string, unknown>) => (c: Call) => (c.method === 'POST' && c.url === 'https://hook.example.com/p' ? json(data) : undefined)
const conn = { custom: { webhookUrl: 'https://hook.example.com/p' } }

test('C1 body contains language + pathPrefix', async () => {
  const calls = stub([customOk({ url: 'https://x.com/th/a', id: 5 })])
  const r = await customLangPublish(conn, wixPayload(), { lang: 'th' })
  assert.equal(r.ok, true)
  assert.equal(body(calls[0]).language, 'th')
  assert.equal(body(calls[0]).pathPrefix, '/th')
  assert.deepEqual(r.langRecord, { lang: 'th', mode: 'platform', postId: '5' })
})

test('C2 url under /th -> no warning', async () => {
  stub([customOk({ url: 'https://x.com/th/a' })])
  const r = await customLangPublish(conn, wixPayload(), { lang: 'th' })
  assert.equal(r.warning, undefined)
})

test('C3 unconfirmed reply (no url / url outside lang, no language echo) -> fail closed, no record', async () => {
  stub([customOk({ id: 1 })])
  const a = await customLangPublish(conn, wixPayload(), { lang: 'th' })
  assert.equal(a.ok, false)
  assert.equal(a.langRecord, undefined)
  assert.match(a.error!, /ไม่ตอบ URL/)
  stub([customOk({ url: 'https://x.com/a', id: 2 })])
  const b = await customLangPublish(conn, wixPayload(), { lang: 'th' })
  assert.equal(b.ok, false)
  assert.equal(b.langRecord, undefined)
  assert.match(b.error!, /ไม่อยู่ใต้ \/th/)
})

test('C3b language echoed -> ok with a warning when the url is missing or outside lang', async () => {
  stub([customOk({ id: 1, language: 'th' })])
  const a = await customLangPublish(conn, wixPayload(), { lang: 'th' })
  assert.equal(a.ok, true)
  assert.deepEqual(a.langRecord, { lang: 'th', mode: 'platform', postId: '1' })
  assert.match(a.warning!, /ไม่ตอบ URL/)
  stub([customOk({ url: 'https://x.com/a', language: 'th-TH' })])
  const b = await customLangPublish(conn, wixPayload(), { lang: 'th' })
  assert.equal(b.ok, true)
  assert.match(b.warning!, /ไม่อยู่ใต้ \/th/)
})

test('C3c normal push ignores an echoed language field', async () => {
  stub([customOk({ url: 'https://x.com/a', language: 'th' })])
  const r = await publishToSite('custom', conn, wixPayload())
  assert.equal(r.ok, true)
  assert.equal('language' in r, false)
})

test('C4 without language the body has no language/pathPrefix keys', async () => {
  const calls = stub([customOk({ url: 'https://x.com/a' })])
  await publishToSite('custom', conn, wixPayload())
  assert.equal('language' in body(calls[0]), false)
  assert.equal('pathPrefix' in body(calls[0]), false)
})
