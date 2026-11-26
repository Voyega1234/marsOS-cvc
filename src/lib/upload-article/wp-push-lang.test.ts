import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isUnderLangPath, pushArticleToWordPressLang, readPushLangPath } from './wp-push-lang'
import type { WpPushInput, WpPushResult } from './wp-push'
import { uploadSchemaOptions } from './build-html'

const ROOT = 'https://site.test'
const OK_NS = { namespaces: ['wp/v2', 'yoast/v1'] }
const PLL_NS = { namespaces: ['wp/v2', 'pll/v1'] }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

type Route = (url: string) => Response | undefined

function makeFetcher(routes: Route[]) {
  const urls: string[] = []
  const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
    assert.equal((init?.method ?? 'GET').toUpperCase(), 'GET', 'wrapper must only GET')
    urls.push(url)
    for (const r of routes) {
      const res = r(url)
      if (res) return res
    }
    return json({ code: 'rest_no_route' }, 404)
  }
  return { fetcher, urls }
}

function makePush(results: Array<Partial<WpPushResult>>) {
  const calls: WpPushInput[] = []
  const push = async (input: WpPushInput): Promise<WpPushResult> => {
    calls.push(input)
    const r = results[Math.min(calls.length - 1, results.length - 1)]
    return { ok: true, postId: 77, postUrl: `${ROOT}/th/x/`, status: input.publishMode === 'publish' ? 'publish' : 'draft', ...r }
  }
  return { push, calls }
}

function input(over: Partial<WpPushInput> = {}): WpPushInput {
  return { wpUrl: ROOT, wpUser: 'u', wpPass: 'p p', title: 'T', html: '<p>x</p>', publishMode: 'publish', ...over }
}

const post = (over: Record<string, unknown> = {}) => ({
  id: 77, guid: { raw: `${ROOT}/?p=77` }, slug: 'x', link: `${ROOT}/th/x/`, permalink_template: `${ROOT}/th/%postname%/`, status: 'draft', ...over,
})

const isPostRead = (u: string) => /\/wp-json\/wp\/v2\/posts\/\d+\?/.test(u)

// ─── pure helpers ──────────────────────────────────────────────────────────

test('readPushLangPath accepts only th/en', () => {
  assert.equal(readPushLangPath('th'), 'th')
  assert.equal(readPushLangPath('en'), 'en')
  for (const v of ['', 'TH', 'fr', undefined, null, 5, ['th']]) assert.equal(readPushLangPath(v), '')
})

test('isUnderLangPath table', () => {
  assert.equal(isUnderLangPath(`${ROOT}/th/post/`, ROOT, 'th'), true)
  assert.equal(isUnderLangPath(`${ROOT}/th`, ROOT, 'th'), true)
  assert.equal(isUnderLangPath(`${ROOT}/th/?p=12`, ROOT, 'th'), true)
  assert.equal(isUnderLangPath(`${ROOT}/th/%postname%/`, ROOT, 'th'), true)
  assert.equal(isUnderLangPath(`${ROOT}/thai-food/`, ROOT, 'th'), false)
  assert.equal(isUnderLangPath(`${ROOT}/blog/th-tips/`, ROOT, 'th'), false)
  assert.equal(isUnderLangPath(`${ROOT}/?p=12`, ROOT, 'th'), false)
  assert.equal(isUnderLangPath('https://other.test/th/a/', ROOT, 'th'), false)
  assert.equal(isUnderLangPath('not a url', ROOT, 'th'), false)
  assert.equal(isUnderLangPath('', ROOT, 'th'), false)
  // site installed in a sub-folder
  assert.equal(isUnderLangPath(`${ROOT}/blog/th/a/`, `${ROOT}/blog`, 'th'), true)
  assert.equal(isUnderLangPath(`${ROOT}/th/a/`, `${ROOT}/blog`, 'th'), false)
})

// ─── preflight ─────────────────────────────────────────────────────────────

test('lang index answering 301 is not valid; no pll namespace -> fail, push never called', async () => {
  const { fetcher, urls } = makeFetcher([
    (u) => (u.startsWith(`${ROOT}/th/wp-json/`) ? new Response(null, { status: 301, headers: { location: `${ROOT}/wp-json/` } }) : undefined),
    (u) => (u === `${ROOT}/wp-json/?_fields=namespaces,home,url` ? json(OK_NS) : undefined),
  ])
  const { push, calls } = makePush([{}])
  const r = await pushArticleToWordPressLang(input(), { lang: 'th', fetcher, push })
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /TranslatePress/)
  assert.equal(calls.length, 0)
  assert.ok(urls.every((u) => !u.includes('/posts')), 'nothing beyond preflight')
})

