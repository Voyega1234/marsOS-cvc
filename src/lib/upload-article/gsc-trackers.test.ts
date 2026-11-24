/**
 * Upload Article Report — Monitor (keyword + URL): normalize, key, add/remove, buildTrackerSeries, isHostAllowedForSite
 * Run: npx tsx src/lib/upload-article/gsc-trackers.test.ts
 */
import { createQueryBudget, GSC_TRACKER_QUERIES_PER_MINUTE } from './gsc-budget';
import {
  addGscTracker, addGscTrackersBulk, buildKeywordSuggestions, rankKeywordSuggestions, compareSuggestions, readSuggestSort, chunkKeywordRegex, assignSimilarKeywords, chunkSimilarRegex, isSimilarQuery, pickSimilarKeywords, similarScore, similarTokens, splitRowsByQuery, aggregateTrackerPerformance, withSimilarTotals, adoptGroupNamesake, trackerKeywordGroup, buildTrackerPageRegex, buildTrackerSeries, isIdPermalinkUrl, trackerKind, normalizeTrackerKeyword, normalizeTrackerUrl,
  readGscTrackers, removeGscTracker, removeGscTrackers, updateGscTrackers, normalizeTrackerGroup, trackerKey, trackerKeys, trackerUrlKey,
  applyTrackerFolderOp, readTrackerFolders, isTrackerFoldersClient, UPLOAD_MAX_TRACKER_FOLDERS, UPLOAD_MAX_TRACKER_SUBFOLDERS, type UploadGscTrackerFolder,
  GSC_TRACKER_ERROR_MESSAGES, UPLOAD_MAX_GSC_TRACKERS, type GscTrackerPerformance, type UploadGscTracker,
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
    { id: 'a3', keyword: '', url: 'https://example.com/c' }, // page-only (valid)
    { id: 'a5', keyword: 'kw', url: '' }, // keyword-only (valid)
    { id: 'a6', keyword: '', url: '' }, // broken
    { id: 'a4', keyword: 'x', url: 'nope' }, // broken
    null,
    'str',
    { keyword: 'x', url: 'https://example.com/d' }, // no id
  ]);
  assert(read.length === 3, 'read: drops broken and duplicate rows, keeps single-field rows');
  assert(trackerKind(read[1]) === 'page' && trackerKind(read[2]) === 'keyword' && trackerKind(read[0]) === 'pair', 'read: kinds');
  assert(read[0].keyword === 'foo' && read[0].title === 'My title', 'read: normalizes keyword and keeps title');
  assert(readGscTrackers('x').length === 0 && readGscTrackers(undefined).length === 0, 'read: non-array -> []');
  const many = Array.from({ length: UPLOAD_MAX_GSC_TRACKERS + 20 }, (_, i) => ({ id: `i${i}`, keyword: `k${i}`, url: 'https://example.com/p' }));
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
  assert(bad1.ok && trackerKind(bad1.tracker) === 'page', 'add: blank keyword + url (no kind) -> page tracker');
  const bad2 = addGscTracker([], { keyword: 'a', url: 'x' }, newId, 'n');
  assert(!bad2.ok && bad2.error === 'invalid_url', 'add: invalid_url');
  const dup = addGscTracker(r1.trackers, { keyword: 'FOO bar', url: 'http://example.com/a/' }, newId, 'n');
  assert(!dup.ok && dup.error === 'duplicate', 'add: duplicate');
  const full: UploadGscTracker[] = Array.from({ length: UPLOAD_MAX_GSC_TRACKERS }, (_, i) => ({ id: `f${i}`, keyword: `k${i}`, url: 'https://example.com/p', createdAt: '' }));
  const lim = addGscTracker(full, { keyword: 'new', url: 'https://example.com/p' }, newId, 'n');
  assert(!lim.ok && lim.error === 'limit', 'add: limit');
  assert(Object.keys(GSC_TRACKER_ERROR_MESSAGES).length === 7, 'add: every error has a message');
  assert(removeGscTracker(r2.ok ? r2.trackers : [], 'id1').length === 1, 'remove: removes by id');
  assert(removeGscTracker(r1.trackers, 'nope').length === 1, 'remove: unknown id is a no-op');
}

// ── kinds: keyword only / page only ──
{
  let n = 0;
  const newId = () => `k${++n}`;
  const kw = addGscTracker([], { kind: 'keyword', keyword: 'Foo', url: 'https://example.com/x', title: 'T' }, newId, 'n');
  assert(kw.ok && kw.tracker.url === '' && !('title' in kw.tracker) && trackerKind(kw.tracker) === 'keyword', 'kind keyword: url and title dropped');
  if (!kw.ok) throw new Error('unreachable');
  const pg = addGscTracker(kw.trackers, { kind: 'page', keyword: 'ignored', url: 'example.com/a', title: 'Post' }, newId, 'n');
  assert(pg.ok && pg.tracker.keyword === '' && pg.tracker.url === 'https://example.com/a' && pg.tracker.title === 'Post', 'kind page: keyword dropped');
  if (!pg.ok) throw new Error('unreachable');
  const pair = addGscTracker(pg.trackers, { kind: 'pair', keyword: 'foo', url: 'https://example.com/a' }, newId, 'n');
  assert(pair.ok && pair.trackers.length === 3, 'kind pair: does not collide with keyword-only or page-only');
  const dk = addGscTracker(kw.trackers, { kind: 'keyword', keyword: 'FOO' }, newId, 'n');
  assert(!dk.ok && dk.error === 'duplicate_keyword', 'kind keyword: duplicate_keyword');
  const dp = addGscTracker(pg.trackers, { kind: 'page', url: 'http://example.com/a/' }, newId, 'n');
  assert(!dp.ok && dp.error === 'duplicate_page', 'kind page: duplicate_page');
  const e1 = addGscTracker([], { kind: 'keyword', keyword: ' ' }, newId, 'n');
  assert(!e1.ok && e1.error === 'invalid_keyword', 'kind keyword: needs keyword');
  const e2 = addGscTracker([], { kind: 'page', url: '' }, newId, 'n');
  assert(!e2.ok && e2.error === 'invalid_url', 'kind page: needs url');
  const e3 = addGscTracker([], { kind: 'pair', keyword: 'a' }, newId, 'n');
  assert(!e3.ok && e3.error === 'invalid_url', 'kind pair: needs url');
  const e4 = addGscTracker([], {}, newId, 'n');
  assert(!e4.ok && e4.error === 'empty', 'no kind, no fields: empty');
  const d1 = addGscTracker([], { keyword: 'solo' }, newId, 'n');
  assert(d1.ok && trackerKind(d1.tracker) === 'keyword', 'no kind: keyword alone -> keyword tracker');
  const d2 = addGscTracker([], { url: 'https://example.com/z' }, newId, 'n');
  assert(d2.ok && trackerKind(d2.tracker) === 'page', 'no kind: url alone -> page tracker');
}

