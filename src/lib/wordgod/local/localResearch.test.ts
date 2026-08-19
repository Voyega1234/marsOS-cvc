/**
 * Tests for WordGod Local SME keyword research (generation → scoring → clustering).
 * Run: npx tsx src/lib/wordgod/local/localResearch.test.ts
 *
 * ครอบเคสตามสเปกข้อ §43 A–E + ค่าคงที่ที่ห้ามเพี้ยน (§36 น้ำหนักรวมต้องเท่ากับ 1)
 */
import { assembleResults, generateLocalCandidates, type LocalRawItem } from './index';
import { GENERATION_LIMITS, LOCAL_KEYWORD_WEIGHTS, PRIORITY_THRESHOLDS } from './config';
import { dedupeKey, normalizeThaiSpacing } from './normalize';
import type { LocalArea, LocalResearchInput } from './types';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

function area(name: string, type: LocalArea['type'] = 'district', parent?: string): LocalArea {
  return { id: `${type}-${name}`, name, type, parent };
}

function keywordsOf(input: LocalResearchInput): string[] {
  return generateLocalCandidates(input).map(c => c.keyword);
}

/** ค้นแบบตัดช่องว่าง — คีย์เวิร์ดไทยเขียนติดกันหรือเว้นวรรคก็นับว่าเจอ */
function has(list: string[], keyword: string): boolean {
  const target = dedupeKey(keyword);
  return list.some(k => dedupeKey(k) === target);
}

