import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { pushArticleToWordPress, type WpPushInput } from './wp-push'

const SITE = 'https://93.184.216.34'
const POSTS = '/wp-json/wp/v2/posts'
const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

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
    return new Response(JSON.stringify({ code: 'rest_no_route' }), { status: 404, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return calls
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function input(over: Partial<WpPushInput> = {}): WpPushInput {
  return {
    wpUrl: SITE, wpUser: 'u', wpPass: 'p p', title: 'T', metaTitle: 'T',
    html: '<div class="content-article"><p>x</p></div>', publishMode: 'draft', strictWrite: true, ...over,
  }
}

const pathOf = (u: string) => new URL(u).pathname
const postWrites = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && pathOf(c.url).startsWith(POSTS))
const collectionPosts = (calls: Call[]) => postWrites(calls).filter((c) => pathOf(c.url) === POSTS)

test('B1 strict: no slug adoption, write goes to the collection endpoint', async () => {
  const calls = stub([
    (c) => (c.method === 'GET' && c.url.includes(`${POSTS}?slug=x`) ? json([{ id: 9, content: { raw: 'content-article' } }]) : undefined),
    (c) => (c.method === 'POST' && pathOf(c.url) === POSTS ? json({ id: 77, link: `${SITE}/th/x/` }) : undefined),
  ])
  const r = await pushArticleToWordPress(input({ slug: 'x' }))
  assert.equal(r.ok, true)
  assert.equal(r.postId, 77)
  assert.ok(!calls.some((c) => c.method === 'GET' && c.url.includes('slug=x')))
  const writes = postWrites(calls)
  assert.equal(pathOf(writes[0].url), POSTS)
  assert.equal(collectionPosts(calls).length, 1)
})

test('B1b normal path: slug adoption still writes to /posts/9', async () => {
  const calls = stub([
    (c) => (c.method === 'GET' && c.url.includes(`${POSTS}?slug=x`) ? json([{ id: 9, content: { raw: 'content-article' } }]) : undefined),
    (c) => (c.method === 'POST' && pathOf(c.url) === `${POSTS}/9` ? json({ id: 9, link: `${SITE}/x/` }) : undefined),
  ])
  const r = await pushArticleToWordPress(input({ slug: 'x', strictWrite: undefined }))
  assert.equal(r.ok, true)
  const writes = postWrites(calls)
  assert.equal(pathOf(writes[0].url), `${POSTS}/9`)
  assert.equal(collectionPosts(calls).length, 0)
})

test('B2 strict: 404 on a named post -> fail, no create on the collection', async () => {
  const calls = stub([(c) => (c.method === 'POST' && pathOf(c.url) === `${POSTS}/77` ? json({ code: 'rest_post_invalid_id' }, 404) : undefined)])
  const r = await pushArticleToWordPress(input({ existingPostId: 77 }))
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /404/)
  assert.equal(postWrites(calls).length, 1)
  assert.equal(collectionPosts(calls).length, 0)
})

test('B2b normal path: 404 on a named post creates on the collection', async () => {
  const calls = stub([
    (c) => (c.method === 'POST' && pathOf(c.url) === `${POSTS}/77` ? json({ code: 'rest_post_invalid_id' }, 404) : undefined),
    (c) => (c.method === 'POST' && pathOf(c.url) === POSTS ? json({ id: 90, link: `${SITE}/x/` }) : undefined),
  ])
  const r = await pushArticleToWordPress(input({ existingPostId: 77, strictWrite: undefined }))
  assert.equal(r.ok, true)
  assert.equal(collectionPosts(calls).length, 1)
})

test('B3 strict: id mismatch in the reply -> fail naming both ids', async () => {
  stub([(c) => (c.method === 'POST' && pathOf(c.url) === `${POSTS}/77` ? json({ id: 78, link: `${SITE}/x/` }) : undefined)])
  const r = await pushArticleToWordPress(input({ existingPostId: 77 }))
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /78/)
  assert.match(r.error ?? '', /77/)
})

test('B4 strict: 500 is not retried', async () => {
  const calls = stub([(c) => (c.method === 'POST' && pathOf(c.url) === POSTS ? json({ code: 'boom' }, 500) : undefined)])
  const r = await pushArticleToWordPress(input())
  assert.equal(r.ok, false)
  assert.equal(collectionPosts(calls).length, 1)
})

test('B4b strict: 400 is retried once without meta', async () => {
  let n = 0
  const calls = stub([
    (c) => {
      if (!(c.method === 'POST' && pathOf(c.url) === POSTS)) return undefined
      n++
      return n === 1 ? json({ code: 'bad' }, 400) : json({ id: 77, link: `${SITE}/th/x/` })
    },
  ])
  const r = await pushArticleToWordPress(input())
  assert.equal(r.ok, true)
  const posts = collectionPosts(calls)
  assert.equal(posts.length, 2)
  assert.ok('meta' in JSON.parse(posts[0].body))
  assert.ok(!('meta' in JSON.parse(posts[1].body)))
})

test('B5 strict: 307 on write is not followed (one POST, no retry for 3xx)', async () => {
  const calls = stub([
    (c) => (c.method === 'POST' && pathOf(c.url) === POSTS ? new Response(null, { status: 307, headers: { location: `${SITE}${POSTS}` } }) : undefined),
  ])
  const r = await pushArticleToWordPress(input())
  assert.equal(r.ok, false)
  // retry-without-meta only fires for 4xx in strict mode, so a 307 yields exactly one POST
  assert.equal(collectionPosts(calls).length, 1)
  assert.ok(calls.every((c) => c.url.startsWith(SITE)))
})

test('B6 postsQuery is appended to the write URL', async () => {
  const calls = stub([(c) => (c.method === 'POST' && pathOf(c.url) === POSTS ? json({ id: 77, link: `${SITE}/th/x/` }) : undefined)])
  const r = await pushArticleToWordPress(input({ postsQuery: 'lang=th' }))
  assert.equal(r.ok, true)
  const writes = collectionPosts(calls)
  assert.equal(writes.length, 1)
  assert.equal(new URL(writes[0].url).search, '?lang=th')
})
