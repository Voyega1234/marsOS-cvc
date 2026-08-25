/**
 * ทดสอบชั้น Local SEO Intelligence Engine (pure functions — ไม่ยิง API)
 * รัน: npx tsx src/lib/wordgod/local/intelligence.test.ts
 *
 * คุมกติกาที่ห้ามพัง:
 *  - reference volume = Google ก่อนเสมอ → DFS → null (ไม่มีการเฉลี่ย)
 *  - confidence HIGH/MEDIUM/LOW/LOCAL/NO_VOLUME ตาม ratio + ZERO ≠ NULL
 *  - cluster quota ≤35%, waves 15/30/rest, coverage gate ≥90%
 */

import {
  emptyDfsMetric,
  emptyGoogleMetric,
  computeVolumeConfidence,
  confidencePenalty,
  resolveReferenceVolume,
} from './metrics';
import {
  assignWaves,
  computeFinalScore,
  mergeBySerpOverlap,
  normalizeWeights,
  resolveLocationSwapGroups,
  selectWithClusterQuota,
  serpOverlapRatio,
} from './intelligence';
import { verifiedVolumeCoverage, CLIENT_READY_COVERAGE_THRESHOLD } from './enrichment';
import { dedupeKey } from './normalize';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function google(volume: number | null, status: 'ok' | 'zero' | 'no_data' | 'api_error' | 'not_requested') {
  return { ...emptyGoogleMetric(), avgMonthlySearches: volume, status };
}
function dfs(volume: number | null, status: 'ok' | 'zero' | 'no_data' | 'api_error' | 'not_requested') {
  return { ...emptyDfsMetric(), searchVolume: volume, status };
}

console.log('\nA) Reference volume: Google-first, ไม่เฉลี่ย');
{
  const both = resolveReferenceVolume(google(880, 'ok'), dfs(1300, 'ok'));
  check('มีทั้งสองแหล่ง → ใช้ Google (ไม่เฉลี่ย)', both.volume === 880 && both.source === 'google_keyword_planner',
    `got ${both.volume} from ${both.source}`);
  const dfsOnly = resolveReferenceVolume(google(null, 'no_data'), dfs(1300, 'ok'));
  check('Google ไม่มีข้อมูล → fallback DFS', dfsOnly.volume === 1300 && dfsOnly.source === 'dataforseo');
  const none = resolveReferenceVolume(google(null, 'api_error'), dfs(null, 'not_requested'));
  check('ไม่มีทั้งคู่ → null + source none (ไม่แต่งตัวเลข)', none.volume === null && none.source === 'none');
  const zero = resolveReferenceVolume(google(0, 'zero'), dfs(500, 'ok'));
  check('Google ตอบ 0 จริง = มีข้อมูล (ZERO ≠ NULL) → reference คือ 0 จาก Google',
    zero.volume === 0 && zero.source === 'google_keyword_planner');
}

console.log('\nB) Volume confidence ตาม ratio สองแหล่ง');
{
  check('ratio ≤1.5 → HIGH', computeVolumeConfidence(google(880, 'ok'), dfs(1000, 'ok')) === 'HIGH');
  check('ratio ≤3 → MEDIUM', computeVolumeConfidence(google(880, 'ok'), dfs(2200, 'ok')) === 'MEDIUM');
  check('ratio >3 → LOW', computeVolumeConfidence(google(100, 'ok'), dfs(900, 'ok')) === 'LOW');
  check('แหล่งเดียว (>0) → MEDIUM', computeVolumeConfidence(google(880, 'ok'), dfs(null, 'no_data')) === 'MEDIUM');
  check('ศูนย์ทั้งคู่ ไม่มีหลักฐาน local → NO_VOLUME', computeVolumeConfidence(google(0, 'zero'), dfs(0, 'zero')) === 'NO_VOLUME');
  check('ศูนย์ทั้งคู่ + หลักฐาน local → LOCAL',
    computeVolumeConfidence(google(0, 'zero'), dfs(0, 'zero'), { zeroVolumeLocalOpportunity: true }) === 'LOCAL');
  check('API error ≠ ศูนย์ (ไม่นับเป็นข้อมูล)', computeVolumeConfidence(google(null, 'api_error'), dfs(null, 'api_error')) === 'NO_VOLUME');
  check('โทษคะแนน: HIGH=0 · LOCAL=0 · NO_VOLUME=8',
    confidencePenalty('HIGH') === 0 && confidencePenalty('LOCAL') === 0 && confidencePenalty('NO_VOLUME') === 8);
}