test('root REST unreadable -> fail, push never called', async () => {
  const { fetcher } = makeFetcher([])
  const { push, calls } = makePush([{}])
  const r = await pushArticleToWordPressLang(input(), { lang: 'th', fetcher, push })
  assert.equal(r.ok, false)
  assert.equal(calls.length, 0)
})

test('Polylang language missing -> fail, no push', async () => {
  const { fetcher } = makeFetcher([
    (u) => (u === `${ROOT}/wp-json/?_fields=namespaces,home,url` ? json(PLL_NS) : undefined),
    (u) => (u === `${ROOT}/wp-json/pll/v1/languages` ? json([{ slug: 'en', home_url: `${ROOT}/en/` }]) : undefined),
  ])
  const { push, calls } = makePush([{}])
  const r = await pushArticleToWordPressLang(input(), { lang: 'th', fetcher, push })
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /Polylang/)
  assert.equal(calls.length, 0)
})

test('Polylang language not served under /th -> fail', async () => {
  const { fetcher } = makeFetcher([
    (u) => (u === `${ROOT}/wp-json/?_fields=namespaces,home,url` ? json(PLL_NS) : undefined),
    (u) => (u === `${ROOT}/wp-json/pll/v1/languages` ? json([{ slug: 'th', home_url: `${ROOT}/?lang=th` }]) : undefined),
  ])
  const { push, calls } = makePush([{}])
  const r = await pushArticleToWordPressLang(input(), { lang: 'th', fetcher, push })
  assert.equal(r.ok, false)
  assert.equal(calls.length, 0)
})

function polylangRoutes(extra: Route[] = []): Route[] {
  return [
    (u) => (u === `${ROOT}/wp-json/?_fields=namespaces,home,url` ? json(PLL_NS) : undefined),
    (u) => (u === `${ROOT}/wp-json/pll/v1/languages` ? json([{ slug: 'th', home_url: `${ROOT}/th/` }]) : undefined),
    (u) => (u.includes('?slug=') ? json([]) : undefined),
    ...extra,
  ]
}

test('Polylang OK -> query mode, core called with root url + postsQuery + strictWrite + draft', async () => {
  const { fetcher } = makeFetcher(polylangRoutes([(u) => (isPostRead(u) ? json(post()) : undefined)]))
  const { push, calls } = makePush([{}])
  const r = await pushArticleToWordPressLang(input({ publishMode: 'draft', slug: 'x' }), { lang: 'th', fetcher, push })
  assert.equal(r.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].wpUrl, ROOT)
  assert.equal(calls[0].postsQuery, 'lang=th')
  assert.equal(calls[0].strictWrite, true)
  assert.equal(calls[0].publishMode, 'draft')
  assert.deepEqual(r.langRecord, { lang: 'th', mode: 'query', postId: 77 })
})

function baseRoutes(rootRead: Route, baseRead: Route = (u) => (u.startsWith(`${ROOT}/th/wp-json/wp/v2/posts/77?`) ? json(post()) : undefined)): Route[] {
  return [
    (u) => (u === `${ROOT}/wp-json/?_fields=namespaces,home,url` ? json(OK_NS) : undefined),
    (u) => (u === `${ROOT}/th/wp-json/?_fields=namespaces,home,url,name` ? json(OK_NS) : undefined),
    (u) => (u.includes('?slug=') ? json([]) : undefined),
    baseRead,
    rootRead,
  ]
}

test('base mode -> core wpUrl ends with /th', async () => {
  const { fetcher } = makeFetcher(baseRoutes((u) => (u.startsWith(`${ROOT}/wp-json/wp/v2/posts/77?`) ? json({ code: 'x' }, 404) : undefined)))
  const { push, calls } = makePush([{}])
  const r = await pushArticleToWordPressLang(input({ publishMode: 'draft' }), { lang: 'th', fetcher, push })
  assert.equal(r.ok, true)
  assert.equal(calls[0].wpUrl, `${ROOT}/th`)
  assert.deepEqual(r.langRecord, { lang: 'th', mode: 'base', postId: 77 })
})

// ─── verify ────────────────────────────────────────────────────────────────

