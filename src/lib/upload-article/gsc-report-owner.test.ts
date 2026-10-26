/**
 * Upload Article Report — กรองตามผู้ดูแลบทความ (owner tag): รวมผลหลาย batch, escape regex, แบ่ง batch, จับคู่หน้า GSC กับ URL บทความ
 * Run: npx tsx src/lib/upload-article/gsc-report-owner.test.ts
 */
import {
  batchPagesForRegex,
  buildPageRegex,
  escapeRe2,
  matchGscPagesToUrls,
  mergeGscRows,
  PAGE_REGEX_MAX_LEN,
  uploadedArticleUrl,
  type RawGscRow,
} from './gsc-report';
import { mergeOwnerTagInput, readArticleOwners, readOwnerTags } from './owner-tags';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}
function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

// ── mergeGscRows ──
{
  const a: RawGscRow[] = [
    { keys: ['x'], clicks: 10, impressions: 100, ctr: 0.1, position: 2 },
    { keys: ['y'], clicks: 1, impressions: 50, ctr: 0.02, position: 8 },
  ];
  const b: RawGscRow[] = [
    { keys: ['x'], clicks: 5, impressions: 300, ctr: 5 / 300, position: 6 },
    { keys: ['z'], clicks: 30, impressions: 60, ctr: 0.5, position: 1 },
  ];
  const m = mergeGscRows([a, b]);
  assert(m.length === 3, 'merge: same key across batches collapses (x) -> 3 rows');
  assert(m[0].keys?.[0] === 'z' && m[1].keys?.[0] === 'x' && m[2].keys?.[0] === 'y', 'merge: sorted by clicks desc');
  const x = m.find((r) => r.keys?.[0] === 'x')!;
  assert(x.clicks === 15 && x.impressions === 400, 'merge: clicks and impressions summed');
  assert(near(x.position ?? 0, (2 * 100 + 6 * 300) / 400), 'merge: position is impression-weighted average (5)');
  assert(near(x.ctr ?? 0, 15 / 400), 'merge: ctr = clicks / impressions');
  assert(mergeGscRows([a, b], 2).length === 2, 'merge: re-applies rowLimit');
  assert(mergeGscRows([a, b], 2)[0].keys?.[0] === 'z', 'merge: rowLimit keeps the top rows by clicks');
  assert(mergeGscRows([]).length === 0 && mergeGscRows([[], []]).length === 0, 'merge: empty input -> empty');

  // multi-dimension keys must not collide
  const q1: RawGscRow[] = [{ keys: ['a b', 'c'], clicks: 1, impressions: 10, ctr: 0.1, position: 1 }];
  const q2: RawGscRow[] = [{ keys: ['a', 'b c'], clicks: 2, impressions: 20, ctr: 0.1, position: 1 }];
  assert(mergeGscRows([q1, q2]).length === 2, 'merge: different multi-dimension keys stay separate');

  // totals (no dimensions) merge into a single row
  const t1: RawGscRow[] = [{ clicks: 10, impressions: 100, ctr: 0.1, position: 4 }];
  const t2: RawGscRow[] = [{ clicks: 20, impressions: 300, ctr: 20 / 300, position: 8 }];
  const t = mergeGscRows([t1, t2]);
  assert(t.length === 1 && t[0].clicks === 30 && t[0].impressions === 400, 'merge: totals -> one summed row');
  assert(near(t[0].position ?? 0, (4 * 100 + 8 * 300) / 400) && near(t[0].ctr ?? 0, 30 / 400), 'merge: totals weighted position + ctr');

  // zero impressions never divides by zero
  const z = mergeGscRows([[{ keys: ['q'], clicks: 0, impressions: 0, ctr: 0, position: 0 }]]);
  assert(z[0].ctr === 0 && z[0].position === 0, 'merge: zero impressions -> ctr/position 0 (no NaN)');
}

// ── escapeRe2 / buildPageRegex ──
{
  const all = '\\.^$|?*+()[]{}';
  const esc = escapeRe2(all);
  assert(esc === '\\\\\\.\\^\\$\\|\\?\\*\\+\\(\\)\\[\\]\\{\\}', 'escape: every RE2 metacharacter is backslash-escaped');
  assert(escapeRe2('https://a.com/x-y_z') === 'https://a\\.com/x-y_z', 'escape: plain URL only escapes dots');
  assert(new RegExp(buildPageRegex(['https://a.com/p?id=1+2'])).test('https://a.com/p?id=1+2'), 'regex: escaped URL matches itself');
  assert(!new RegExp(buildPageRegex(['https://a.com/x'])).test('https://aXcom/x'), 'regex: dot is literal, not wildcard');
  assert(!new RegExp(buildPageRegex(['https://a.com/x'])).test('https://a.com/x/y'), 'regex: anchored, no prefix match');
  assert(buildPageRegex(['a', 'b']) === '^(a|b)$', 'regex: ^(a|b)$ shape');
}