console.log('\nC) น้ำหนัก Sales/Traffic → normalize เป็นผลรวม 1 เสมอ');
{
  const def = normalizeWeights(undefined, undefined);
  check('ค่าเริ่มต้น 60/40', Math.abs(def.sales - 0.6) < 1e-9 && Math.abs(def.traffic - 0.4) < 1e-9);
  const pct = normalizeWeights(70, 30);
  check('รับ 0–100 ได้ (70/30)', Math.abs(pct.sales - 0.7) < 1e-9 && Math.abs(pct.traffic - 0.3) < 1e-9);
  const skew = normalizeWeights(0.5, 0.25);
  check('ผลรวมไม่เท่า 1 → normalize (0.5/0.25 → 2/3,1/3)',
    Math.abs(skew.sales - 2 / 3) < 1e-6 && Math.abs(skew.sales + skew.traffic - 1) < 1e-9);
}

console.log('\nD) Final score: local override +5, cannibalization หัก, clamp 0–100');
{
  const base = computeFinalScore(80, 60, { sales: 0.6, traffic: 0.4 }, 'HIGH', 0, false);
  check('60/40 ของ 80/60 = 72', base === 72, `got ${base}`);
  const withLocal = computeFinalScore(80, 60, { sales: 0.6, traffic: 0.4 }, 'LOCAL', 0, true);
  check('Local Opportunity Override +5', withLocal === 77, `got ${withLocal}`);
  const clamped = computeFinalScore(5, 0, { sales: 0.6, traffic: 0.4 }, 'NO_VOLUME', 10, false);
  check('ไม่ติดลบ (clamp ≥0)', clamped === 0, `got ${clamped}`);
}

console.log('\nE) Location-swap protection: คำ "ใกล้ฉัน" ถูกรวมเป็นคำรองของคำพื้นที่จริง');
{
  const areaKeys = ['บางแค', 'บางหว้า'].map(dedupeKey);
  const out = resolveLocationSwapGroups([
    { keyword: 'ล้างแอร์ บางแค', locationRole: 'primary', finalScore: 82 },
    { keyword: 'ล้างแอร์ใกล้ฉัน', locationRole: 'none', finalScore: 75 },
    { keyword: 'ล้างแอร์ บางหว้า', locationRole: 'nearby', finalScore: 70 },
    { keyword: 'ซ่อมแอร์ บางแค', locationRole: 'primary', finalScore: 60 },
  ], areaKeys);
  const nearMe = out.demoted.get(dedupeKey('ล้างแอร์ใกล้ฉัน'));
  check('"ใกล้ฉัน" ถูก demote', !!nearMe);
  check('ไปเป็นคำรองของคำพื้นที่คะแนนสูงสุด', nearMe?.primaryKey === dedupeKey('ล้างแอร์ บางแค'));
  check('คำพื้นที่ให้บริการจริงไม่ถูก demote (ไม่ใช่ doorway)',
    !out.demoted.has(dedupeKey('ล้างแอร์ บางหว้า')) && !out.demoted.has(dedupeKey('ซ่อมแอร์ บางแค')));
}

