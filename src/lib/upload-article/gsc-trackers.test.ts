/**
 * Upload Article Report — Monitor (keyword + URL): normalize, key, add/remove, buildTrackerSeries, isHostAllowedForSite
 * Run: npx tsx src/lib/upload-article/gsc-trackers.test.ts
 */
import {
  addGscTracker, buildTrackerSeries, isIdPermalinkUrl, normalizeTrackerKeyword, normalizeTrackerUrl,
  readGscTrackers, removeGscTracker, trackerKey, trackerKeys, trackerUrlKey,
  GSC_TRACKER_ERROR_MESSAGES, UPLOAD_MAX_GSC_TRACKERS, type UploadGscTracker,
} from './gsc-trackers';
import { isHostAllowedForSite } from './gsc-tracker-resolve';
import type { RawGscRow } from './gsc-report';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}
function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

// ── normalize ──
{
  assert(normalizeTrackerKeyword('  Hello   WORLD ') === 'hello world', 'keyword: lowercases and collapses spaces');
  assert(normalizeTrackerKeyword(42) === '', 'keyword: non-string -> empty');
  assert(normalizeTrackerUrl('example.com/blog') === 'example.com/blog'.replace(/^/, 'https://'), 'url: adds https');
  assert(normalizeTrackerUrl('http://example.com/a') === 'http://example.com/a', 'url: keeps http');
  assert(normalizeTrackerUrl('not a url') === '', 'url: whitespace rejected');
  assert(normalizeTrackerUrl('https://localhost/x') === '', 'url: host without dot rejected');
  assert(normalizeTrackerUrl('javascript:alert(1)') === '', 'url: junk rejected');
  assert(normalizeTrackerUrl('') === '', 'url: empty rejected');
}

// ── trackerKey / permalink ──
{
  const a = trackerKey('Foo', 'http://example.com/blog/post');
  const b = trackerKey('foo', 'https://example.com/blog/post/');
  assert(a === b, 'trackerKey: http/https + trailing slash equal');
  const th1 = trackerKey('k', 'https://example.com/บทความ');
  const th2 = trackerKey('k', 'https://example.com/%E0%B8%9A%E0%B8%97%E0%B8%84%E0%B8%A7%E0%B8%B2%E0%B8%A1');
  assert(th1 === th2, 'trackerKey: percent-encoded Thai slug equal');
  assert(trackerKey('a', 'https://example.com/x') !== trackerKey('b', 'https://example.com/x'), 'trackerKey: different keyword differs');
  assert(isIdPermalinkUrl('https://mfactors.co.th/?p=5013'), 'idPermalink: ?p=');
  assert(isIdPermalinkUrl('https://mfactors.co.th/?page_id=7'), 'idPermalink: ?page_id=');
  assert(!isIdPermalinkUrl('https://mfactors.co.th/blog/?p=5'), 'idPermalink: sub path is false');
  assert(!isIdPermalinkUrl('https://mfactors.co.th/blog/post'), 'idPermalink: normal url false');
  assert(trackerUrlKey('https://x.com/?p=5') !== trackerUrlKey('https://x.com/'), 'trackerUrlKey: ?p=5 differs from home');
}

// ── readGscTrackers ──
{
  const good = { id: 'a1', keyword: 'Foo', url: 'https://example.com/a', title: ' My  title ', createdAt: '2026-01-01T00:00:00Z' };
  const read = readGscTrackers([
    good,
    { ...good, id: 'a2' }, // duplicate key
    { id: 'a1', keyword: 'bar', url: 'https://example.com/b' }, // duplicate id
    { id: 'a3', keyword: '', url: 'https://example.com/c' }, // broken
    { id: 'a4', keyword: 'x', url: 'nope' }, // broken
    null,
    'str',
    { keyword: 'x', url: 'https://example.com/d' }, // no id
  ]);
  assert(read.length === 1, 'read: drops broken and duplicate rows');
  assert(read[0].keyword === 'foo' && read[0].title === 'My title', 'read: normalizes keyword and keeps title');
  assert(readGscTrackers('x').length === 0 && readGscTrackers(undefined).length === 0, 'read: non-array -> []');
  const many = Array.from({ length: 50 }, (_, i) => ({ id: `i${i}`, keyword: `k${i}`, url: 'https://example.com/p' }));
  assert(readGscTrackers(many).length === UPLOAD_MAX_GSC_TRACKERS, 'read: caps at limit');
}