// ── buildTrackerPageRegex ──
{
  const re = buildTrackerPageRegex('https://example.com/blog/ข่าว/');
  const rx = new RegExp(re);
  assert(rx.test('https://example.com/blog/ข่าว') && rx.test('http://example.com/blog/ข่าว/'), 'regex: decoded path, scheme + slash variants');
  assert(rx.test('https://example.com/blog/%E0%B8%82%E0%B9%88%E0%B8%B2%E0%B8%A7/'), 'regex: encoded path');
  assert(!rx.test('https://example.com/blog/ข่าว/more') && !rx.test('https://evil.com/blog/ข่าว'), 'regex: anchored');
  assert(buildTrackerPageRegex('nope') === '', 'regex: invalid url -> empty');
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
  assert(s.hasData && !idSeries.hasData, 'series: hasData');
  const site = buildTrackerSeries(rows, '', '2026-03-01', '2026-03-05');
  assert(site.totals.clicks === 12 && site.totals.impressions === 144 && site.matchedPages.length === 0 && site.hasData, 'series: empty url counts every row (keyword site-wide)');
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

// ── owner ──
{
  const owners = new Set(['o1', 'o2']);
  const a = addGscTracker([], { kind: 'keyword', keyword: 'seo', ownerTagId: 'o1' }, () => 'k1', '2026-11-16T00:00:00Z', owners);
  assert(a.ok && a.tracker.ownerTagId === 'o1', 'owner: add keeps known owner');
  const b = addGscTracker([], { kind: 'keyword', keyword: 'seo', ownerTagId: 'ghost' }, () => 'k1', '2026-11-16T00:00:00Z', owners);
  assert(b.ok && b.tracker.ownerTagId === undefined, 'owner: add drops unknown owner');
  const c = addGscTracker([], { kind: 'keyword', keyword: 'seo', ownerTagId: 'o1' }, () => 'k1', '2026-11-16T00:00:00Z');
  assert(c.ok && c.tracker.ownerTagId === undefined, 'owner: add without owner set stores none');
  if (a.ok) {
    const round = readGscTrackers(JSON.parse(JSON.stringify(a.trackers)));
    assert(round[0].ownerTagId === 'o1', 'owner: survives read round-trip');
    const set2 = updateGscTrackers(a.trackers, ['k1'], { ownerTagId: 'o2' }, owners);
    assert(set2 !== null && set2[0].ownerTagId === 'o2', 'owner: set changes owner');
    assert(a.trackers[0].ownerTagId === 'o1', 'owner: set does not mutate input');
    const cleared = updateGscTrackers(a.trackers, ['k1'], { ownerTagId: '' }, owners);
    assert(cleared !== null && !('ownerTagId' in cleared[0]), 'owner: empty clears owner');
    const unknown = updateGscTrackers(a.trackers, ['k1'], { ownerTagId: 'ghost' }, owners);
    assert(unknown !== null && !('ownerTagId' in unknown[0]), 'owner: unknown owner clears');
    assert(updateGscTrackers(a.trackers, ['nope'], { ownerTagId: 'o1' }, owners) === null, 'owner: missing tracker -> null');
    const grouped = updateGscTrackers(a.trackers, ['k1'], { group: '  Blog 45  -  cpas ' }, owners);
    assert(grouped !== null && grouped[0].group === 'Blog 45 - cpas' && grouped[0].ownerTagId === 'o1', 'group: set keeps owner, normalizes name');
    const ungrouped = grouped && updateGscTrackers(grouped, ['k1'], { group: '' }, owners);
    assert(!!ungrouped && !('group' in ungrouped[0]), 'group: empty removes group');
  }
  assert(readGscTrackers([{ id: 'x', keyword: 'a', url: '', ownerTagId: 42 }])[0].ownerTagId === undefined, 'owner: non-string ignored on read');
  assert(normalizeTrackerGroup(5) === '' && normalizeTrackerGroup('x'.repeat(100)).length === 60, 'group: non-string empty, capped at 60');
  const g = addGscTracker([], { kind: 'keyword', keyword: 'cpas', group: 'Blog 45' }, () => 'g1', '2026-11-16T00:00:00Z');
  assert(g.ok && g.tracker.group === 'Blog 45' && readGscTrackers(g.trackers)[0].group === 'Blog 45', 'group: add stores group, survives read');
  const many: UploadGscTracker[] = ['a', 'b', 'c'].map((id) => ({ id, keyword: id, url: '', createdAt: '' }));
  const moved = updateGscTrackers(many, ['a', 'c', 'zzz'], { group: 'G' }, owners);
  assert(!!moved && moved[0].group === 'G' && moved[1].group === undefined && moved[2].group === 'G', 'group: bulk move only listed ids');
  assert(removeGscTrackers(many, ['a', 'b']).map((t) => t.id).join() === 'c', 'remove: bulk');

  // subgroup: lives only inside a group
  const sg = addGscTracker([], { kind: 'keyword', keyword: 'cpas', group: 'Ads', subgroup: '  แบรนด์  ' }, () => 's1', 'now');
  assert(sg.ok && sg.tracker.subgroup === 'แบรนด์' && readGscTrackers(sg.trackers)[0].subgroup === 'แบรนด์', 'subgroup: add stores normalized subgroup, survives read');
  const noGroup = addGscTracker([], { kind: 'keyword', keyword: 'cpas', subgroup: 'X' }, () => 's2', 'now');
  assert(noGroup.ok && !('subgroup' in noGroup.tracker), 'subgroup: dropped on add without group');
  assert(!('subgroup' in readGscTrackers([{ id: 'x', keyword: 'a', url: '', subgroup: 'X' }])[0]), 'subgroup: dropped on read without group');
  const inG = updateGscTrackers(many, ['a', 'b'], { group: 'G', subgroup: 'S' }, owners)!;
  assert(inG[0].group === 'G' && inG[0].subgroup === 'S' && inG[2].subgroup === undefined, 'subgroup: set with group');
  const renamed = updateGscTrackers(inG, ['a', 'b'], { group: 'G2' }, owners)!;
  assert(renamed[0].group === 'G2' && renamed[0].subgroup === 'S', 'subgroup: kept when only the group is renamed');
  const subOnly = updateGscTrackers(renamed, ['a', 'c'], { subgroup: 'T' }, owners)!;
  assert(subOnly[0].subgroup === 'T' && subOnly[2].subgroup === undefined, 'subgroup: not set on an item without a group');
  const subCleared = updateGscTrackers(subOnly, ['a'], { subgroup: '' }, owners)!;
  assert(!('subgroup' in subCleared[0]) && subCleared[0].group === 'G2', 'subgroup: empty removes subgroup, keeps group');
  const outOfGroup = updateGscTrackers(subOnly, ['a'], { group: '' }, owners)!;
  assert(!('group' in outOfGroup[0]) && !('subgroup' in outOfGroup[0]), 'subgroup: removed together with the group');
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

// ── aggregateTrackerPerformance (KPI + กราฟของผู้ดูแล) ──
{
  const pt = (date: string, clicks: number, impressions: number, position: number) =>
    ({ date, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });
  const perf = (id: string, over: Partial<GscTrackerPerformance>): GscTrackerPerformance => ({
    id, keyword: 'k', url: '', createdAt: '2026-11-01T00:00:00.000Z', kind: 'keyword', matchUrl: '',
    hasData: true, unresolved: false, matchedPages: [],
    totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    prevTotals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    daily: [], dailyPrev: [], ...over,
  });
  const a = perf('a', {
    totals: { clicks: 10, impressions: 100, ctr: 0.1, position: 4 },
    prevTotals: { clicks: 5, impressions: 50, ctr: 0.1, position: 8 },
    daily: [pt('2026-11-01', 6, 60, 3), pt('2026-11-02', 4, 40, 5.5)],
    dailyPrev: [pt('2026-10-01', 5, 50, 8)],
  });
  const b = perf('b', {
    totals: { clicks: 30, impressions: 300, ctr: 0.1, position: 12 },
    prevTotals: { clicks: 15, impressions: 150, ctr: 0.1, position: 10 },
    daily: [pt('2026-11-01', 30, 300, 12)],
    dailyPrev: [pt('2026-10-01', 15, 150, 10)],
  });
  const skipped = perf('c', { unresolved: true, totals: { clicks: 999, impressions: 999, ctr: 1, position: 1 } });

  const agg = aggregateTrackerPerformance([a, b, skipped])!;
  assert(agg.count === 2, 'aggregate: unresolved trackers are skipped');
  assert(agg.overview.current.clicks === 40 && agg.overview.current.impressions === 400, 'aggregate: clicks and impressions add up');
  assert(near(agg.overview.current.ctr, 0.1), 'aggregate: CTR = clicks / impressions');
  assert(near(agg.overview.current.position, (4 * 100 + 12 * 300) / 400), 'aggregate: position weighted by impressions');
  assert(near(agg.overview.previous.position, (8 * 50 + 10 * 150) / 200), 'aggregate: previous period weighted the same way');
  assert(agg.overview.deltaAbs.clicks === 20 && agg.overview.deltaPct.clicks === 100, 'aggregate: deltas use the buildOverview formula');
  assert(agg.daily.length === 2 && agg.daily[0].date === '2026-11-01' && agg.daily[0].clicks === 36, 'aggregate: daily points with the same date are summed');
  assert(near(agg.daily[0].position, (3 * 60 + 12 * 300) / 360), 'aggregate: daily position weighted by impressions');
  assert(agg.daily[1].clicks === 4 && agg.dailyPrev.length === 1 && agg.dailyPrev[0].clicks === 20, 'aggregate: dates only one tracker has stay, previous series summed');
  assert(aggregateTrackerPerformance([]) === null && aggregateTrackerPerformance([skipped]) === null, 'aggregate: nothing usable = null');
}

{
  // ── หาคำใกล้เคียง + เพิ่มหลายคำ ──
  const existing: UploadGscTracker[] = [
    { id: 'e1', keyword: 'cpas', url: '', createdAt: '' },
    { id: 'e2', keyword: 'cpas ads', url: 'https://example.com/a', createdAt: '' },
  ];
  let n = 0;
  const bulk = addGscTrackersBulk(existing, ['CPAS คือ', 'cpas', '  ', 'cpas ads', 'cpas คือ'], { group: 'Blog 45 - cpas', ownerTagId: 'o1' }, () => `b${n++}`, 'now', new Set(['o1']));
  assert(bulk.added.length === 2 && bulk.added[0].keyword === 'cpas คือ' && bulk.added[1].keyword === 'cpas ads', 'bulk: new keywords added, pair with same keyword is not a duplicate of keyword-only');
  assert(bulk.duplicates === 2 && bulk.invalid === 1 && bulk.overLimit === 0, 'bulk: duplicates and empty counted');
  assert(bulk.added.every((t) => t.group === 'Blog 45 - cpas' && t.ownerTagId === 'o1' && t.url === ''), 'bulk: group, owner, keyword-only');
  assert(bulk.trackers[0].keyword === 'cpas คือ' && bulk.trackers[1].keyword === 'cpas ads' && bulk.trackers.length === 4, 'bulk: added in the given order on top');
  assert(existing.length === 2, 'bulk: input not mutated');
  const nearFull: UploadGscTracker[] = Array.from({ length: UPLOAD_MAX_GSC_TRACKERS - 1 }, (_, i) => ({ id: `f${i}`, keyword: `k${i}`, url: '', createdAt: '' }));
  const capped = addGscTrackersBulk(nearFull, ['x1', 'x2', 'x3'], {}, () => `z${n++}`, 'now');
  assert(capped.added.length === 1 && capped.overLimit === 2 && capped.trackers.length === UPLOAD_MAX_GSC_TRACKERS, 'bulk: stops at the limit');

  const sugg = buildKeywordSuggestions(
    [
      { keys: ['cpas'], clicks: 5, impressions: 100, ctr: 0.05, position: 7 },
      { keys: ['cpas คือ'], clicks: 9, impressions: 50, ctr: 0.18, position: 3 },
      { keys: ['cpas pantip'], clicks: 50, impressions: 500, ctr: 0.1, position: 2 },
      { keys: ['cpas ads'], clicks: 9, impressions: 80, ctr: 0.11, position: 6 },
    ],
    [{ keys: ['cpas คือ'], clicks: 4, impressions: 40, ctr: 0.1, position: 5 }],
    existing,
    { exclude: (k) => k.includes('pantip') },
  );
  assert(sugg.map((s) => s.keyword).join(',') === 'cpas ads,cpas คือ,cpas', 'suggest: sorted by clicks then impressions, excluded dropped');
  assert(sugg[2].tracked && !sugg[0].tracked, 'suggest: keyword-only tracker marks tracked, pair does not');
  assert(sugg[1].prevClicks === 4 && sugg[1].prevPosition === 5 && sugg[0].prevClicks === 0, 'suggest: previous period joined');

  const allRows = [
    { keys: ['a'], clicks: 1, impressions: 900, ctr: 0.001, position: 12 },
    { keys: ['b'], clicks: 20, impressions: 100, ctr: 0.2, position: 4 },
    { keys: ['c'], clicks: 3, impressions: 10, ctr: 0.3, position: 1.5 },
    { keys: ['d'], clicks: 0, impressions: 5, ctr: 0, position: 0 },
    { keys: ['B'], clicks: 99, impressions: 999, ctr: 0.1, position: 1 },
  ];
  const order = (sort: Parameters<typeof compareSuggestions>[0]) => rankKeywordSuggestions(allRows, [], [], { sort }).suggestions.map((s) => s.keyword).join(',');
  assert(order('clicks') === 'b,c,a,d', 'rank: clicks desc, duplicate after normalize dropped');
  assert(order('impressions') === 'a,b,c,d', 'rank: impressions desc');
  assert(order('ctr') === 'c,b,a,d', 'rank: ctr desc');
  assert(order('position') === 'c,b,a,d', 'rank: best position first, no position last');
  const cut = rankKeywordSuggestions(allRows, [], [], { sort: 'impressions', limit: 2 });
  assert(cut.total === 4 && cut.suggestions.map((s) => s.keyword).join(',') === 'a,b', 'rank: total counts before the cut, cut follows the sort');
  assert(readSuggestSort('ctr') === 'ctr' && readSuggestSort('x') === 'clicks' && readSuggestSort(undefined) === 'clicks', 'rank: unknown sort falls back to clicks');

  const chunks = chunkKeywordRegex(Array.from({ length: 30 }, (_, i) => `k.${i}`).concat(['k.0']));
  assert(chunks.length === 2 && chunks[0].keywords.length === 25 && chunks[1].keywords.length === 5, 'chunk: 25 per batch, duplicates dropped');
  assert(chunks[0].regex.startsWith('(?i)^(?:k\\.0|k\\.1|') && chunks[0].regex.endsWith(')$'), 'chunk: escaped, anchored, case-insensitive');
  assert(chunkKeywordRegex(['a'.repeat(60), 'b'.repeat(60)], 25, 100).length === 2, 'chunk: split by length');

  const split = splitRowsByQuery([
    { keys: ['2026-11-01', 'CPAS'], clicks: 1, impressions: 10, position: 3 },
    { keys: ['2026-11-02', 'cpas'], clicks: 2, impressions: 20, position: 4 },
    { keys: ['2026-11-01', 'cpas คือ'], clicks: 3, impressions: 30, position: 5 },
  ]);
  assert(split.get('cpas')?.length === 2 && split.get('cpas')![0].keys!.length === 1, 'split: grouped by normalized query, keys = [date]');
  const s2 = buildTrackerSeries(split.get('cpas')!, '', '2026-11-01', '2026-11-02');
  assert(s2.totals.clicks === 3 && s2.totals.impressions === 30, 'split: feeds buildTrackerSeries');
  const split3 = splitRowsByQuery([{ keys: ['2026-11-01', 'cpas', 'https://example.com/a/'], clicks: 4, impressions: 40, position: 2 }]);
  assert(split3.get('cpas')![0].keys!.join('|') === '2026-11-01|https://example.com/a/', 'split: (date, query, page) -> (date, page)');
  const s3 = buildTrackerSeries(split3.get('cpas')!, 'https://example.com/a', '2026-11-01', '2026-11-01');
  assert(s3.totals.clicks === 4, 'split: pair rows match the page');
}

{
  const b = createQueryBudget(10, 60_000);
  assert(b.take(8, 0) && !b.take(3, 1000) && b.used(1000) === 8, 'budget: refuses over the limit and reserves nothing');
  assert(b.take(2, 1000) && !b.take(1, 59_999), 'budget: full at the limit');
  assert(b.take(8, 60_000) && b.used(60_000) === 10, 'budget: frees the oldest after the window');
  assert(GSC_TRACKER_QUERIES_PER_MINUTE * 2 <= 600, 'budget: two instances stay under half of 1,200/min');
}
// ── similar keywords (found automatically under each tracker) ──
{
  const tokens = similarTokens('รับทำ chatgpt ads');
  assert(tokens.includes('chatgpt') && tokens.includes('ads') && tokens.includes('รับ') && tokens.includes('ทำ'), 'similar: Thai + English words segmented');
  assert(isSimilarQuery('chatgpt ads รับทำ', tokens), 'similar: word order swapped');
  assert(isSimilarQuery('chatgpt ads', tokens), 'similar: shorter variant');
  assert(!isSimilarQuery('chatgpt', tokens), 'similar: one word is not enough');
  assert(!isSimilarQuery('รับทำเว็บ', tokens), 'similar: unrelated query with the short words only');
  assert(!isSimilarQuery('รับทำ ads facebook', tokens), 'similar: misses the strongest word');
  assert(isSimilarQuery('CPAS คือ', similarTokens('cpas')), 'similar: one-word keyword, case-insensitive');

  const [chunk] = chunkSimilarRegex(['รับทำ chatgpt ads', 'cpas']);
  const re = new RegExp(chunk.regex.replace(/^\(\?i\)/, ''), 'i');
  assert(chunk.keywords.length === 2 && chunk.regex.startsWith('(?i)'), 'similar regex: one batch, case-insensitive');
  for (const q of ['chatgpt ads รับทำ', 'ads chatgpt', 'cpas คือ']) assert(re.test(q), `similar regex: matches "${q}"`);
  assert(!re.test('รับทำเว็บ'), 'similar regex: skips unrelated query');
  assert(chunkSimilarRegex(Array.from({ length: 20 }, (_, i) => `kw${i} test${i}`)).length === 2, 'similar regex: 15 keywords per batch');

  const cur: RawGscRow[] = [
    { keys: ['chatgpt ads รับทำ'], clicks: 2, impressions: 50, ctr: 0.04, position: 8 },
    { keys: ['รับทำ chatgpt ads'], clicks: 9, impressions: 90, ctr: 0.1, position: 3 },
    { keys: ['chatgpt ads'], clicks: 5, impressions: 200, ctr: 0.025, position: 12 },
    { keys: ['chatgpt ads pantip'], clicks: 9, impressions: 99, ctr: 0.09, position: 2 },
    { keys: ['รับทำ chatgpt ads ราคา'], clicks: 0, impressions: 10, ctr: 0, position: 30 },
    { keys: ['รับทำเว็บ'], clicks: 50, impressions: 900, ctr: 0.05, position: 4 },
  ];
  const prev: RawGscRow[] = [{ keys: ['chatgpt ads'], clicks: 1, impressions: 80, ctr: 0.0125, position: 15 }];
  const picked = pickSimilarKeywords(cur, prev, 'รับทำ ChatGPT ads', {
    skip: new Set(['รับทำ chatgpt ads ราคา']), exclude: (k) => k.includes('pantip'),
  });
  assert(picked.map((x) => x.keyword).join('|') === 'chatgpt ads|chatgpt ads รับทำ', 'similar pick: self, skip, excluded and unrelated left out; sorted by clicks');
  assert(picked[0].prevTotals.clicks === 1 && picked[1].prevTotals.impressions === 0, 'similar pick: previous period joined, missing = 0');
  assert(pickSimilarKeywords(cur, prev, 'รับทำ chatgpt ads', { limit: 1 }).length === 1, 'similar pick: limit');

  // A platform or brand word in a Thai keyword must be in the query
  const tiktok = similarTokens('รับยิงโฆษณา tiktok');
  assert(!isSimilarQuery('รับยิงโฆษณา ig', tiktok), 'similar: ig query is not similar to the tiktok keyword');
  assert(!isSimilarQuery('รับยิงโฆษณา', tiktok), 'similar: query without the platform word');
  assert(isSimilarQuery('ยิงโฆษณา tiktok ราคา', tiktok), 'similar: tiktok variant with an extra word');
  assert(isSimilarQuery('รับยิงโฆษณาtiktok', tiktok), 'similar: Thai glued to Latin is split');
  assert(!isSimilarQuery('digital โฆษณา รับยิง', similarTokens('รับยิงโฆษณา ig')), 'similar: Latin word must be a whole word');
  assert(!isSimilarQuery('รับยิงโฆษณา เฟสบุ๊ค', similarTokens('รับยิงโฆษณา ติ๊กต๊อก')), 'similar: platform swapped in Thai');
  assert(isSimilarQuery('บริษัท รับทำ seo กรุงเทพ', similarTokens('รับทำ seo')), 'similar: long-tail query that keeps every word');
  assert(isSimilarQuery('top seo agency bangkok', similarTokens('best seo agency in bangkok')), 'similar: English keyword, one word swapped');
  assert(!isSimilarQuery('facebook ads agency', similarTokens('tiktok ads agency')), 'similar: English keyword, brand swapped');
  assert(!isSimilarQuery('iphone 16 ราคา', similarTokens('iphone 15 ราคา')), 'similar: model number must match');
  assert(similarScore('รับยิงโฆษณา tiktok', tiktok) === 1 && similarScore('ยิงโฆษณา tiktok ราคา', tiktok) < 1, 'similar score: 1 for the same words, lower with changes');
  const [mixed] = chunkSimilarRegex(['รับยิงโฆษณา tiktok']);
  const mixedRe = new RegExp(mixed.regex.replace(/^\(\?i\)/, ''), 'i');
  assert(mixedRe.test('ยิงโฆษณา tiktok ราคา') && !mixedRe.test('รับยิงโฆษณา ig'), 'similar regex: Thai keyword with a platform word asks GSC for that word only');

  // Each query goes to the one keyword it is closest to
  const pool: RawGscRow[] = [
    { keys: ['ยิงโฆษณา ig ราคา'], clicks: 4, impressions: 40, ctr: 0.1, position: 6 },
    { keys: ['ยิงโฆษณา tiktok ราคา'], clicks: 3, impressions: 30, ctr: 0.1, position: 7 },
    { keys: ['รับยิงโฆษณา ราคา'], clicks: 2, impressions: 20, ctr: 0.1, position: 9 },
    { keys: ['รับยิงโฆษณา ig'], clicks: 9, impressions: 90, ctr: 0.1, position: 2 },
    { keys: ['รับยิงโฆษณา tiktok pantip'], clicks: 9, impressions: 90, ctr: 0.1, position: 2 },
    { keys: ['รับทำเว็บไซต์'], clicks: 50, impressions: 900, ctr: 0.05, position: 4 },
  ];
  const assigned = assignSimilarKeywords(pool, [], ['รับยิงโฆษณา TikTok', 'รับยิงโฆษณา ig', 'รับยิงโฆษณา', 'รับยิงโฆษณา ig'], {
    skip: new Set(['รับยิงโฆษณา tiktok', 'รับยิงโฆษณา ig', 'รับยิงโฆษณา']), exclude: (k) => k.includes('pantip'),
  });
  const names = (k: string) => (assigned.get(k) ?? []).map((x) => x.keyword).join('|');
  assert(assigned.size === 3, 'similar assign: one list per distinct keyword');
  assert(names('รับยิงโฆษณา tiktok') === 'ยิงโฆษณา tiktok ราคา', 'similar assign: tiktok keyword gets only tiktok queries');
  assert(names('รับยิงโฆษณา ig') === 'ยิงโฆษณา ig ราคา', 'similar assign: ig query sits under the ig keyword');
  assert(names('รับยิงโฆษณา') === 'รับยิงโฆษณา ราคา', 'similar assign: platform queries leave the general keyword for their own');
  const synonym: RawGscRow[] = [{ keys: ['รับยิงแอด ig'], clicks: 1, impressions: 10, ctr: 0.1, position: 5 }];
  assert(assignSimilarKeywords(synonym, [], ['ยิงแอด', 'รับยิงโฆษณา ig']).get('รับยิงโฆษณา ig')!.length === 1, 'similar assign: the keyword that shares the platform word wins over a closer general one');
  assert(assignSimilarKeywords(pool, [], ['รับยิงโฆษณา']).get('รับยิงโฆษณา')!.length === 5, 'similar assign: with no closer keyword, the general one keeps them');
}

// ── folders + keyword groups (Convert Cake) ──
{
  const NOW = '2026-11-23T00:00:00.000Z';
  const owners = new Set(['o1', 'o2']);
  const tr = (id: string, kw: string, extra: Partial<UploadGscTracker> = {}): UploadGscTracker => ({ id, keyword: kw, url: '', createdAt: '', ...extra });
  const run = (f: UploadGscTrackerFolder[], t: UploadGscTracker[], op: unknown) => applyTrackerFolderOp(f, t, op, owners, NOW);
  const okR = (r: ReturnType<typeof run>) => { if (!r.ok) throw new Error('expected ok, got ' + r.error); return r; };
  const errOf = (r: ReturnType<typeof run>) => (r.ok ? 'ok' : r.error);

  assert(isTrackerFoldersClient('Convert Cake') && isTrackerFoldersClient('convertcake.com') && isTrackerFoldersClient('Mfactors') && isTrackerFoldersClient('โปรเจกต์ใหม่') && isTrackerFoldersClient(), 'folders: enabled for every client, new ones included');

  const rf = readTrackerFolders([
    { name: '  A   B ', ownerTagId: ' o1 ', subgroups: ['x', 'x', ' ', 'y', 5], createdAt: 't' },
    { name: 'A B', subgroups: [] }, { name: '' }, null, 'str', { name: 'C', ownerTagId: 7 },
  ]);
  assert(rf.length === 2 && rf[0].name === 'A B' && rf[0].ownerTagId === 'o1' && rf[0].subgroups.join() === 'x,y' && rf[1].name === 'C' && !('ownerTagId' in rf[1]) && rf[1].createdAt === '', 'folders: read sanitizes names, dupes, owner, subgroups');
  assert(readTrackerFolders('x').length === 0, 'folders: non-array -> empty');
  assert(readTrackerFolders(Array.from({ length: 80 }, (_, i) => ({ name: 'f' + i }))).length === UPLOAD_MAX_TRACKER_FOLDERS, 'folders: read caps folder count');
  assert(readTrackerFolders([{ name: 'a', subgroups: Array.from({ length: 80 }, (_, i) => 's' + i) }])[0].subgroups.length === UPLOAD_MAX_TRACKER_SUBFOLDERS, 'folders: read caps subgroups');

  // create
  const c1 = okR(run([], [], { op: 'create', name: ' Proj  1 ', ownerTagId: 'o1' }));
  assert(c1.folders.length === 1 && c1.folders[0].name === 'Proj 1' && c1.folders[0].ownerTagId === 'o1' && c1.folders[0].createdAt === NOW, 'create: adds record with owner');
  assert(!('ownerTagId' in okR(run([], [], { op: 'create', name: 'P', ownerTagId: 'zzz' })).folders[0]), 'create: unknown owner dropped');
  assert(errOf(run([], [], { op: 'create', name: '  ' })) === 'invalid', 'create: empty name invalid');
  assert(errOf(run(c1.folders, [], { op: 'create', name: 'Proj 1' })) === 'duplicate', 'create: duplicate by record');
  assert(errOf(run([], [tr('a', 'k', { group: 'G' })], { op: 'create', name: 'G' })) === 'duplicate', 'create: duplicate by tracker group');
  const full = Array.from({ length: UPLOAD_MAX_TRACKER_FOLDERS }, (_, i) => ({ name: 'f' + i, subgroups: [], createdAt: '' }));
  assert(errOf(run(full, [], { op: 'create', name: 'new' })) === 'limit', 'create: folder limit');
  assert(errOf(run([], [], { op: 'bogus' })) === 'invalid' && errOf(run([], [], null)) === 'invalid' && errOf(run([], [], { op: 5 })) === 'invalid', 'op: unknown/garbage invalid');

  // createSub
  const T = [tr('a', 'k1', { group: 'G' }), tr('b', 'k2', { group: 'G' }), tr('c', 'k3', { group: 'H' }), tr('d', 'k4')];
  const s1 = okR(run([], T, { op: 'createSub', folder: 'G', subgroup: 'Brand', ids: ['a', 'c', 'd'] }));
  assert(s1.folders.length === 1 && s1.folders[0].name === 'G' && s1.folders[0].subgroups.join() === 'Brand', 'createSub: creates record for tracker-only folder');
  assert(s1.trackers.find((t) => t.id === 'a')!.subgroup === 'Brand' && !s1.trackers.find((t) => t.id === 'c')!.subgroup && !s1.trackers.find((t) => t.id === 'd')!.subgroup && !s1.trackers.find((t) => t.id === 'b')!.subgroup, 'createSub: ids limited to trackers in the folder');
  assert(!T[0].subgroup, 'createSub: inputs not mutated');
  assert(errOf(run([], T, { op: 'createSub', folder: 'Nope', subgroup: 'x' })) === 'not_found', 'createSub: folder missing');
  assert(errOf(run([], T, { op: 'createSub', folder: 'G', subgroup: ' ' })) === 'invalid', 'createSub: empty subgroup invalid');
  assert(errOf(run(s1.folders, s1.trackers, { op: 'createSub', folder: 'G', subgroup: 'Brand' })) === 'duplicate', 'createSub: duplicate in record');
  assert(errOf(run([], [tr('a', 'k', { group: 'G', subgroup: 'S' })], { op: 'createSub', folder: 'G', subgroup: 'S' })) === 'duplicate', 'createSub: duplicate on tracker');
  const manySubs = [{ name: 'G', subgroups: Array.from({ length: UPLOAD_MAX_TRACKER_SUBFOLDERS }, (_, i) => 's' + i), createdAt: '' }];
  assert(errOf(run(manySubs, [], { op: 'createSub', folder: 'G', subgroup: 'new' })) === 'limit', 'createSub: subgroup limit');

  // rename
  const F: UploadGscTrackerFolder[] = [{ name: 'G', ownerTagId: 'o1', subgroups: ['a', 'b'], createdAt: 'x' }, { name: 'H', ownerTagId: 'o2', subgroups: ['b', 'c'], createdAt: 'y' }];
  const RT = [tr('1', 'k1', { group: 'G', subgroup: 'a' }), tr('2', 'k2', { group: 'H' })];
  const r1 = okR(run(F, RT, { op: 'rename', folder: 'G', name: 'Z' }));
  assert(r1.folders.map((f) => f.name).join() === 'Z,H' && r1.folders[0].ownerTagId === 'o1' && r1.folders[0].subgroups.join() === 'a,b', 'rename: renames record, keeps owner/subgroups/position');
  assert(r1.trackers[0].group === 'Z' && r1.trackers[0].subgroup === 'a', 'rename: trackers follow, keep subgroup');
  assert(okR(run(F, RT, { op: 'rename', folder: 'G', name: 'G' })).folders === F, 'rename: same name no-op');
  const r2 = okR(run(F, RT, { op: 'rename', folder: 'G', name: 'H' }));
  assert(r2.folders.length === 1 && r2.folders[0].name === 'H' && r2.folders[0].ownerTagId === 'o2' && r2.folders[0].subgroups.join() === 'b,c,a', 'rename: merge keeps target owner, unions subgroups');
  assert(r2.trackers.every((t) => t.group === 'H'), 'rename: merge moves trackers');
  const r3 = okR(run([], [tr('a', 'k', { group: 'Old' })], { op: 'rename', folder: 'Old', name: 'New' }));
  assert(r3.folders.length === 1 && r3.folders[0].name === 'New' && r3.trackers[0].group === 'New', 'rename: tracker-only folder gets a record');
  assert(errOf(run(F, RT, { op: 'rename', folder: 'G', name: ' ' })) === 'invalid' && errOf(run(F, RT, { op: 'rename', folder: 'X', name: 'Q' })) === 'not_found', 'rename: errors');

  // renameSub
  const ST = [tr('1', 'k1', { group: 'G', subgroup: 'a' }), tr('2', 'k2', { group: 'G', subgroup: 'b' }), tr('3', 'k3', { group: 'H', subgroup: 'a' })];
  const q1 = okR(run(F, ST, { op: 'renameSub', folder: 'G', subgroup: 'a', name: 'A2' }));
  assert(q1.folders[0].subgroups.join() === 'A2,b' && q1.trackers[0].subgroup === 'A2' && q1.trackers[2].subgroup === 'a', 'renameSub: renames in folder only');
  const q2 = okR(run(F, ST, { op: 'renameSub', folder: 'G', subgroup: 'a', name: 'b' }));
  assert(q2.folders[0].subgroups.join() === 'b' && q2.trackers[0].subgroup === 'b', 'renameSub: merge into existing');
  const q3 = okR(run(F, ST, { op: 'renameSub', folder: 'G', subgroup: 'a', name: '' }));
  assert(q3.folders[0].subgroups.join() === 'b' && !q3.trackers[0].subgroup && q3.trackers[0].group === 'G', 'renameSub: empty name removes subgroup, trackers stay in folder');
  assert(errOf(run(F, ST, { op: 'renameSub', folder: 'G', subgroup: 'zz', name: 'q' })) === 'not_found', 'renameSub: missing sub');

  // owner
  const w1 = okR(run(F, RT, { op: 'owner', folder: 'G', ownerTagId: 'o2' }));
  assert(w1.folders[0].ownerTagId === 'o2' && w1.trackers[0].ownerTagId === 'o2' && !w1.trackers[1].ownerTagId, 'owner: set on record and its trackers only');
  const w2 = okR(run(w1.folders, w1.trackers, { op: 'owner', folder: 'G', ownerTagId: 'unknown' }));
  assert(!('ownerTagId' in w2.folders[0]) && !('ownerTagId' in w2.trackers[0]), 'owner: unknown clears field');
  assert(okR(run([], [tr('a', 'k', { group: 'G' })], { op: 'owner', folder: 'G', ownerTagId: 'o1' })).folders[0].ownerTagId === 'o1', 'owner: creates record when missing');
  assert(errOf(run(F, RT, { op: 'owner', folder: 'X', ownerTagId: 'o1' })) === 'not_found', 'owner: folder missing');

  // delete / deleteSub
  const d1 = okR(run(F, ST, { op: 'delete', folder: 'G' }));
  assert(d1.folders.length === 1 && d1.folders[0].name === 'H' && d1.trackers.length === 3 && !d1.trackers[0].group && !d1.trackers[0].subgroup && d1.trackers[2].group === 'H', 'delete: drops record, keeps trackers ungrouped');
  assert(errOf(run(F, ST, { op: 'delete', folder: 'X' })) === 'not_found', 'delete: missing');
  const e1 = okR(run(F, ST, { op: 'deleteSub', folder: 'G', subgroup: 'a' }));
  assert(e1.folders[0].subgroups.join() === 'b' && !e1.trackers[0].subgroup && e1.trackers[0].group === 'G' && e1.trackers[2].subgroup === 'a', 'deleteSub: removes sub only in that folder');
  assert(errOf(run(F, ST, { op: 'deleteSub', folder: 'G', subgroup: 'nope' })) === 'not_found', 'deleteSub: missing');
  const e2 = okR(run(F, ST, { op: 'deleteSub', folder: 'G', subgroup: 'a', untrack: true }));
  assert(e2.folders[0].subgroups.join() === 'b' && e2.trackers.length === ST.length - 1 && !e2.trackers.some((t) => t.id === ST[0].id) && e2.trackers.some((t) => t.group === 'H' && t.subgroup === 'a'), 'deleteSub untrack: removes the group and stops tracking its keywords, other folders untouched');
  assert(okR(run(F, ST, { op: 'deleteSub', folder: 'G', subgroup: 'a', untrack: 'yes' })).trackers.length === ST.length, 'deleteSub: untrack must be exactly true');

  // bulk with subgroup
  const bk = addGscTrackersBulk([], ['kw one', 'kw two'], { group: 'G', subgroup: 'S' }, (() => { let n = 0; return () => 'id' + n++; })(), NOW);
  assert(bk.added.length === 2 && bk.added.every((t) => t.group === 'G' && t.subgroup === 'S'), 'bulk: passes subgroup');
}

// ── withSimilarTotals: a keyword's numbers counted together with its similar keywords ──
{
  const m = (clicks: number, impressions: number, position: number) => ({ clicks, impressions, ctr: impressions > 0 ? clicks / impressions : 0, position });
  const plain = { totals: m(10, 100, 4), prevTotals: m(5, 50, 6) };
  assert(withSimilarTotals(plain) === plain, 'withSimilarTotals: no similar keywords = same object');
  const empty = { ...plain, similar: [] };
  assert(withSimilarTotals(empty) === empty, 'withSimilarTotals: empty similar list = same object');
  const p = {
    ...plain,
    daily: [{ date: '2026-11-01', ...m(10, 100, 4) }],
    similar: [
      { keyword: 'a', totals: m(30, 300, 8), prevTotals: m(15, 150, 10) },
      { keyword: 'b', totals: m(0, 0, 0), prevTotals: m(0, 100, 20) },
    ],
  };
  const w = withSimilarTotals(p);
  assert(w.totals.clicks === 40 && w.totals.impressions === 400, 'withSimilarTotals: clicks and impressions add up');
  assert(Math.abs(w.totals.ctr - 0.1) < 1e-9, 'withSimilarTotals: CTR recomputed from the sums');
  assert(Math.abs(w.totals.position - 7) < 1e-9, 'withSimilarTotals: position weighted by impressions');
  assert(w.prevTotals.clicks === 20 && w.prevTotals.impressions === 300 && Math.abs(w.prevTotals.position - (6 * 50 + 10 * 150 + 20 * 100) / 300) < 1e-9, 'withSimilarTotals: previous period summed the same way');
  assert(w.daily === p.daily && w.similar === p.similar, 'withSimilarTotals: daily series and the similar list are untouched');
  assert(p.totals.clicks === 10 && p.prevTotals.clicks === 5, 'withSimilarTotals: input not mutated');
}

// ── adoptGroupNamesake: the keyword a keyword group is named after joins the group ──
{
  const mk = (id: string, keyword: string, url: string, group?: string, subgroup?: string): UploadGscTracker =>
    ({ id, keyword, url, createdAt: '2026-11-23T00:00:00.000Z', ...(group ? { group } : {}), ...(subgroup ? { subgroup } : {}) } as UploadGscTracker);
  const list = [
    mk('a', 'convert cake', '', 'Ads'),
    mk('b', 'convertcake', '', 'Ads', 'convert cake'),
    mk('c', 'convert cake', 'https://x.test/p', 'Ads'),
    mk('d', 'convert cake', '', 'Other'),
    mk('e', 'รับยิงแอด', '', 'Ads'),
    mk('f', 'convert cake', ''),
  ];
  const out = adoptGroupNamesake(list, 'Ads', '  Convert   Cake ');
  assert(out !== list && out[0].subgroup === 'Convert Cake', 'adopt: namesake keyword in the folder moves into the group (name normalized, case-insensitive)');
  assert(out[1] === list[1] && out[2] === list[2] && !out[2].subgroup, 'adopt: keyword+page tracker and existing members untouched');
  assert(!out[3].subgroup && !out[4].subgroup && !out[5].subgroup, 'adopt: other folders, other keywords and ungrouped trackers untouched');
  assert(!list[0].subgroup, 'adopt: input not mutated');
  assert(adoptGroupNamesake(list, 'Ads', 'ไม่มีคำนี้') === list, 'adopt: no namesake = same array');
  assert(adoptGroupNamesake(list, 'Ads', '') === list && adoptGroupNamesake(list, '', 'convert cake') === list && adoptGroupNamesake(list, 'Ads', undefined) === list, 'adopt: needs both folder and keyword group');
  const again = adoptGroupNamesake(out, 'Ads', 'convert cake');
  assert(again === out, 'adopt: already in a group = left where it is');
}

// ── trackerKeywordGroup: the keyword group a tracker counts under ──
{
  const base = { id: 'x', createdAt: '2026-11-23T00:00:00.000Z' };
  assert(trackerKeywordGroup({ ...base, keyword: 'รับทำ chatgpt ads', url: '', group: 'Ads Landingpage' }) === 'รับทำ chatgpt ads', 'keywordGroup: keyword directly in a folder = group of its own name');
  assert(trackerKeywordGroup({ ...base, keyword: 'convertcake', url: '', group: 'Ads', subgroup: 'Convert Cake' }) === 'Convert Cake', 'keywordGroup: subgroup wins');
  assert(trackerKeywordGroup({ ...base, keyword: 'convert cake', url: 'https://x.test/p', group: 'Ads' }) === '', 'keywordGroup: keyword+page directly in a folder = none');
  assert(trackerKeywordGroup({ ...base, keyword: '', url: 'https://x.test/p', group: 'Ads' }) === '', 'keywordGroup: page directly in a folder = none');
  assert(trackerKeywordGroup({ ...base, keyword: '', url: 'https://x.test/p', group: 'Ads', subgroup: 'G' }) === 'G', 'keywordGroup: page inside a keyword group keeps it');
  assert(trackerKeywordGroup({ ...base, keyword: 'convert cake', url: '' }) === '', 'keywordGroup: no folder = none');
}

console.log(`\nAll ${passed} assertions passed`);