test('base mode: root read is the same post with a link outside /th -> not verified, stranded draft, no publish pass', async () => {
  const outside = post({ link: `${ROOT}/x/`, permalink_template: `${ROOT}/%postname%/` })
  const { fetcher } = makeFetcher(baseRoutes((u) => (u.startsWith(`${ROOT}/wp-json/wp/v2/posts/77?`) ? json(outside) : undefined)))
  const { push, calls } = makePush([{}])
  const r = await pushArticleToWordPressLang(input(), { lang: 'th', fetcher, push })
  assert.equal(r.ok, false)
  assert.deepEqual(r.strandedDraft, { postId: 77, lang: 'th', mode: 'base' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].publishMode, 'draft')
  assert.match(r.error ?? '', /wp-admin\/post\.php\?post=77/)
})

test('base mode: root 404 and base link under /th -> verified', async () => {
  const { fetcher } = makeFetcher(baseRoutes((u) => (u.startsWith(`${ROOT}/wp-json/wp/v2/posts/77?`) ? json({ code: 'x' }, 404) : undefined)))
  const { push } = makePush([{}])
  const r = await pushArticleToWordPressLang(input({ publishMode: 'draft' }), { lang: 'th', fetcher, push })
  assert.equal(r.ok, true)
})

test('base mode: root answers 500 -> not verified', async () => {
  const { fetcher } = makeFetcher(baseRoutes((u) => (u.startsWith(`${ROOT}/wp-json/wp/v2/posts/77?`) ? json({}, 500) : undefined)))
  const { push } = makePush([{}])
  const r = await pushArticleToWordPressLang(input({ publishMode: 'draft' }), { lang: 'th', fetcher, push })
  assert.equal(r.ok, false)
  assert.ok(r.strandedDraft)
})

test('draft -> verify -> publish order, second call has existingPostId + publish', async () => {
  const { fetcher } = makeFetcher(polylangRoutes([(u) => (isPostRead(u) ? json(post()) : undefined)]))
  const { push, calls } = makePush([{ warning: 'a' }, { warning: 'a' }])
  const r = await pushArticleToWordPressLang(input({ slug: 'x' }), { lang: 'th', fetcher, push })
  assert.equal(r.ok, true)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].publishMode, 'draft')
  assert.equal(calls[1].publishMode, 'publish')
  assert.equal(calls[1].existingPostId, 77)
  assert.equal(r.status, 'publish')
  assert.equal(r.warning, 'a')
  assert.ok(r.langRecord)
})

test('publishAt set -> only one core call', async () => {
  const { fetcher } = makeFetcher(polylangRoutes([(u) => (isPostRead(u) ? json(post()) : undefined)]))
  const { push, calls } = makePush([{}])
  const r = await pushArticleToWordPressLang(input({ publishAt: '2030-01-01T00:00:00Z' }), { lang: 'th', fetcher, push })
  assert.equal(r.ok, true)
  assert.equal(calls.length, 1)
})

test('pass 2 failure -> ok, status draft, warning with the error', async () => {
  const { fetcher } = makeFetcher(polylangRoutes([(u) => (isPostRead(u) ? json(post()) : undefined)]))
  const { push } = makePush([{}, { ok: false, error: 'boom' }])
  const r = await pushArticleToWordPressLang(input(), { lang: 'th', fetcher, push })
  assert.equal(r.ok, true)
  assert.equal(r.status, 'draft')
  assert.match(r.warning ?? '', /boom/)
  assert.ok(r.langRecord)
})

test('slug pre-check hit -> fail, zero core calls', async () => {
  const routes = polylangRoutes([(u) => (isPostRead(u) ? json(post()) : undefined)])
  routes.unshift((u) => (u.includes('?slug=') ? json([{ id: 9, status: 'publish', link: `${ROOT}/th/x/` }]) : undefined))
  const { fetcher } = makeFetcher(routes)
  const { push, calls } = makePush([{}])
  const r = await pushArticleToWordPressLang(input({ slug: 'x' }), { lang: 'th', fetcher, push })
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /ID 9/)
  assert.equal(calls.length, 0)
})

// ─── existing / stranded ───────────────────────────────────────────────────

test('stranded draft reused: existingPostId = draft id, no slug pre-check', async () => {
  const { fetcher, urls } = makeFetcher([(u) => (isPostRead(u) ? json(post({ status: 'draft' })) : undefined)])
  const { push, calls } = makePush([{}, {}])
  const r = await pushArticleToWordPressLang(input({ slug: 'x' }), {
    lang: 'th', fetcher, push, strandedDraft: { postId: 77, lang: 'th', mode: 'query' },
  })
  assert.equal(r.ok, true)
  assert.equal(calls[0].existingPostId, 77)
  assert.equal(calls[0].publishMode, 'draft')
  assert.ok(urls.every((u) => !u.includes('?slug=')))
  assert.ok(urls.every((u) => !u.includes('/wp-json/?_fields')), 'no preflight when a record exists')
})