// ── add / remove ──
{
  let n = 0;
  const newId = () => `id${++n}`;
  const r1 = addGscTracker([], { keyword: 'Foo Bar', url: 'example.com/a', title: 'T' }, newId, 'now1');
  assert(r1.ok === true, 'add: ok');
  if (!r1.ok) throw new Error('unreachable');
  assert(r1.tracker.keyword === 'foo bar' && r1.tracker.url === 'https://example.com/a' && r1.tracker.title === 'T', 'add: stores normalized values and title');
  const r2 = addGscTracker(r1.trackers, { keyword: 'other', url: 'https://example.com/b' }, newId, 'now2');
  assert(r2.ok && r2.trackers[0].keyword === 'other' && r2.trackers.length === 2, 'add: newest first');
  if (r2.ok) assert(!('title' in r2.tracker), 'add: no title key when empty');
  const bad1 = addGscTracker([], { keyword: '  ', url: 'https://example.com' }, newId, 'n');
  assert(!bad1.ok && bad1.error === 'invalid_keyword', 'add: invalid_keyword');
  const bad2 = addGscTracker([], { keyword: 'a', url: 'x' }, newId, 'n');
  assert(!bad2.ok && bad2.error === 'invalid_url', 'add: invalid_url');
  const dup = addGscTracker(r1.trackers, { keyword: 'FOO bar', url: 'http://example.com/a/' }, newId, 'n');
  assert(!dup.ok && dup.error === 'duplicate', 'add: duplicate');
  const full: UploadGscTracker[] = Array.from({ length: UPLOAD_MAX_GSC_TRACKERS }, (_, i) => ({ id: `f${i}`, keyword: `k${i}`, url: 'https://example.com/p', createdAt: '' }));
  const lim = addGscTracker(full, { keyword: 'new', url: 'https://example.com/p' }, newId, 'n');
  assert(!lim.ok && lim.error === 'limit', 'add: limit');
  assert(Object.keys(GSC_TRACKER_ERROR_MESSAGES).length === 4, 'add: every error has a message');
  assert(removeGscTracker(r2.ok ? r2.trackers : [], 'id1').length === 1, 'remove: removes by id');
  assert(removeGscTracker(r1.trackers, 'nope').length === 1, 'remove: unknown id is a no-op');
}

// ── sourceUrl (the ?p=123 link the row was saved from) ──
{
  let n = 0;
  const newId = () => `s${++n}`;
  const idLink = 'https://example.com/?p=5013';
  const real = 'https://example.com/blog/post/';
  const r = addGscTracker([], { keyword: 'Foo', url: real, sourceUrl: idLink }, newId, 'now');
  assert(r.ok && r.tracker.url === real && r.tracker.sourceUrl === idLink, 'sourceUrl: stored next to the resolved url');
  if (!r.ok) throw new Error('unreachable');
  const keys = trackerKeys(r.tracker);
  assert(keys.length === 2 && keys.includes(trackerKey('foo', idLink)) && keys.includes(trackerKey('foo', real)), 'sourceUrl: trackerKeys covers both links');
  const dupId = addGscTracker(r.trackers, { keyword: 'foo', url: idLink }, newId, 'n');
  assert(!dupId.ok && dupId.error === 'duplicate', 'sourceUrl: saving the ?p= link again is a duplicate');
  const dupReal = addGscTracker(r.trackers, { keyword: 'foo', url: real, sourceUrl: 'https://example.com/?p=9' }, newId, 'n');
  assert(!dupReal.ok && dupReal.error === 'duplicate', 'sourceUrl: same resolved url is a duplicate');
  const same = addGscTracker([], { keyword: 'a', url: real, sourceUrl: 'http://example.com/blog/post' }, newId, 'n');
  assert(same.ok && !('sourceUrl' in same.tracker), 'sourceUrl: dropped when it is the same page as url');
  const junk = addGscTracker([], { keyword: 'a', url: real, sourceUrl: 'nope' }, newId, 'n');
  assert(junk.ok && !('sourceUrl' in junk.tracker), 'sourceUrl: invalid value dropped');
  const read = readGscTrackers(JSON.parse(JSON.stringify(r.trackers)));
  assert(read.length === 1 && read[0].sourceUrl === idLink, 'sourceUrl: survives a pushPrefs round trip');
  assert(trackerKeys({ keyword: 'a', url: real }).length === 1, 'sourceUrl: one key when absent');
}