// ─── A. ล้างแอร์ + บางแค ───────────────────────────────────────────────────────
function testCaseA(): void {
  console.log('\nA) ล้างแอร์ + บางแค');
  const input: LocalResearchInput = {
    services: ['ล้างแอร์'],
    primaryLocation: area('บางแค', 'district', 'กรุงเทพมหานคร'),
    nearbyLocations: [area('บางหว้า'), area('ภาษีเจริญ'), area('หนองแขม')],
    businessType: 'service_area',
    language: 'th',
  };
  const keywords = keywordsOf(input);

  for (const expected of [
    'ล้างแอร์บางแค',
    'รับล้างแอร์บางแค',
    'ล้างแอร์บางแคกี่บาท',
    'ล้างแอร์บางแคที่ไหนดี',
    'ช่างล้างแอร์บางแค',
    'ล้างแอร์ด่วนบางแค',
    'ล้างแอร์ใกล้ฉัน',
    'รับล้างแอร์ใกล้ฉัน',
  ]) {
    assert(has(keywords, expected), `สร้าง "${expected}"`);
  }

  assert(has(keywords, 'ล้างแอร์บางหว้า'), 'พื้นที่ใกล้เคียงถูกสร้างด้วย');
  assert(keywords.every(k => k.includes('ล้างแอร์')), 'ทุกคำยังเกี่ยวกับบริการที่ระบุ');

  // เจตนาต้องชนะปริมาณ: คำเฉพาะพื้นที่ต้องอยู่เหนือคำกว้างที่ volume สูงกว่า
  const items: LocalRawItem[] = [
    { keyword: 'ล้างแอร์บางแค', sources: ['generated'], metric: { volume: 20, competition: 'LOW', competitionIndex: 20, bidLow: 8, bidHigh: 25 } },
    { keyword: 'รับล้างแอร์บางแค', sources: ['generated'], metric: null },
    { keyword: 'แอร์', sources: ['keyword_planner'], metric: { volume: 90000, competition: 'HIGH', competitionIndex: 90, bidLow: 2, bidHigh: 9 } },
    { keyword: 'วิธีล้างแอร์', sources: ['keyword_planner'], metric: { volume: 12000, competition: 'LOW', competitionIndex: 10, bidLow: 1, bidHigh: 4 } },
    { keyword: 'เครื่องปรับอากาศ', sources: ['keyword_planner'], metric: { volume: 40000, competition: 'MEDIUM', competitionIndex: 50, bidLow: 3, bidHigh: 12 } },
  ];
  const { results } = assembleResults(items, input);
  const rank = (kw: string) => results.findIndex(r => dedupeKey(r.keyword) === dedupeKey(kw));

  assert(rank('ล้างแอร์บางแค') < rank('แอร์'), '"ล้างแอร์บางแค" มาก่อน "แอร์" ที่ volume สูงกว่า');
  assert(rank('รับล้างแอร์บางแค') < rank('วิธีล้างแอร์'), '"รับล้างแอร์บางแค" (ไม่มี volume) มาก่อน "วิธีล้างแอร์"');
  assert(rank('ล้างแอร์บางแค') < rank('เครื่องปรับอากาศ'), 'คำเฉพาะพื้นที่มาก่อนคำกว้าง');
  assert(
    results[0].score.total >= results[results.length - 1].score.total,
    'เรียงตาม Priority จากมากไปน้อยเป็นค่าเริ่มต้น',
  );

  const local = results.find(r => dedupeKey(r.keyword) === dedupeKey('ล้างแอร์บางแค'))!;
  assert(local.priority === 'high', '"ล้างแอร์บางแค" อยู่ระดับ High');
  assert(local.intents.includes('local'), 'ติดแท็ก local');
  assert(local.location === 'บางแค', 'ระบุพื้นที่ที่จับได้ถูกต้อง');

  // เคสจริงที่ Keyword Planner ไม่มีข้อมูลเลยทั้งชุด: คำ money หลัก
  // "บริการ+เขต" ต้องไม่จมอยู่ท้ายลิสต์ใต้หางยาวที่พ่วงคำขยาย
  const blind = assembleResults(
    generateLocalCandidates(input).map(c => ({ keyword: c.keyword, sources: ['generated' as const], candidate: c })),
    input,
  );
  const headIndex = blind.results.findIndex(r => dedupeKey(r.keyword) === dedupeKey('ล้างแอร์บางแค'));
  assert(headIndex >= 0, 'ชุดที่ไม่มีข้อมูล volume ยังมี "ล้างแอร์บางแค"');
  assert(
    blind.results[headIndex].priority === 'high',
    '"ล้างแอร์บางแค" ยังเป็น High แม้ไม่มีข้อมูล volume เลย',
  );
  const firstNonPrimary = blind.results.findIndex(r => r.location !== 'บางแค');
  assert(
    firstNonPrimary === -1 || headIndex < firstNonPrimary,
    `"ล้างแอร์บางแค" มาก่อนทุกคำที่ไม่ได้ระบุพื้นที่หลัก (อันดับ ${headIndex + 1}/${blind.results.length})`,
  );

  const noVolume = results.find(r => dedupeKey(r.keyword) === dedupeKey('รับล้างแอร์บางแค'))!;
  assert(noVolume.volume === null, 'คำที่ไม่มีข้อมูล volume = null ไม่ใช่ 0 (§32)');
  assert(noVolume.score.volume === 0, 'คะแนน volume เป็น 0 แต่ไม่ทำให้คำนี้ตกชั้น');
  assert(noVolume.score.total >= PRIORITY_THRESHOLDS.high, 'volume ว่างยังขึ้น High ได้ (§12)');
  assert(noVolume.intents.includes('service_provider'), 'จับเจตนา "หาผู้ให้บริการ" ได้');
}

// ─── B. ช่างประปา + ลาดพร้าว ──────────────────────────────────────────────────
function testCaseB(): void {
  console.log('\nB) ช่างประปา + ลาดพร้าว');
  const keywords = keywordsOf({
    services: ['ซ่อมท่อประปา'],
    primaryLocation: area('ลาดพร้าว', 'district', 'กรุงเทพมหานคร'),
    businessType: 'service_area',
  });

  assert(has(keywords, 'ซ่อมท่อประปาลาดพร้าว'), 'สร้าง "ซ่อมท่อประปาลาดพร้าว"');
  assert(has(keywords, 'ช่างซ่อมท่อประปาลาดพร้าว'), 'สร้าง "ช่างซ่อมท่อประปาลาดพร้าว"');
  assert(
    keywords.every(k => !/แอร์|เครื่องปรับอากาศ/.test(k)),
    'ไม่มีคำเกี่ยวกับแอร์ปนมาเลย (ไม่ hardcode หมวดใดหมวดหนึ่ง)',
  );
  assert(keywords.every(k => k.includes('ลาดพร้าว') || !/บางแค/.test(k)), 'ไม่มีพื้นที่อื่นปนมา');
}