test('stranded post found already published and not verified -> fail, zero core calls', async () => {
  const outside = post({ status: 'publish', link: `${ROOT}/x/`, permalink_template: `${ROOT}/%postname%/` })
  const { fetcher } = makeFetcher([(u) => (isPostRead(u) ? json(outside) : undefined)])
  const { push, calls } = makePush([{}])
  const r = await pushArticleToWordPressLang(input(), {
    lang: 'th', fetcher, push, strandedDraft: { postId: 77, lang: 'th', mode: 'query' },
  })
  assert.equal(r.ok, false)
  assert.equal(calls.length, 0)
})

test('stranded draft gone (404) -> new post path with no existingPostId', async () => {
  const { fetcher, urls } = makeFetcher([
    (u) => (u.includes('?slug=') ? json([]) : undefined),
    (u) => (u.includes('/posts/77?') ? json({}, 404) : undefined),
    (u) => (u.includes('/posts/88?') ? json(post({ id: 88, guid: { raw: `${ROOT}/?p=88` } })) : undefined),
  ])
  const { push, calls } = makePush([{ postId: 88 }])
  const r = await pushArticleToWordPressLang(input({ slug: 'x', publishMode: 'draft' }), {
    lang: 'th', fetcher, push, strandedDraft: { postId: 77, lang: 'th', mode: 'query' },
  })
  assert.equal(r.ok, true)
  assert.equal(calls[0].existingPostId, undefined)
  assert.ok(urls.some((u) => u.includes('?slug=')))
})

test('verified re-push -> single core call with the caller mode, not forced draft', async () => {
  const { fetcher } = makeFetcher([(u) => (isPostRead(u) ? json(post({ status: 'publish' })) : undefined)])
  const { push, calls } = makePush([{}])
  const r = await pushArticleToWordPressLang(input({ existingPostId: 77, publishMode: 'publish' }), {
    lang: 'th', fetcher, push, pushed: { lang: 'th', mode: 'query' },
  })
  assert.equal(r.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].publishMode, 'publish')
  assert.equal(calls[0].existingPostId, 77)
  assert.deepEqual(r.langRecord, { lang: 'th', mode: 'query', postId: 77 })
  assert.equal(r.warning, undefined)
})

test('re-push whose post is no longer under /th keeps ok with a warning', async () => {
  const outside = post({ status: 'publish', link: `${ROOT}/x/`, permalink_template: `${ROOT}/%postname%/` })
  const { fetcher } = makeFetcher([(u) => (isPostRead(u) ? json(outside) : undefined)])
  const { push } = makePush([{}])
  const r = await pushArticleToWordPressLang(input({ existingPostId: 77 }), {
    lang: 'th', fetcher, push, pushed: { lang: 'th', mode: 'query' },
  })
  assert.equal(r.ok, true)
  assert.match(r.warning ?? '', /ไม่อยู่ใต้ \/th/)
})

test('pushed post deleted on site (404) -> new post path', async () => {
  const { fetcher } = makeFetcher([
    (u) => (u.includes('/posts/77?') ? json({}, 404) : undefined),
    (u) => (u.includes('?slug=') ? json([]) : undefined),
    (u) => (u.includes('/posts/88?') ? json(post({ id: 88, guid: { raw: `${ROOT}/?p=88` } })) : undefined),
  ])
  const { push, calls } = makePush([{ postId: 88 }])
  const r = await pushArticleToWordPressLang(input({ existingPostId: 77, slug: 'x', publishMode: 'draft' }), {
    lang: 'th', fetcher, push, pushed: { lang: 'th', mode: 'query' },
  })
  assert.equal(r.ok, true)
  assert.equal(calls[0].existingPostId, undefined)
})

test('pushed for another lang -> fail, no calls', async () => {
  const { fetcher, urls } = makeFetcher([])
  const { push, calls } = makePush([{}])
  const r = await pushArticleToWordPressLang(input({ existingPostId: 77 }), {
    lang: 'th', fetcher, push, pushed: { lang: 'en', mode: 'base' },
  })
  assert.equal(r.ok, false)
  assert.equal(calls.length, 0)
  assert.equal(urls.length, 0)
})

test('existingPostId with no matching record -> fail, no calls', async () => {
  const { fetcher } = makeFetcher([])
  const { push, calls } = makePush([{}])
  const r = await pushArticleToWordPressLang(input({ existingPostId: 77 }), { lang: 'th', fetcher, push })
  assert.equal(r.ok, false)
  assert.equal(calls.length, 0)
})