// ── buildTrackerSeries ──
{
  const rows: RawGscRow[] = [
    { keys: ['2026-03-01', 'https://example.com/post'], clicks: 2, impressions: 10, position: 4 },
    { keys: ['2026-03-01', 'http://example.com/post/'], clicks: 1, impressions: 30, position: 8 },
    { keys: ['2026-03-03', 'https://example.com/post'], clicks: 0, impressions: 5, position: 2 },
    { keys: ['2026-03-02', 'https://example.com/other'], clicks: 9, impressions: 99, position: 1 },
  ];
  const s = buildTrackerSeries(rows, 'https://example.com/post', '2026-03-01', '2026-03-05');
  assert(s.daily.length === 5 && s.daily[0].date === '2026-03-01' && s.daily[4].date === '2026-03-05', 'series: zero-fills every day start..end');
  assert(s.daily[1].impressions === 0 && s.daily[1].clicks === 0 && s.daily[1].position === 0, 'series: missing day is zero (other page ignored)');
  assert(s.daily[0].clicks === 3 && s.daily[0].impressions === 40, 'series: http/https + trailing slash variants summed');
  assert(near(s.daily[0].position, (4 * 10 + 8 * 30) / 40), 'series: impression-weighted position');
  assert(near(s.daily[0].ctr, 3 / 40), 'series: ctr = clicks / impressions');
  assert(s.totals.clicks === 3 && s.totals.impressions === 45, 'series: totals');
  assert(near(s.totals.position, (4 * 10 + 8 * 30 + 2 * 5) / 45), 'series: totals position weighted');
  assert(near(s.totals.ctr, 3 / 45), 'series: totals ctr');
  assert(s.matchedPages.length === 2 && !s.matchedPages.some((p) => p.endsWith('/other')), 'series: matchedPages only matching pages');
  const idSeries = buildTrackerSeries(rows, 'https://example.com/?p=5', '2026-03-01', '2026-03-05');
  assert(idSeries.matchedPages.length === 0 && idSeries.totals.impressions === 0, 'series: id-permalink target matches nothing');
  assert(idSeries.daily.length === 5, 'series: empty match still zero-filled');
}

// ── buildTrackerSeries: lastDataDate (days GSC has not reported yet are not zero) ──
{
  const url = 'https://example.com/post';
  const rows: RawGscRow[] = [{ keys: ['2026-03-02', url], clicks: 1, impressions: 5, position: 3 }];
  const cut = buildTrackerSeries(rows, url, '2026-03-01', '2026-03-10', '2026-03-05');
  assert(cut.daily.length === 5 && cut.daily[cut.daily.length - 1].date === '2026-03-05', 'lastDataDate: no zero-fill after it');
  const late: RawGscRow[] = [...rows, { keys: ['2026-03-07', url], clicks: 2, impressions: 4, position: 2 }];
  const ext = buildTrackerSeries(late, url, '2026-03-01', '2026-03-10', '2026-03-05');
  assert(ext.daily[ext.daily.length - 1].date === '2026-03-07' && ext.totals.clicks === 3, 'lastDataDate: a later day with data is kept');
  const past = buildTrackerSeries(rows, url, '2026-03-01', '2026-03-10', '2026-04-01');
  assert(past.daily.length === 10, 'lastDataDate: after the range end changes nothing');
  const bad = buildTrackerSeries(rows, url, '2026-03-01', '2026-03-10', 'nope');
  assert(bad.daily.length === 10, 'lastDataDate: invalid value ignored');
}

// ── isHostAllowedForSite ──
{
  assert(isHostAllowedForSite('example.com', 'sc-domain:example.com'), 'host: sc-domain apex');
  assert(isHostAllowedForSite('blog.example.com', 'sc-domain:example.com'), 'host: sc-domain subdomain');
  assert(!isHostAllowedForSite('evilexample.com', 'sc-domain:example.com'), 'host: sc-domain lookalike rejected');
  assert(!isHostAllowedForSite('example.com.evil.com', 'sc-domain:example.com'), 'host: sc-domain suffix trick rejected');
  assert(isHostAllowedForSite('www.example.com', 'https://example.com/'), 'host: url-prefix www added');
  assert(isHostAllowedForSite('example.com', 'https://www.example.com/'), 'host: url-prefix www dropped');
  assert(!isHostAllowedForSite('blog.example.com', 'https://example.com/'), 'host: url-prefix subdomain rejected');
  assert(!isHostAllowedForSite('', 'sc-domain:example.com') && !isHostAllowedForSite('example.com', ''), 'host: empty rejected');
  assert(!isHostAllowedForSite('localhost', 'sc-domain:localhost'), 'host: dotless domain rejected');
}

console.log(`\nAll ${passed} assertions passed`);