// ─── C. คลินิกทันตกรรม + อโศก ─────────────────────────────────────────────────
function testCaseC(): void {
  console.log('\nC) คลินิกทันตกรรม + อโศก');
  const keywords = keywordsOf({
    services: ['คลินิกทันตกรรม'],
    primaryLocation: area('อโศก', 'bts', 'กรุงเทพมหานคร'),
    businessType: 'storefront',
  });

  assert(has(keywords, 'คลินิกทันตกรรมอโศก'), 'สร้าง "คลินิกทันตกรรมอโศก"');
  assert(!has(keywords, 'รับคลินิกทันตกรรมอโศก'), 'ไม่สร้าง "รับคลินิกทันตกรรมอโศก" (ผิดภาษา)');
  assert(
    keywords.every(k => !/^รับ|^ช่าง|^ร้าน|^บริษัท|^บริการ/.test(k)),
    'ไม่มีคำนำหน้าแบบผู้รับเหมางานกับกิจการประเภทสถานที่',
  );
  assert(has(keywords, 'คลินิกทันตกรรมอโศกราคา'), 'ยังสร้างคำถามราคาได้ตามปกติ');
  assert(has(keywords, 'คลินิกทันตกรรมอโศกที่ไหนดี'), 'ยังสร้างคำเปรียบเทียบได้ตามปกติ');
}

// ─── D. คำที่ KP ไม่มีข้อมูล ต้องไม่พัง ────────────────────────────────────────
function testCaseD(): void {
  console.log('\nD) ล้างแอร์คอนโดบางหว้าด่วน — ไม่มี volume');
  const input: LocalResearchInput = {
    services: ['ล้างแอร์'],
    primaryLocation: area('บางแค', 'district', 'กรุงเทพมหานคร'),
    nearbyLocations: [area('บางหว้า')],
    businessType: 'service_area',
  };
  const { results, clusters } = assembleResults(
    [{ keyword: 'ล้างแอร์คอนโดบางหว้าด่วน', sources: ['generated'], metric: null }],
    input,
  );

  assert(results.length === 1, 'คืนผลลัพธ์ได้โดยไม่ throw');
  const row = results[0];
  assert(row.volume === null, 'volume เป็น null');
  assert(row.adsCompetition === null && row.bidLow === null, 'metric อื่นเป็น null ไม่ใช่ตัวเลขที่แต่งขึ้น');
  assert(row.intents.includes('urgency'), 'ยังจับเจตนา "ด่วน" ได้');
  assert(row.intents.includes('property_type'), 'ยังจับ "คอนโด" ได้');
  assert(row.intents.includes('local'), 'ยังจับพื้นที่ได้');
  assert(row.locationRole === 'nearby', 'รู้ว่าเป็นพื้นที่ใกล้เคียง');
  assert(row.score.total > 0 && row.score.total <= 100, `Priority อยู่ในช่วง 0–100 (${row.score.total})`);
  assert(row.score.competitionOpportunity === 50, 'ไม่มีข้อมูลการแข่งขัน → ใช้ค่ากลาง ไม่เดา');
  assert(clusters.length === 1 && clusters[0].searchDemand === null, 'คลัสเตอร์ที่ไม่มี volume เลย → searchDemand = null');
  assert(row.suggestedPage === 'service_area', 'พื้นที่ใกล้เคียงแนะนำหน้า "พื้นที่ให้บริการ"');
}

// ─── E. normalize / dedupe ────────────────────────────────────────────────────
function testCaseE(): void {
  console.log('\nE) normalize + dedupe');
  assert(normalizeThaiSpacing('ล้างแอร์ บางแค') === 'ล้างแอร์บางแค', 'ตัดช่องว่างระหว่างคำไทย');
  assert(dedupeKey('ล้างแอร์ บางแค') === dedupeKey('ล้างแอร์บางแค'), 'สองรูปแบบให้คีย์เดียวกัน');

  const input: LocalResearchInput = {
    services: ['ล้างแอร์'],
    primaryLocation: area('บางแค', 'district'),
    businessType: 'service_area',
  };
  const { results } = assembleResults(
    [
      { keyword: 'ล้างแอร์บางแค', sources: ['generated'], metric: { volume: 30, competition: 'LOW', competitionIndex: 15, bidLow: 5, bidHigh: 20 } },
      { keyword: 'ล้างแอร์ บางแค', sources: ['keyword_planner'], metric: null },
      { keyword: 'ล้างแอร์  บางแค ', sources: ['keyword_planner'], metric: null },
    ],
    input,
  );
  assert(results.length === 1, 'สามรูปแบบเหลือแถวเดียว');
  assert(results[0].volume === 30, 'เก็บ metric ของแถวแรกไว้');

  const keywords = keywordsOf(input);
  const keys = keywords.map(dedupeKey);
  assert(new Set(keys).size === keys.length, 'ชุดที่สร้างขึ้นไม่มีคำซ้ำเชิงความหมาย');
}