// ─── schema ────────────────────────────────────────────────────────────────

test('uploadSchemaOptions: pathPrefix puts the article under /th, default unchanged', () => {
  const article = { title: 'T', seoTitle: '', metaDescription: '', slug: 'my-post', coverImageUrl: null, coverAlt: '' }
  const client = { name: 'N', website: 'https://site.test', language: 'th' }
  const plain = uploadSchemaOptions(article, client)
  assert.equal(plain.meta.slug, 'my-post')
  assert.deepEqual(uploadSchemaOptions(article, client, undefined), plain)
  assert.deepEqual(uploadSchemaOptions(article, client, {}), plain)
  const th = uploadSchemaOptions(article, client, { pathPrefix: 'th' })
  assert.equal(th.meta.slug, 'th/my-post')
  assert.equal(th.site.url, 'https://site.test')
  assert.equal(uploadSchemaOptions({ ...article, slug: '' }, client, { pathPrefix: 'th' }).meta.slug, undefined)
})

// ─── language record: postId ───────────────────────────────────────────────

test('first push success returns langRecord with postId (query mode)', async () => {
  const { fetcher } = makeFetcher(polylangRoutes([(u) => (isPostRead(u) ? json(post()) : undefined)]))
  const { push } = makePush([{}, {}])
  const r = await pushArticleToWordPressLang(input({ slug: 'x' }), { lang: 'th', fetcher, push })
  assert.equal(r.ok, true)
  assert.deepEqual(r.langRecord, { lang: 'th', mode: 'query', postId: 77 })
})

test('first push success returns langRecord with postId (base mode)', async () => {
  const { fetcher } = makeFetcher(baseRoutes((u) => (u.startsWith(`${ROOT}/wp-json/wp/v2/posts/77?`) ? json({ code: 'x' }, 404) : undefined)))
  const { push } = makePush([{}, {}])
  const r = await pushArticleToWordPressLang(input(), { lang: 'th', fetcher, push })
  assert.equal(r.ok, true)
  assert.deepEqual(r.langRecord, { lang: 'th', mode: 'base', postId: 77 })
})

test('record postId differs from input existingPostId -> fail, nothing called or fetched', async () => {
  const { fetcher, urls } = makeFetcher([])
  const { push, calls } = makePush([{}])
  const r = await pushArticleToWordPressLang(input({ existingPostId: 55 }), {
    lang: 'th', fetcher, push, pushed: { lang: 'th', mode: 'query', postId: 77 },
  })
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /55/)
  assert.match(r.error ?? '', /77/)
  assert.equal(calls.length, 0)
  assert.equal(urls.length, 0)
})

test('record postId used when input has no existingPostId -> strict single call to 77', async () => {
  const { fetcher } = makeFetcher([(u) => (isPostRead(u) ? json(post({ status: 'publish' })) : undefined)])
  const { push, calls } = makePush([{}])
  const r = await pushArticleToWordPressLang(input(), {
    lang: 'th', fetcher, push, pushed: { lang: 'th', mode: 'query', postId: 77 },
  })
  assert.equal(r.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].existingPostId, 77)
  assert.equal(calls[0].strictWrite, true)
  assert.equal(r.langRecord?.postId, 77)
})

test('old-style record without postId upgrades to a record with postId', async () => {
  const { fetcher } = makeFetcher([(u) => (isPostRead(u) ? json(post({ status: 'publish' })) : undefined)])
  const { push, calls } = makePush([{}])
  const r = await pushArticleToWordPressLang(input({ existingPostId: 77 }), {
    lang: 'th', fetcher, push, pushed: { lang: 'th', mode: 'query' },
  })
  assert.equal(r.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].existingPostId, 77)
  assert.deepEqual(r.langRecord, { lang: 'th', mode: 'query', postId: 77 })
})

test('stranded draft failing verification again -> stays stranded, no langRecord', async () => {
  const outside = post({ status: 'draft', link: `${ROOT}/x/`, permalink_template: `${ROOT}/%postname%/` })
  const { fetcher } = makeFetcher([(u) => (isPostRead(u) ? json(outside) : undefined)])
  const { push, calls } = makePush([{}])
  const r = await pushArticleToWordPressLang(input(), {
    lang: 'th', fetcher, push, strandedDraft: { postId: 77, lang: 'th', mode: 'query' },
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].publishMode, 'draft')
  assert.equal(calls[0].existingPostId, 77)
  assert.equal(r.ok, false)
  assert.deepEqual(r.strandedDraft, { postId: 77, lang: 'th', mode: 'query' })
  assert.equal(r.langRecord, undefined)
})
