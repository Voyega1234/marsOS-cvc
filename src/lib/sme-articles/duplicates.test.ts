// รัน: npx tsx src/lib/sme-articles/duplicates.test.ts
import { isSmeArticlePushed, normalizeWpUrl, pruneArticleFromPrefs, smeDuplicateMap, smeDuplicatesOf } from './duplicates'
import { readOwnerFilterInput } from './owner-scope'

let passed = 0
let failed = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  if (g === w) { passed++; return }
  failed++
  console.error(`FAIL ${name}: got ${g} want ${w}`)
}

// ─── normalizeWpUrl ──
eq('trailing slash', normalizeWpUrl('https://example.com/blog/post/'), 'example.com/blog/post')
eq('query ?mars_v ตัดทิ้ง', normalizeWpUrl('https://example.com/post/?mars_v=123'), 'example.com/post')
eq('hash ตัดทิ้ง', normalizeWpUrl('https://example.com/post#faq'), 'example.com/post')
eq('host ตัวเล็ก', normalizeWpUrl('https://Example.COM/Post'), 'example.com/Post')
eq('path ไทย decode', normalizeWpUrl('https://example.com/%E0%B8%81'), 'example.com/ก')
eq('% เสียใช้ path ดิบ', normalizeWpUrl('https://example.com/a%E0%B8'), 'example.com/a%E0%B8')
eq('URL เสีย', normalizeWpUrl('not a url'), null)
eq('ว่าง', normalizeWpUrl('  '), null)
eq('null', normalizeWpUrl(null), null)

// ─── smeDuplicatesOf ──
const a = { id: 'a', title: 'คู่มือ SEO', slug: 'seo-guide', wordpressUrl: 'https://example.com/seo-guide/' }
const sameUrl = { id: 'b', title: 'อีกชื่อ', slug: 'other', wordpressUrl: 'https://example.com/seo-guide?mars_v=2' }
const sameSlug = { id: 'c', title: 'ชื่อที่สาม', slug: 'seo-guide', wordpressUrl: null }
const sameTitle = { id: 'd', title: '  คู่มือ SEO ', slug: 'x', wordpressUrl: null }
const unrelated = { id: 'e', title: 'เรื่องอื่น', slug: 'other-2', wordpressUrl: 'https://example.com/other-2' }
const all = [a, sameUrl, sameSlug, sameTitle, unrelated]
eq('ซ้ำโดย URL / slug / ชื่อ', smeDuplicatesOf(a, all).map((o) => o.id), ['b', 'c', 'd'])
eq('ไม่นับตัวเอง', smeDuplicatesOf(a, [a]).map((o) => o.id), [])
eq('ไม่ซ้ำ', smeDuplicatesOf(unrelated, all).map((o) => o.id), [])
eq('slug ว่างไม่ถือว่าซ้ำ',
  smeDuplicatesOf({ id: 'p', title: 'p1', slug: '', wordpressUrl: null }, [{ id: 'q', title: 'q1', slug: '', wordpressUrl: null }]).map((o) => o.id), [])

const dupMap = smeDuplicateMap(all)
eq('map มีเฉพาะแถวที่ซ้ำ', Array.from(dupMap.keys()).sort(), ['a', 'b', 'c', 'd'])
eq('map ไม่มีแถวที่ไม่ซ้ำ', dupMap.has('e'), false)

// ─── isSmeArticlePushed ──
eq('มี URL = ขึ้นเว็บแล้ว', isSmeArticlePushed({ wordpressUrl: 'https://example.com/x' }), true)
eq('POSTED', isSmeArticlePushed({ status: 'POSTED' }), true)
eq('WORDPRESS_DRAFTED', isSmeArticlePushed({ status: 'WORDPRESS_DRAFTED' }), true)
eq('ยังไม่ขึ้น', isSmeArticlePushed({ wordpressUrl: null, status: 'REVIEW' }), false)

// ─── pruneArticleFromPrefs ──
const prefs = {
  wpUrl: 'https://example.com',
  indexRequests: { a: { at: '2026-10-01' }, b: { at: '2026-10-02' } },
  articleOwners: { a: 't1', c: 't2' },
  ownerTags: [{ id: 't1', name: 'Mint' }],
}
const pruned = pruneArticleFromPrefs(prefs, 'a')
eq('ตัด indexRequests', pruned?.indexRequests, { b: { at: '2026-10-02' } })
eq('ตัด articleOwners', pruned?.articleOwners, { c: 't2' })
eq('key อื่นคงเดิม', [pruned?.wpUrl, pruned?.ownerTags], ['https://example.com', [{ id: 't1', name: 'Mint' }]])
eq('ไม่แก้ object เดิม', prefs.articleOwners, { a: 't1', c: 't2' })
eq('ตัดแค่ map ที่มี id', pruneArticleFromPrefs(prefs, 'c')?.indexRequests, prefs.indexRequests)
eq('ไม่มีอะไรเปลี่ยน = null', pruneArticleFromPrefs(prefs, 'zzz'), null)
eq('map เป็น array ไม่แตะ', pruneArticleFromPrefs({ articleOwners: ['a'] }, 'a'), null)

// ─── readOwnerFilterInput ──
eq('ครบ', readOwnerFilterInput({ projectId: ' p1 ', ownerTagId: 't1' }), { projectId: 'p1', ownerTagId: 't1' })
eq('ไม่มี ownerTagId', readOwnerFilterInput({ projectId: 'p1' }), null)
eq('ownerTagId ว่าง', readOwnerFilterInput({ projectId: 'p1', ownerTagId: '  ' }), null)
eq('ไม่ใช่ string', readOwnerFilterInput({ projectId: 1, ownerTagId: 't1' }), null)
eq('body null', readOwnerFilterInput(null), null)
eq('ตัดยาวเกิน 64', readOwnerFilterInput({ projectId: 'p'.repeat(100), ownerTagId: 't' })?.projectId.length, 64)

console.log(`${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