// ── batchPagesForRegex ──
{
  const pages = Array.from({ length: 200 }, (_, i) => `https://example.com/blog/some-article-slug-number-${i}.html?ref=a+b`);
  const batches = batchPagesForRegex(pages);
  assert(batches.length > 1, 'batch: 200 long URLs split into several batches');
  assert(batches.every((b) => buildPageRegex(b).length <= PAGE_REGEX_MAX_LEN), `batch: every regex <= ${PAGE_REGEX_MAX_LEN} chars`);
  assert(batches.flat().length === pages.length && new Set(batches.flat()).size === pages.length, 'batch: no page lost or duplicated');
  assert(batchPagesForRegex(['https://a.com/1', 'https://a.com/1']).flat().length === 1, 'batch: duplicate pages deduped');
  assert(batchPagesForRegex([]).length === 0, 'batch: empty -> no batches (caller returns empty report)');
  const small = batchPagesForRegex(['https://a.com/1', 'https://a.com/2']);
  assert(small.length === 1 && small[0].length === 2, 'batch: small set stays in one batch');
  const tight = batchPagesForRegex(pages, 300);
  assert(tight.every((b) => b.length === 1 || buildPageRegex(b).length <= 300), 'batch: respects custom maxLen');
  const huge = ['https://a.com/' + 'x'.repeat(4000)];
  assert(batchPagesForRegex(huge).length === 1, 'batch: a single oversize page still gets its own batch');
}

// ── matchGscPagesToUrls (normalizeReportUrl on both sides) ──
{
  const thaiDecoded = 'https://example.com/บทความ-ทดสอบ';
  const thaiEncoded = encodeURI(thaiDecoded);
  const gscPages = [
    thaiEncoded, // encoded slug in GSC
    'http://example.com/post-a/', // http + trailing slash
    'https://EXAMPLE.com/post-a', // host case
    'https://example.com/other',
    '',
  ];
  const matched = matchGscPagesToUrls(gscPages, [thaiDecoded, 'https://example.com/post-a']);
  assert(matched.includes(thaiEncoded), 'match: encoded Thai slug in GSC matches decoded article URL');
  assert(matched.includes('http://example.com/post-a/') && matched.includes('https://EXAMPLE.com/post-a'), 'match: http/https, trailing slash and host case variants all collected');
  assert(!matched.includes('https://example.com/other'), 'match: unrelated page excluded');
  assert(matched.length === 3, 'match: returns the exact GSC strings (3 matched, blank skipped)');

  const reversed = matchGscPagesToUrls([thaiDecoded], [thaiEncoded]);
  assert(reversed.length === 1 && reversed[0] === thaiDecoded, 'match: decoded in GSC vs encoded article URL also matches');
  assert(matchGscPagesToUrls(['https://example.com/a', 'https://example.com/a'], ['https://example.com/a']).length === 1, 'match: duplicate GSC strings deduped');
  assert(matchGscPagesToUrls(['https://example.com/a'], []).length === 0, 'match: no article URLs -> nothing matched (never everything)');
  assert(matchGscPagesToUrls([], ['https://example.com/a']).length === 0, 'match: no GSC pages -> nothing matched');
  assert(uploadedArticleUrl({ wordpressUrl: null, slug: 'my-slug' }, 'https://example.com/') === 'https://example.com/my-slug', 'url: falls back to website + slug');
  assert(uploadedArticleUrl({ wordpressUrl: 'https://example.com/real', slug: 'my-slug' }, 'https://example.com') === 'https://example.com/real', 'url: prefers wordpressUrl');
}

// ── owner tags sanitize / merge ──
{
  const tags = readOwnerTags([
    { id: 'a1', name: '  Ploy  ' },
    { id: 'a1', name: 'dup id' },
    { id: 'b2', name: '' },
    { id: 3, name: 'bad id type' },
    'junk',
    { id: 'c3', name: 'x'.repeat(100) },
  ]);
  assert(tags.length === 2 && tags[0].name === 'Ploy', 'tags: trims names, drops empty/invalid/duplicate-id entries');
  assert(tags[1].name.length === 40, 'tags: name capped at 40 chars');
  assert(readOwnerTags(Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, name: `n${i}` }))).length === 30, 'tags: max 30');
  assert(readOwnerTags('nope').length === 0, 'tags: non-array -> empty');

  const owners = readArticleOwners({ art1: 'a1', art2: 'gone', art3: 5 }, tags);
  assert(Object.keys(owners).length === 1 && owners.art1 === 'a1', 'owners: keeps only string ids that point to an existing tag');

  let n = 0;
  const newId = () => `new${n++}`;
  const merged = mergeOwnerTagInput(
    [{ id: 'a1', name: 'Ploy 2' }, { name: 'ploy 2' }, { name: '  ' }, { id: 'zzz', name: 'Mint' }, { name: 'MINT' }, { name: 'Ann' }],
    tags, newId,
  );
  assert(merged.length === 3, 'merge input: drops empty names and case-insensitive duplicate names');
  assert(merged[0].id === 'a1' && merged[0].name === 'Ploy 2', 'merge input: keeps the id of an existing tag (rename)');
  assert(merged[1].name === 'Mint' && merged[1].id !== 'zzz', 'merge input: unknown client-supplied id is replaced by a fresh id');
  assert(merged[2].name === 'Ann' && merged[2].id.startsWith('new'), 'merge input: new tag gets a generated id');
  assert(mergeOwnerTagInput(Array.from({ length: 40 }, (_, i) => ({ name: `p${i}` })), [], newId).length === 30, 'merge input: max 30');
  // a deleted tag disappears from articleOwners after the same pass
  const after = readArticleOwners({ art1: 'a1', art9: 'c3' }, merged);
  assert(after.art1 === 'a1' && !('art9' in after), 'merge input: articleOwners of removed tags are pruned');
}

console.log(`\nAll ${passed} assertions passed`);
