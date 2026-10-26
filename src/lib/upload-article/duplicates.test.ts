/**
 * Regression: บทความซ้ำ (ชื่อ/slug เดียวกัน push ไปโพสต์เดียวกัน) ต้องลบได้ทั้งที่ push แล้ว โดยเก็บไว้อย่างน้อย 1 แถว
 * Run: npx tsx src/lib/upload-article/duplicates.test.ts
 */
import { normalizeArticleTitle, duplicatesOf, duplicateMap, canDeleteArticle, isArticlePushed } from './duplicates';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

type Row = { id: string; title: string; slug: string | null; wordpressPostId: string | null; pushedAt: string | null };
function row(id: string, over: Partial<Row> = {}): Row {
  return { id, title: `หัวข้อ ${id}`, slug: null, wordpressPostId: null, pushedAt: null, ...over };
}
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort().join(',');

// normalizeArticleTitle
assert(normalizeArticleTitle('  Hello   World ') === 'hello world', 'normalize: trim + lowercase + collapse whitespace');
assert(normalizeArticleTitle('A\n\tB') === 'a b', 'normalize: newline/tab collapse');
assert(normalizeArticleTitle('   ') === '', 'normalize: whitespace only = empty');

// duplicatesOf — โพสต์ WP เดียวกัน
{
  const a = row('a', { wordpressPostId: '100' });
  const b = row('b', { wordpressPostId: '100' });
  const c = row('c', { wordpressPostId: '200' });
  assert(ids(duplicatesOf(a, [a, b, c])) === 'b', 'same wordpressPostId = duplicate, excludes self');
}
// null wordpressPostId ไม่นับว่าเหมือนกัน
{
  const a = row('a');
  const b = row('b');
  assert(duplicatesOf(a, [a, b]).length === 0, 'null wordpressPostId on both sides is not a duplicate');
}
// slug
{
  const a = row('a', { slug: 'my-slug' });
  const b = row('b', { slug: ' my-slug ' });
  const c = row('c', { slug: 'other' });
  assert(ids(duplicatesOf(a, [a, b, c])) === 'b', 'same trimmed slug = duplicate');
}
{
  const a = row('a', { slug: '' });
  const b = row('b', { slug: '' });
  const c = row('c', { slug: null });
  assert(duplicatesOf(a, [a, b, c]).length === 0, 'empty/null slug is not a duplicate');
}
// title
{
  const a = row('a', { title: 'SEO คืออะไร' });
  const b = row('b', { title: '  seo   คืออะไร ' });
  const c = row('c', { title: 'อย่างอื่น' });
  assert(ids(duplicatesOf(a, [a, b, c])) === 'b', 'same normalized title = duplicate');
}
{
  const a = row('a', { title: '  ' });
  const b = row('b', { title: '' });
  assert(duplicatesOf(a, [a, b]).length === 0, 'empty title is not a duplicate');
}
// ไม่ mutate input + id เดียวกันไม่นับ
{
  const a = row('a', { title: 'x' });
  const same = { ...a };
  assert(duplicatesOf(a, [same]).length === 0, 'same id is never a duplicate of itself');
}

// duplicateMap
{
  const a = row('a', { title: 'ซ้ำ' });
  const b = row('b', { title: 'ซ้ำ' });
  const c = row('c', { title: 'ไม่ซ้ำ' });
  const m = duplicateMap([a, b, c]);
  assert(m.size === 2, 'duplicateMap: only rows with duplicates');
  assert(ids(m.get('a') ?? []) === 'b' && ids(m.get('b') ?? []) === 'a', 'duplicateMap: each points at the other');
  assert(!m.has('c'), 'duplicateMap: unique row absent');
}

// canDeleteArticle — Upload ลบได้ทุกแถว, PBN ที่ push แล้วลบไม่ได้
{
  const fresh = row('a');
  assert(canDeleteArticle(fresh, false), 'unpushed Upload row is deletable');
  assert(canDeleteArticle(fresh, true), 'unpushed PBN row is deletable');
}
{
  const pushed = row('a', { wordpressPostId: '100', pushedAt: '2026-10-01T00:00:00Z' });
  assert(canDeleteArticle(pushed, false), 'pushed Upload row without duplicates is deletable');
  assert(!canDeleteArticle(pushed, true), 'pushed PBN row is NOT deletable');
}
{
  const pushedOnlyAt = row('a', { pushedAt: '2026-10-01T00:00:00Z' });
  assert(isArticlePushed(pushedOnlyAt), 'pushedAt alone counts as pushed');
  assert(!canDeleteArticle(pushedOnlyAt, true), 'PBN row with pushedAt alone is NOT deletable');
}
{
  const postOnly = row('a', { wordpressPostId: '100' });
  assert(isArticlePushed(postOnly), 'wordpressPostId alone counts as pushed');
  assert(!isArticlePushed(row('b')), 'fresh row is not pushed');
}

console.log(`\n${passed} passed`);