// ─── ค่าคงที่และเพดาน ─────────────────────────────────────────────────────────
function testInvariants(): void {
  console.log('\nInvariants');
  const sum = Object.values(LOCAL_KEYWORD_WEIGHTS).reduce((s, w) => s + w, 0);
  assert(Math.abs(sum - 1) < 1e-9, `น้ำหนักรวมเท่ากับ 1 (${sum})`);
  assert(LOCAL_KEYWORD_WEIGHTS.localIntent === 0.4, 'Local Intent ถ่วง 40%');
  assert(LOCAL_KEYWORD_WEIGHTS.commercialIntent === 0.3, 'Commercial Intent ถ่วง 30%');
  assert(LOCAL_KEYWORD_WEIGHTS.volume === 0.15, 'Volume ถ่วงแค่ 15%');

  // กันคีย์เวิร์ดระเบิด: หลายบริการ × หลายพื้นที่ ต้องยังอยู่ในเพดาน
  const candidates = generateLocalCandidates({
    services: ['ล้างแอร์', 'ซ่อมแอร์', 'ติดตั้งแอร์', 'ย้ายแอร์'],
    primaryLocation: area('บางแค', 'district', 'กรุงเทพมหานคร'),
    nearbyLocations: ['บางหว้า', 'ภาษีเจริญ', 'หนองแขม', 'เพชรเกษม', 'ท่าพระ', 'บางบอน'].map(n => area(n)),
    businessType: 'service_area',
  });
  assert(
    candidates.length <= GENERATION_LIMITS.maxTotalCandidates,
    `จำนวนรวมไม่เกินเพดาน ${GENERATION_LIMITS.maxTotalCandidates} (ได้ ${candidates.length})`,
  );
  assert(
    candidates.every(c => c.modifierIds.length <= GENERATION_LIMITS.maxModifiersPerKeyword),
    'ไม่มีคีย์เวิร์ดไหนพ่วงคำขยายเกิน 2 ตัว',
  );
  assert(
    candidates.every(c => !/ใกล้ฉัน.*บางแค|บางแค.*ใกล้ฉัน/.test(c.keyword)),
    'ไม่มี "ใกล้ฉัน" ปนกับชื่อเขต',
  );

  // คะแนนย่อยต้องอยู่ในเพดานของแต่ละมิติเสมอ
  const { results } = assembleResults(
    candidates.slice(0, 50).map(c => ({ keyword: c.keyword, sources: ['generated' as const], candidate: c, metric: null })),
    {
      services: ['ล้างแอร์', 'ซ่อมแอร์', 'ติดตั้งแอร์', 'ย้ายแอร์'],
      primaryLocation: area('บางแค', 'district', 'กรุงเทพมหานคร'),
      businessType: 'service_area',
    },
  );
  assert(
    results.every(r =>
      r.score.total >= 0 && r.score.total <= 100 &&
      r.score.localIntent <= 100 && r.score.commercialIntent <= 100 &&
      r.score.relevance <= 100),
    'คะแนนทุกมิติอยู่ในช่วง 0–100',
  );
  assert(results.every(r => r.cluster && r.suggestedPage), 'ทุกคำมีคลัสเตอร์และหน้าที่แนะนำ');
}

function main(): void {
  console.log('wordgod local SME');
  testCaseA();
  testCaseB();
  testCaseC();
  testCaseD();
  testCaseE();
  testInvariants();
  console.log(`\n✅ local: ${passed} assertions passed`);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
