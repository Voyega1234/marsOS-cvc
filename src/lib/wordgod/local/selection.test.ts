/**
 * Tests for WordGod Local SME final-selection balancing (sales/traffic 50/50).
 * Run: npx tsx src/lib/wordgod/local/selection.test.ts
 *
 * ครอบเคส: สัดส่วน sales/traffic, diversity cap ต่อคลัสเตอร์, backfill เมื่อกลุ่มใดขาด,
 * และ volume tilt ภายในกลุ่มเดียวกัน — ต้องไม่แตะ score.total หรือ priority badge เดิม
 */
import { selectBalancedKeywords } from './selection';
import type { KeywordResearchResult, LocalIntentTag } from './types';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

let seq = 0;
function makeResult(overrides: Partial<KeywordResearchResult> & { keyword: string }): KeywordResearchResult {
  seq += 1;
  return {
    keyword: overrides.keyword,
    volume: overrides.volume ?? 0,
    intents: overrides.intents ?? [],
    location: overrides.location ?? null,
    locationRole: overrides.locationRole ?? 'none',
    service: overrides.service ?? 'บริการ',
    score: overrides.score ?? {
      total: 50,
      localIntent: 50,
      commercialIntent: 50,
      volume: 50,
      competitionOpportunity: 50,
      relevance: 50,
    },
    priority: overrides.priority ?? 'medium',
    cluster: overrides.cluster ?? `cluster-${seq}`,
    sources: overrides.sources ?? ['generated'],
    modifierGroups: overrides.modifierGroups ?? [],
  };
}

function salesResult(keyword: string, opts: { volume?: number; score?: number; cluster?: string } = {}): KeywordResearchResult {
  return makeResult({
    keyword,
    volume: opts.volume ?? 10,
    intents: ['price', 'service_provider'] as LocalIntentTag[],
    locationRole: 'primary',
    score: { total: opts.score ?? 80, localIntent: 80, commercialIntent: 80, volume: 20, competitionOpportunity: 50, relevance: 50 },
    cluster: opts.cluster ?? `sales-${keyword}`,
  });
}

function trafficResult(keyword: string, opts: { volume?: number; score?: number; cluster?: string } = {}): KeywordResearchResult {
  return makeResult({
    keyword,
    volume: opts.volume ?? 10,
    intents: ['informational'] as LocalIntentTag[],
    locationRole: 'none',
    score: { total: opts.score ?? 40, localIntent: 10, commercialIntent: 10, volume: 40, competitionOpportunity: 50, relevance: 50 },
    cluster: opts.cluster ?? `traffic-${keyword}`,
  });
}

// ─── A. สัดส่วน 50/50 เมื่อทั้งสองกลุ่มมีพอ ────────────────────────────────────
function testCaseA_ratio(): void {
  console.log('\nA) สัดส่วน sales/traffic ~50/50 จากพูล 80/20');
  const pool: KeywordResearchResult[] = [];
  for (let i = 0; i < 40; i++) pool.push(salesResult(`sale${i}`, { volume: 100 - i, score: 90 - i }));
  for (let i = 0; i < 10; i++) pool.push(trafficResult(`traffic${i}`, { volume: 100 - i, score: 60 - i }));

  const chosen = selectBalancedKeywords(pool, { targetCount: 20, salesRatio: 0.5, maxPerCluster: 2 });
  assert(chosen.length === 20, `คัดครบ targetCount (ได้ ${chosen.length})`);

  const salesCount = chosen.filter(r => r.intents.some(t => ['price', 'service_provider'].includes(t))).length;
  const trafficCount = chosen.length - salesCount;
  assert(Math.abs(salesCount - trafficCount) <= 2, `sales(${salesCount}) กับ traffic(${trafficCount}) ใกล้เคียง 50/50`);
}

