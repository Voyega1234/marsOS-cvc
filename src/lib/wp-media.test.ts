/**
 * WordPress media reuse (slug จาก hash ไบต์รูป) — mock fetch ทั้งหมด ไม่ยิงเน็ตจริง
 * Run: npx tsx src/lib/wp-media.test.ts
 */
import { wpMediaSlug, findOrUploadWpMedia, replaceInlineDataImages, type WpFetch } from './wp-media'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`)
  passed++
  console.log(`  ✓ ${msg}`)
}

const A = Buffer.from('image-bytes-A').toString('base64')
const B = Buffer.from('image-bytes-B').toString('base64')
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })

type Call = { url: string; init: RequestInit }
function mock(handler: (c: Call) => Response): { fn: WpFetch; calls: Call[] } {
  const calls: Call[] = []
  return { calls, fn: async (url, init) => { const c = { url, init }; calls.push(c); return handler(c) } }
}
const isLookup = (c: Call) => c.url.includes('/media?slug=')
const isUpload = (c: Call) => c.url.endsWith('/wp-json/wp/v2/media') && c.init.method === 'POST'
const base = { wpUrl: 'https://x.com', creds: 'abc', mime: 'image/webp', title: 'T', alt: 'alt' }

async function main() {
  assert(wpMediaSlug(A) === wpMediaSlug(A), 'same bytes -> same slug')
  assert(wpMediaSlug(A) !== wpMediaSlug(B), 'different bytes -> different slug')
  assert(/^mars-[0-9a-f]{16}$/.test(wpMediaSlug(A)), 'slug format')

  // lookup hit
  let m = mock(() => json([{ id: 7, source_url: 'https://x.com/a.webp', alt_text: 'alt' }]))
  let r = await findOrUploadWpMedia({ ...base, base64: A, fetchFn: m.fn })
  assert(r?.reused === true && r.id === 7 && r.url === 'https://x.com/a.webp', 'lookup hit reused')
  assert(m.calls.length === 1 && !m.calls.some(isUpload), 'lookup hit -> no upload, no alt update')

  // lookup hit, alt differs
  m = mock(c => isLookup(c) ? json([{ id: 7, source_url: 'https://x.com/a.webp', alt_text: 'old' }]) : json({}))
  r = await findOrUploadWpMedia({ ...base, base64: A, fetchFn: m.fn })
  const upd = m.calls.find(c => c.url.endsWith('/media/7'))
  assert(r?.reused === true && !!upd && String(upd.init.body).includes('"alt_text":"alt"'), 'alt differs -> alt update call')
  assert(!m.calls.some(isUpload), 'alt update is not an upload')

  // lookup miss -> upload
  const slug = wpMediaSlug(A)
  m = mock(c => isLookup(c) ? json([]) : json({ id: 9, source_url: 'https://x.com/n.webp' }))
  r = await findOrUploadWpMedia({ ...base, base64: A, fetchFn: m.fn })
  const up = m.calls.find(isUpload)
  const bodyStr = up ? Buffer.from(up.init.body as Buffer).toString('latin1') : ''
  assert(r?.reused === false && r.id === 9, 'miss -> uploaded, reused false')
  assert(bodyStr.includes(`name="slug"\r\n\r\n${slug}`), 'upload body has slug field')
  assert(bodyStr.includes(`filename="${slug}.webp"`), 'filename is slug.webp')

  // lookup 500 -> still uploads
  m = mock(c => isLookup(c) ? new Response('err', { status: 500 }) : json({ id: 10, source_url: 'https://x.com/z.webp' }))
  r = await findOrUploadWpMedia({ ...base, base64: A, fetchFn: m.fn })
  assert(r?.id === 10 && r.reused === false, 'lookup 500 -> uploads')

  // upload failure -> null
  m = mock(c => isLookup(c) ? json([]) : new Response('no', { status: 500 }))
  assert((await findOrUploadWpMedia({ ...base, base64: A, fetchFn: m.fn })) === null, 'upload failure -> null')

  // replaceInlineDataImages
  const uriA = `data:image/webp;base64,${A}`
  const uriB = `data:image/png;base64,${B}`
  const C = Buffer.from('image-bytes-C').toString('base64')
  const uriC = `data:image/webp;base64,${C}`
  const html = `<img src="${uriA}" alt="a1"><img src="${uriA}" alt="a1"><img src="${uriB}" alt="b"><img src="${uriC}" alt="c">`
  m = mock(c => {
    if (isLookup(c)) return json([])
    const body = Buffer.from(c.init.body as Buffer).toString('latin1')
    if (body.includes(wpMediaSlug(B))) return new Response('no', { status: 500 })
    return json({ id: 1, source_url: `https://x.com/${body.includes(wpMediaSlug(A)) ? 'a' : 'c'}.webp` })
  })
  const out = await replaceInlineDataImages({
    wpUrl: 'https://x.com', creds: 'abc', html, title: 'T', known: new Map([[uriC, 'https://x.com/known.webp']]), fetchFn: m.fn,
  })
  assert(m.calls.filter(isUpload).length === 2, 'dup uploaded once, known not uploaded (A + failing B only)')
  assert(!out.includes(uriA) && out.split('https://x.com/a.webp').length === 3, 'successful replaced (both occurrences)')
  assert(out.includes(uriB), 'failed upload keeps data URI')
  assert(out.includes('https://x.com/known.webp') && !out.includes(uriC), 'known entry replaced without upload')

  console.log(`\n${passed} passed`)
}
main().catch(e => { console.error(e); process.exit(1) })