console.log('\nF) SERP overlap merge: ≥0.50 รวมทันที, 0.35–0.49 รวมเมื่อ intent เดียวกัน');
{
  const urls = (n: number, prefix: string) => Array.from({ length: 10 }, (_, i) => `${prefix}${i < n ? 'S' : 'x' + i}`);
  check('overlap ratio ตรง', serpOverlapRatio(['a', 'b', 'c', 'd'], ['a', 'b', 'x', 'y']) === 0.5);
  const shared = Array.from({ length: 10 }, (_, i) => `https://s/${i}`);
  const out = mergeBySerpOverlap([
    { keyword: 'ล้างแอร์ บางแค', finalScore: 90, topUrls: shared, intent: 'transactional' },
    { keyword: 'บริการล้างแอร์ บางแค', finalScore: 80, topUrls: [...shared.slice(0, 6), 'u1', 'u2', 'u3', 'u4'], intent: 'transactional' },
    { keyword: 'วิธีล้างแอร์เอง', finalScore: 70, topUrls: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w0'], intent: 'informational' },
    { keyword: 'แอร์ไม่เย็น', finalScore: 60, topUrls: [...shared.slice(0, 4), 'q1', 'q2', 'q3', 'q4', 'q5', 'q6'], intent: 'informational' },
  ]);
  check('ทับ 60% → รวมเข้าคำคะแนนสูงกว่า',
    out.merged.get(dedupeKey('บริการล้างแอร์ บางแค'))?.primaryKey === dedupeKey('ล้างแอร์ บางแค'));
  check('SERP คนละชุด → ไม่รวม', !out.merged.has(dedupeKey('วิธีล้างแอร์เอง')));
  check('ทับ 40% แต่ intent ต่างกัน → ไม่รวม', !out.merged.has(dedupeKey('แอร์ไม่เย็น')));
  void urls;
}

console.log('\nG) Cluster quota: คลัสเตอร์เดียวไม่เกิน 35% (เมื่อคำจากคลัสเตอร์อื่นยังมีพอ)');
{
  const rows = [
    ...Array.from({ length: 60 }, (_, i) => ({ keyword: `ล้างแอร์ คำที่ ${i}`, cluster: 'ล้างแอร์', score: 90 - i * 0.1 })),
    ...Array.from({ length: 40 }, (_, i) => ({ keyword: `ซ่อมแอร์ คำที่ ${i}`, cluster: 'ซ่อมแอร์', score: 70 - i * 0.1 })),
    ...Array.from({ length: 40 }, (_, i) => ({ keyword: `ติดตั้งแอร์ คำที่ ${i}`, cluster: 'ติดตั้งแอร์', score: 60 - i * 0.1 })),
  ];
  const picked = selectWithClusterQuota(rows, 50, r => r.score);
  check('ได้ครบตามเป้า 50', picked.length === 50, `got ${picked.length}`);
  const counts = new Map<string, number>();
  for (const p of picked) counts.set(p.cluster!, (counts.get(p.cluster!) ?? 0) + 1);
  const maxShare = Math.max(...Array.from(counts.values())) / picked.length;
  check('ไม่มีคลัสเตอร์ไหนเกิน 35%', maxShare <= 0.35 + 1e-9, `max share ${(maxShare * 100).toFixed(0)}%`);
  check('ทุกคลัสเตอร์ที่มีของได้ที่อย่างน้อย 1', counts.size === 3);
  // ผ่อนเพดานเมื่อไม่มีทางเลือก: คลัสเตอร์เดียวล้วน ต้องยังได้ครบเป้า (คุณภาพ > เพดานเทียม)
  const single = selectWithClusterQuota(
    Array.from({ length: 30 }, (_, i) => ({ keyword: `เดี่ยว ${i}`, cluster: 'เดียว', score: 50 - i })), 20, r => r.score);
  check('คลัสเตอร์เดียวล้วน → ผ่อนเพดาน ได้ครบเป้า', single.length === 20, `got ${single.length}`);
}

console.log('\nH) Publish waves: 15% / 30% / ที่เหลือ + Wave 1 กระจายคลัสเตอร์');
{
  const selected = Array.from({ length: 100 }, (_, i) => ({
    keyword: `คำ ${i}`, cluster: `คลัสเตอร์ ${i % 5}`, score: 100 - i,
  }));
  const waves = assignWaves(selected, r => r.score);
  const count = (w: number) => selected.filter(r => waves.get(dedupeKey(r.keyword)) === w).length;
  check('Wave 1 = 15 คำ (15%)', count(1) === 15, `got ${count(1)}`);
  check('Wave 2 = 30 คำ (30%)', count(2) === 30, `got ${count(2)}`);
  check('Wave 3 = ที่เหลือ 55 คำ', count(3) === 55, `got ${count(3)}`);
  const w1Clusters = new Set(selected.filter(r => waves.get(dedupeKey(r.keyword)) === 1).map(r => r.cluster));
  check('Wave 1 กระจายครบทุกคลัสเตอร์ (portfolio สมดุล)', w1Clusters.size === 5);
}

console.log('\nI) Verified coverage + Client Ready gate ≥90%');
{
  const mk = (source: string, local = false) => ({
    referenceVolume: source === 'none' ? null : 100, referenceSource: source, zeroVolumeLocalOpportunity: local,
  });
  const good = [...Array.from({ length: 95 }, () => mk('google_keyword_planner')), ...Array.from({ length: 5 }, () => mk('none'))];
  check('95/100 มีข้อมูล → coverage 0.95 ≥ เกณฑ์', verifiedVolumeCoverage(good) >= CLIENT_READY_COVERAGE_THRESHOLD);
  const bad = [...Array.from({ length: 50 }, () => mk('google_keyword_planner')), ...Array.from({ length: 50 }, () => mk('none'))];
  check('50/100 → ต่ำกว่าเกณฑ์ (ไม่ Client Ready)', verifiedVolumeCoverage(bad) < CLIENT_READY_COVERAGE_THRESHOLD);
  const withLocal = [...Array.from({ length: 85 }, () => mk('dataforseo')), ...Array.from({ length: 10 }, () => mk('none', true)), ...Array.from({ length: 5 }, () => mk('none'))];
  check('LOCAL opportunity ที่มีหลักฐานนับเป็น verified', verifiedVolumeCoverage(withLocal) >= CLIENT_READY_COVERAGE_THRESHOLD);
  check('รายการว่าง → coverage 0 (ไม่หาร 0)', verifiedVolumeCoverage([]) === 0);
}

console.log('');
if (failed > 0) {
  console.error(`❌ intelligence: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`✅ intelligence: ${passed} assertions passed`);