// ─── B. Diversity cap: ไม่มีคลัสเตอร์ไหนเกิน maxPerCluster ──────────────────────
function testCaseB_diversityCap(): void {
  console.log('\nB) diversity cap — ไม่เกิน 2 ต่อคลัสเตอร์');
  const pool: KeywordResearchResult[] = [];
  for (let i = 0; i < 10; i++) {
    pool.push(salesResult(`sameCluster${i}`, { volume: 100 - i, score: 90 - i, cluster: 'ล้างแอร์บางแค' }));
  }
  for (let i = 0; i < 10; i++) pool.push(trafficResult(`t${i}`, { volume: 100 - i, score: 50 - i }));

  const chosen = selectBalancedKeywords(pool, { targetCount: 10, salesRatio: 0.5, maxPerCluster: 2 });
  const counts = new Map<string, number>();
  for (const r of chosen) {
    const key = r.cluster ?? r.keyword;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const maxCount = Math.max(...Array.from(counts.values()));
  assert(maxCount <= 2, `ไม่มีคลัสเตอร์ไหนเกิน 2 คำ (max = ${maxCount})`);
  assert(counts.get('ล้างแอร์บางแค') === 2, 'คลัสเตอร์ที่มีคำเยอะสุดถูก cap เหลือ 2');
}

// ─── C. Backfill: traffic ไม่พอ → sales เติมจนครบ targetCount ────────────────
function testCaseC_backfill(): void {
  console.log('\nC) backfill เมื่อ traffic ไม่พอโควตา');
  const pool: KeywordResearchResult[] = [];
  for (let i = 0; i < 20; i++) pool.push(salesResult(`sale${i}`, { volume: 100 - i, score: 90 - i, cluster: `sales-c${i % 15}` }));
  for (let i = 0; i < 2; i++) pool.push(trafficResult(`traffic${i}`, { volume: 100 - i, score: 60 - i }));

  const chosen = selectBalancedKeywords(pool, { targetCount: 10, salesRatio: 0.5, maxPerCluster: 2 });
  assert(chosen.length === 10, `รวมครบ targetCount แม้ traffic ขาด (ได้ ${chosen.length})`);
  const trafficCount = chosen.filter(r => r.intents.includes('informational')).length;
  assert(trafficCount === 2, `traffic ทั้งหมดที่มี (2 คำ) ถูกเลือกหมด (ได้ ${trafficCount})`);
  const salesCount = chosen.length - trafficCount;
  assert(salesCount === 8, `sales เติมส่วนที่เหลือจนครบ (ได้ ${salesCount})`);
}

// ─── D. Volume tilt: score เท่ากัน → volume สูงกว่าถูกเลือกก่อน ───────────────
function testCaseD_volumeTilt(): void {
  console.log('\nD) volume tilt ภายในกลุ่มเดียวกัน');
  const high = salesResult('highVolume', { volume: 5000, score: 70, cluster: 'a' });
  const low = salesResult('lowVolume', { volume: 5, score: 70, cluster: 'b' });
  const traffic = trafficResult('fillTraffic', { volume: 10, score: 40, cluster: 'c' });

  const chosen = selectBalancedKeywords([high, low, traffic], { targetCount: 1, salesRatio: 1, maxPerCluster: 2 });
  assert(chosen.length === 1, 'คัดได้ 1 คำตาม targetCount');
  assert(chosen[0].keyword === 'highVolume', `คำ volume สูงกว่าถูกเลือกก่อนเมื่อ score เท่ากัน (ได้ "${chosen[0].keyword}")`);
}

// ─── E. backfill เมื่อ sales ขาด → เลือก high-intent traffic ก่อน pure traffic ──
// คำ traffic ที่ยังพ่วงสัญญาณเชิงพาณิชย์ (เปรียบเทียบ/ราคา) ต้องถูกเติมก่อน แม้ blended
// จะต่ำกว่า pure informational (ต้องไม่ยัดคำขายคุณภาพต่ำ และไม่ปล่อยโควตาว่าง)
function highIntentTrafficResult(keyword: string, opts: { volume?: number; score?: number; cluster?: string } = {}): KeywordResearchResult {
  return makeResult({
    keyword,
    volume: opts.volume ?? 10,
    intents: ['informational', 'comparison'] as LocalIntentTag[],
    locationRole: 'none',
    score: { total: opts.score ?? 30, localIntent: 10, commercialIntent: 40, volume: 10, competitionOpportunity: 50, relevance: 50 },
    cluster: opts.cluster ?? `hitraffic-${keyword}`,
  });
}

function testCaseE_highIntentBackfill(): void {
  console.log('\nE) backfill: sales ขาด → high-intent traffic มาก่อน pure traffic');
  const pool: KeywordResearchResult[] = [];
  // sales มีแค่ 2 (โควตา sales = 3 → ขาด 1 ช่อง ต้อง backfill)
  pool.push(salesResult('sale0', { volume: 200, score: 90, cluster: 'sale-a' }));
  pool.push(salesResult('sale1', { volume: 190, score: 88, cluster: 'sale-b' }));
  // pure traffic blended สูง 3 คำ → กินโควตา traffic (3) หมด
  const pureHi = [
    trafficResult('pureHi0', { volume: 300, score: 60, cluster: 't0' }),
    trafficResult('pureHi1', { volume: 290, score: 60, cluster: 't1' }),
    trafficResult('pureHi2', { volume: 280, score: 60, cluster: 't2' }),
  ];
  pool.push(...pureHi);
  // เหลือ backfill 1 ช่อง: P (pure, blended สูงกว่า) vs H (high-intent, blended ต่ำกว่า)
  const P = trafficResult('pureLeftover', { volume: 90, score: 50, cluster: 't-p' });
  const H = highIntentTrafficResult('highIntentLeftover', { volume: 5, score: 20, cluster: 't-h' });
  pool.push(P, H);

  const chosen = selectBalancedKeywords(pool, { targetCount: 6, salesRatio: 0.5, maxPerCluster: 2 });
  const keys = new Set(chosen.map(r => r.keyword));
  assert(chosen.length === 6, `คัดครบ targetCount (ได้ ${chosen.length})`);
  assert(keys.has('highIntentLeftover'), 'high-intent traffic ถูกเติมใน backfill แม้ blended ต่ำกว่า');
  assert(!keys.has('pureLeftover'), 'pure traffic ที่ blended สูงกว่าไม่ถูกเลือกก่อน high-intent (ยืนยันลำดับใหม่)');
}

function main(): void {
  console.log('wordgod local SME — selection balancing');
  testCaseA_ratio();
  testCaseB_diversityCap();
  testCaseC_backfill();
  testCaseD_volumeTilt();
  testCaseE_highIntentBackfill();
  console.log(`\n✅ selection: ${passed} assertions passed`);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
