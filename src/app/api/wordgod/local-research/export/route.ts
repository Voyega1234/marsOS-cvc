/**
 * WordGod Local SME — Excel export ของ Local SEO Keyword Intelligence Engine
 *
 * GET /api/wordgod/local-research/export?researchId=...
 *
 * กติกาสำคัญ (สเปก §88–§92):
 *  - export อ่านจาก "research run ที่บันทึกไว้แล้ว" เท่านั้น — ไม่มีการวิจัยซ้ำ
 *    ทำให้ UI กับ Excel มาจาก canonical dataset ชุดเดียวกันเสมอ
 *  - 7 ชีตพอดี: Overview / Articles_{TARGET} / Wave1_{COUNT} / Seed_Taxonomy /
 *    System_Blueprint / Scoring_Model / Sources
 *  - NULL → "N/A" (ไม่ใช่ 0), ไม่มี NaN/undefined โผล่ในไฟล์
 *  - Google กับ DFS volume แสดงแยกคอลัมน์ — ไม่มีการเฉลี่ยรวม
 */
import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { KeywordResearchResult, LocalResearchResponse } from '@/lib/wordgod/local/types';
import { referenceSourceLabel } from '@/lib/wordgod/local/metrics';

export const maxDuration = 120;

// ── สไตล์กลาง ────────────────────────────────────────────────────────────────
const HEADER_FILL: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const ALT_FILL: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 14, color: { argb: 'FF111827' } };

/** ค่าใส่เซลล์: null/undefined/NaN → "N/A" (ห้ามโผล่เป็น 0 หรือช่องว่างกำกวม) */
function cellValue(v: unknown): string | number | boolean {
  if (v === null || v === undefined) return 'N/A';
  if (typeof v === 'number') return Number.isFinite(v) ? v : 'N/A';
  if (typeof v === 'boolean') return v;
  const s = String(v);
  return s.length > 0 ? s : 'N/A';
}

function styleHeaderRow(ws: ExcelJS.Worksheet, rowNumber: number, colCount: number) {
  const row = ws.getRow(rowNumber);
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', wrapText: true };
  }
  row.height = 28;
}

function zebra(ws: ExcelJS.Worksheet, fromRow: number, toRow: number, colCount: number) {
  for (let r = fromRow; r <= toRow; r++) {
    if ((r - fromRow) % 2 === 1) {
      for (let c = 1; c <= colCount; c++) {
        ws.getRow(r).getCell(c).fill = ALT_FILL;
      }
    }
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'N/A';
  try { return new Date(iso).toISOString().slice(0, 10); } catch { return 'N/A'; }
}

function confidenceLabel(c: string | undefined): string {
  return c === 'NO_VOLUME' ? 'NO VOLUME' : (c ?? 'N/A');
}

/** slug ปลอดภัยสำหรับชื่อไฟล์ (คงตัวอักษรไทยไว้ — ส่งผ่าน filename* RFC 5987) */
function fileSlug(s: string): string {
  return s.trim().replace(/[\\/:*?"<>|#%&{}\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'export';
}

const KEYWORD_COLUMNS: Array<{ header: string; key: string; width: number }> = [
  { header: 'Rank', key: 'rank', width: 7 },
  { header: 'Keyword', key: 'keyword', width: 34 },
  { header: 'SEO Title', key: 'title', width: 40 },
  { header: 'Slug', key: 'slug', width: 26 },
  { header: 'Reference Volume', key: 'refVolume', width: 14 },
  { header: 'Volume Source', key: 'refSource', width: 12 },
  { header: 'Google Volume', key: 'googleVolume', width: 13 },
  { header: 'Google Geo', key: 'googleGeo', width: 16 },
  { header: 'DFS Volume', key: 'dfsVolume', width: 12 },
  { header: 'Confidence', key: 'confidence', width: 12 },
  { header: 'Search Intent', key: 'intent', width: 14 },
  { header: 'Cluster', key: 'cluster', width: 20 },
  { header: 'Objective', key: 'objective', width: 11 },
  { header: 'KD', key: 'kd', width: 8 },
  { header: 'CPC (฿)', key: 'cpc', width: 10 },
  { header: 'Local Pack', key: 'localPack', width: 10 },
  { header: 'Local Opportunity', key: 'localOpp', width: 14 },
  { header: 'Sales Score', key: 'sales', width: 11 },
  { header: 'Traffic Score', key: 'traffic', width: 11 },
  { header: 'Final Score', key: 'final', width: 11 },
  { header: 'Page Type', key: 'pageType', width: 13 },
  { header: 'Wave', key: 'wave', width: 7 },
  { header: 'Secondary Keywords', key: 'secondary', width: 34 },
  { header: 'Google Retrieved', key: 'googleAt', width: 13 },
  { header: 'DFS Retrieved', key: 'dfsAt', width: 13 },
];

function keywordRow(r: KeywordResearchResult, rank: number): Record<string, string | number | boolean> {
  const i = r.intel;
  const isTraffic = (i?.searchIntent.intent ?? '') === 'informational'
    || (!i?.searchIntent.intent && r.intents.includes('informational'));
  return {
    rank,
    keyword: r.keyword,
    title: cellValue(r.suggestedTitle) as string,
    slug: cellValue(r.slug) as string,
    refVolume: cellValue(i ? i.referenceVolume : r.volume),
    refSource: i ? referenceSourceLabel(i.referenceSource) : 'N/A',
    googleVolume: cellValue(i?.google.status === 'ok' || i?.google.status === 'zero' ? i?.google.avgMonthlySearches ?? 0 : null),
    googleGeo: cellValue(i?.google.geoTarget),
    dfsVolume: cellValue(i?.dfs.status === 'ok' || i?.dfs.status === 'zero' ? i?.dfs.searchVolume ?? 0 : null),
    confidence: confidenceLabel(i?.confidence),
    intent: cellValue(i?.searchIntent.intent ?? r.intents[0]),
    cluster: cellValue(r.cluster ?? r.service),
    objective: isTraffic ? 'Traffic' : 'Sales',
    kd: cellValue(i?.dfs.keywordDifficulty),
    cpc: cellValue(i?.dfs.cpc ?? i?.google.bidHighMicros ?? r.bidHigh),
    localPack: i?.serp.status === 'ok' ? (i.serp.hasLocalPack ? 'Yes' : 'No') : 'N/A',
    localOpp: i?.zeroVolumeLocalOpportunity ? 'LOCAL ✓' : '',
    sales: cellValue(i ? Math.round(i.salesScore.total) : null),
    traffic: cellValue(i ? Math.round(i.trafficScore.total) : null),
    final: cellValue(i ? Math.round(i.finalScore * 10) / 10 : r.score?.total),
    pageType: cellValue(r.suggestedPage),
    wave: cellValue(i?.wave),
    secondary: i?.secondaryKeywords.length ? i.secondaryKeywords.join(', ') : '',
    googleAt: fmtDate(i?.google.retrievedAt),
    dfsAt: fmtDate(i?.dfs.retrievedAt),
  };
}

function buildKeywordSheet(
  wb: ExcelJS.Workbook, name: string, rows: KeywordResearchResult[]
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = KEYWORD_COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.width }));
  rows.forEach((r, idx) => ws.addRow(keywordRow(r, idx + 1)));
  styleHeaderRow(ws, 1, KEYWORD_COLUMNS.length);
  if (rows.length > 0) {
    zebra(ws, 2, rows.length + 1, KEYWORD_COLUMNS.length);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: KEYWORD_COLUMNS.length } };
    // ตัวเลขมี comma คั่นหลักพัน / คะแนนทศนิยม 1 ตำแหน่ง
    for (const key of ['refVolume', 'googleVolume', 'dfsVolume']) {
      const col = ws.getColumn(key);
      col.numFmt = '#,##0';
    }
    ws.getColumn('cpc').numFmt = '#,##0.00';
    ws.getColumn('final').numFmt = '0.0';
    // conditional formatting: Final Score ไล่สีแดง→เหลือง→เขียว
    const finalColLetter = ws.getColumn('final').letter;
    ws.addConditionalFormatting({
      ref: `${finalColLetter}2:${finalColLetter}${rows.length + 1}`,
      rules: [{
        type: 'colorScale',
        priority: 1,
        cfvo: [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }],
        color: [{ argb: 'FFF8696B' }, { argb: 'FFFFEB84' }, { argb: 'FF63BE7B' }],
      }],
    });
  }
  return ws;
}

function addTitleBlock(ws: ExcelJS.Worksheet, title: string, subtitle?: string) {
  const t = ws.addRow([title]);
  t.getCell(1).font = TITLE_FONT;
  if (subtitle) {
    const s = ws.addRow([subtitle]);
    s.getCell(1).font = { color: { argb: 'FF6B7280' }, size: 10 };
  }
  ws.addRow([]);
}

function addKeyValueRows(ws: ExcelJS.Worksheet, pairs: Array<[string, unknown]>) {
  for (const [k, v] of pairs) {
    const row = ws.addRow([k, cellValue(v)]);
    row.getCell(1).font = { bold: true };
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const researchId = req.nextUrl.searchParams.get('researchId');
  if (!researchId) {
    return NextResponse.json({ error: 'ต้องระบุ researchId (export สร้างจากผลที่บันทึกไว้เท่านั้น)' }, { status: 400 });
  }

  const run = await prisma.localKeywordResearchRun.findUnique({ where: { id: researchId } });
  if (!run || run.organizationId !== orgId) {
    return NextResponse.json({ error: 'ไม่พบผลการวิจัยนี้' }, { status: 404 });
  }

  let data: LocalResearchResponse & { sitemap?: any[]; topicClusters?: any[] };
  try {
    data = JSON.parse(run.resultData);
  } catch {
    return NextResponse.json({ error: 'ข้อมูลผลการวิจัยเสียหาย ไม่สามารถ export ได้' }, { status: 500 });
  }
  const results = data.results ?? [];
  const meta = data.meta;
  const services: string[] = JSON.parse(run.services || '[]');
  const weights = meta.opportunityWeights ?? { sales: run.salesWeight, traffic: run.trafficWeight };

  const wb = new ExcelJS.Workbook();
  wb.creator = 'MarsOS — Local SEO Keyword Intelligence Engine';
  wb.created = new Date(run.createdAt);

  // ── ชีต 1: Overview ─────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Overview');
    ws.columns = [{ width: 34 }, { width: 60 }];
    addTitleBlock(ws, 'Local SEO Keyword Intelligence — Overview',
      `${services.join(', ')} @ ${run.primaryLocation} · สร้างเมื่อ ${fmtDate(run.createdAt.toISOString())}`);
    const highConf = results.filter(r => r.intel?.confidence === 'HIGH').length;
    const kdVals = results.map(r => r.intel?.dfs.keywordDifficulty).filter((v): v is number => typeof v === 'number');
    const localPack = results.filter(r => r.intel?.serp.hasLocalPack).length;
    const refDemand = results.reduce((sum, r) => sum + (r.intel?.referenceVolume ?? r.volume ?? 0), 0);
    addKeyValueRows(ws, [
      ['บริการ', services.join(', ')],
      ['พื้นที่หลัก', run.primaryLocation],
      ['Geo ที่ได้ข้อมูลจริง', `${meta.locationTarget.resolved} (${meta.locationTarget.level})`],
      ['เป้าหมาย (Final Opportunities)', run.targetCount],
      ['Candidates ที่วิเคราะห์', meta.candidateCount ?? run.candidateCount],
      ['SEO Opportunities ที่ได้', meta.qualifiedCount ?? run.qualifiedCount],
      ['น้ำหนัก Sales / Traffic', `${Math.round(weights.sales * 100)}% / ${Math.round(weights.traffic * 100)}%`],
      ['Reference Demand รวม (ครอบคลุมเฉพาะคำที่มีข้อมูล — ไม่ใช่คำสัญญา traffic)', refDemand],
      ['คำที่ Confidence = HIGH', `${highConf} (${results.length ? Math.round((highConf / results.length) * 100) : 0}%)`],
      ['ค่าเฉลี่ย Keyword Difficulty', kdVals.length ? Math.round(kdVals.reduce((a, b) => a + b, 0) / kdVals.length) : 'N/A'],
      ['คำที่มี Local Pack ใน SERP', localPack],
      ['Verified Volume Coverage', `${Math.round((meta.verifiedVolumeCoverage ?? 0) * 100)}%`],
      ['Client Ready', run.clientReady ? 'ผ่าน ✓' : 'ไม่ผ่าน — ดูหมายเหตุด้านล่าง'],
      ['Research ID', run.id],
    ]);
    ws.addRow([]);
    if (meta.warnings?.length) {
      const h = ws.addRow(['หมายเหตุ / คำเตือนจากระบบ']);
      h.getCell(1).font = { bold: true, color: { argb: 'FF92400E' } };
      for (const w of meta.warnings) {
        const r = ws.addRow(['•', w]);
        r.getCell(2).alignment = { wrapText: true };
      }
    }
  }

  // ── ชีต 2: Articles_{TARGET} — ตารางหลักทุกคำ ───────────────────────────────
  buildKeywordSheet(wb, `Articles_${results.length}`, results);

  // ── ชีต 3: Wave1_{COUNT} ────────────────────────────────────────────────────
  const wave1 = results.filter(r => r.intel?.wave === 1);
  buildKeywordSheet(wb, `Wave1_${wave1.length}`, wave1);

  // ── ชีต 4: Seed_Taxonomy ────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Seed_Taxonomy', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.columns = [{ width: 26 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 40 }];
    addTitleBlock(ws, 'Seed Taxonomy & Clusters', 'โครงสร้างบริการ × พื้นที่ และคลัสเตอร์ที่ได้จากผลจริง');
    const header = ws.addRow(['Cluster', 'Main Keyword', 'Keywords', 'Search Demand', 'Suggested Page / Advice']);
    styleHeaderRow(ws, header.number, 5);
    const startRow = header.number + 1;
    for (const c of data.clusters ?? []) {
      ws.addRow([
        c.name, c.mainKeyword, c.keywordCount,
        cellValue(c.searchDemand),
        [c.suggestedPage, c.locationPageAdvice].filter(Boolean).join(' — ') || 'N/A',
      ]);
    }
    const endRow = ws.lastRow?.number ?? startRow;
    if (endRow >= startRow) zebra(ws, startRow, endRow, 5);
    ws.addRow([]);
    const h2 = ws.addRow(['Seeds ที่ใช้']);
    h2.getCell(1).font = { bold: true };
    ws.addRow(['บริการ', services.join(', ')]);
    ws.addRow(['พื้นที่', run.primaryLocation]);
  }

  // ── ชีต 5: System_Blueprint ─────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('System_Blueprint');
    ws.columns = [{ width: 6 }, { width: 30 }, { width: 80 }];
    addTitleBlock(ws, 'System Blueprint', 'ขั้นตอนที่ระบบใช้ผลิตผลลัพธ์ชุดนี้ (DATA → AI)');
    const header = ws.addRow(['#', 'ขั้นตอน', 'รายละเอียด']);
    styleHeaderRow(ws, header.number, 3);
    const steps: Array<[string, string]> = [
      ['Candidate Generation', 'สร้างคำจากโครงสร้างบริการ × พื้นที่ × modifier (local/near me/ราคา/ด่วน ฯลฯ)'],
      ['Problem-First Discovery', 'AI ค้นปัญหาจริงของลูกค้าในธุรกิจนี้ แล้วแปลงเป็นคำค้นหา solution/วิธี/ความรู้'],
      ['AI Expansion', 'AI ขยาย candidate pool ให้ใหญ่กว่าเป้าหมาย — AI เสนอ "คำ" เท่านั้น ไม่ใช่ตัวเลข'],
      ['DataForSEO Keyword Ideas', 'ขยาย candidate จากฐานข้อมูลจริงของ DataForSEO Labs (คัดเฉพาะที่ตรงบริการ)'],
      ['Google Keyword Planner', 'ดึง volume/CPC/competition ระดับพื้นที่ที่ resolve ได้จริง = Primary Reference Volume'],
      ['DataForSEO Cross-check', 'ดึง volume จาก DataForSEO แยกอีกแหล่ง เพื่อคำนวณ Confidence (ไม่เฉลี่ยรวม)'],
      ['Search Intent + KD', 'DataForSEO Labs ระบุ intent (มี probability) และ Keyword Difficulty ต่อคำ'],
      ['Local SERP Check', 'ตรวจ SERP จริงแบบ tiered เฉพาะคำ local/commercial เด่นสุด: local pack, ประเภทหน้าใน top 10'],
      ['Scoring', 'Sales Score + Traffic Score + Final Opportunity Score ตามน้ำหนักที่เลือก (ดูชีต Scoring_Model)'],
      ['Cannibalization Control', 'กันคำเจตนาซ้ำ: location-swap (กันหน้า doorway) + SERP overlap ≥50% → รวมเป็นคำรอง'],
      ['Cluster Quota Selection', 'คัดคำ verified ก่อน + จำกัดสัดส่วนต่อคลัสเตอร์ ≤35% กันผลเทไปหมวดเดียว'],
      ['Publish Waves', 'Wave 1 ≈15% (กระจายทุกคลัสเตอร์) → Wave 2 ≈30% → Wave 3 ที่เหลือ'],
      ['SEO Titles', 'AI เขียน title/slug หลังข้อมูลจบแล้วเท่านั้น (AI ไม่แตะตัวเลขใด ๆ)'],
      ['Canonical Save', 'บันทึกทั้งชุดเป็น research run เดียว — UI และ Excel นี้อ่านจากชุดเดียวกัน'],
    ];
    const startRow = header.number + 1;
    steps.forEach(([step, detail], i) => {
      const r = ws.addRow([i + 1, step, detail]);
      r.getCell(2).font = { bold: true };
      r.getCell(3).alignment = { wrapText: true };
    });
    zebra(ws, startRow, startRow + steps.length - 1, 3);
  }

  // ── ชีต 6: Scoring_Model ────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Scoring_Model');
    ws.columns = [{ width: 30 }, { width: 12 }, { width: 70 }];
    addTitleBlock(ws, 'Scoring Model', `Final = Sales×${Math.round(weights.sales * 100)}% + Traffic×${Math.round(weights.traffic * 100)}% − Cannibalization Penalty − Confidence Penalty (+5 Local Opportunity Override)`);
    const h1 = ws.addRow(['Sales Score (โอกาสได้ลูกค้า)', 'น้ำหนัก', 'วัดจาก']);
    styleHeaderRow(ws, h1.number, 3);
    const salesRows: Array<[string, string, string]> = [
      ['Local Relevance', '25%', 'คำผูกกับพื้นที่เป้าหมายแค่ไหน (พื้นที่ตรง/ใกล้เคียง/near me)'],
      ['Search Intent', '20%', 'transactional > commercial > navigational > informational (จาก DataForSEO)'],
      ['Service Proximity', '20%', 'ตรงกับบริการที่ธุรกิจทำจริงแค่ไหน'],
      ['CPC Value', '15%', 'CPC สูง = ตลาดยอมจ่าย = มูลค่าลูกค้าต่อคลิกสูง (log-normalized)'],
      ['Local SERP Fit', '10%', 'SERP มี local pack + หน้า service ของธุรกิจท้องถิ่น = คำนี้ Google มองเป็น local'],
      ['Paid Competition', '10%', 'ระดับการแข่งขันโฆษณา (Google/DFS competition index)'],
    ];
    for (const row of salesRows) ws.addRow(row).getCell(3).alignment = { wrapText: true };
    ws.addRow([]);
    const h2 = ws.addRow(['Traffic Score (โอกาสได้ผู้เข้าชม)', 'น้ำหนัก', 'วัดจาก']);
    styleHeaderRow(ws, h2.number, 3);
    const trafficRows: Array<[string, string, string]> = [
      ['Demand', '40%', 'log1p(Reference Volume) เทียบคำที่มากที่สุดในชุด'],
      ['Low Difficulty', '20%', '100 − Keyword Difficulty (DataForSEO)'],
      ['Trend', '15%', 'ทิศทาง 3 เดือนล่าสุดเทียบ 3 เดือนก่อนหน้า'],
      ['SERP Opportunity', '15%', 'SERP มี directory/forum เยอะ = หน้าใหม่แทรกง่าย'],
      ['Topical Fit', '10%', 'ความเกี่ยวข้องกับธุรกิจ'],
    ];
    for (const row of trafficRows) ws.addRow(row).getCell(3).alignment = { wrapText: true };
    ws.addRow([]);
    const h3 = ws.addRow(['Confidence', 'Penalty', 'ความหมาย']);
    styleHeaderRow(ws, h3.number, 3);
    const confRows: Array<[string, string, string]> = [
      ['HIGH', '0', 'Google และ DataForSEO ตรงกัน (ต่างกัน ≤1.5 เท่า)'],
      ['MEDIUM', '−2', 'มีแหล่งเดียว หรือสองแหล่งต่างกัน ≤3 เท่า'],
      ['LOW', '−6', 'สองแหล่งต่างกัน >3 เท่า — ใช้ตัวเลขอย่างระวัง'],
      ['LOCAL', '0', 'volume = 0/ไม่มี แต่ SERP มีหลักฐานธุรกิจท้องถิ่นจริง (Local Opportunity)'],
      ['NO VOLUME', '−8', 'ไม่มีข้อมูล volume จากแหล่งใดเลย'],
    ];
    for (const row of confRows) ws.addRow(row).getCell(3).alignment = { wrapText: true };
  }

  // ── ชีต 7: Sources ──────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Sources', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.columns = [{ width: 26 }, { width: 12 }, { width: 12 }, { width: 26 }, { width: 14 }, { width: 50 }];
    addTitleBlock(ws, 'Data Sources', 'สถานะและความครอบคลุมของแต่ละแหล่งข้อมูลในผลชุดนี้ — ตัวเลขทุกตัวมาจาก API จริง ไม่มีตัวเลขจาก AI');
    const header = ws.addRow(['แหล่งข้อมูล', 'สถานะ', 'Coverage', 'Geo / ขอบเขต', 'ดึงเมื่อ', 'หมายเหตุ']);
    styleHeaderRow(ws, header.number, 6);
    const ss = meta.sourceStatus;
    const startRow = header.number + 1;
    ws.addRow([
      'Google Keyword Planner (Primary Reference)',
      ss?.googleKeywordPlanner.status ?? meta.keywordPlannerStatus,
      ss ? `${Math.round(ss.googleKeywordPlanner.coverage * 100)}%` : 'N/A',
      ss?.googleKeywordPlanner.geo ?? `${meta.locationTarget.resolved} (${meta.locationTarget.level})`,
      fmtDate(ss?.googleKeywordPlanner.fetchedAt),
      cellValue(ss?.googleKeywordPlanner.message ?? meta.keywordPlannerMessage ?? ''),
    ]);
    ws.addRow([
      'DataForSEO (Cross-check + Intent + KD)',
      ss?.dataForSeo.status ?? 'N/A',
      ss ? `${Math.round(ss.dataForSeo.coverage * 100)}%` : 'N/A',
      'Thailand (location 2764)',
      fmtDate(ss?.dataForSeo.fetchedAt),
      cellValue(ss?.dataForSeo.message ?? ''),
    ]);
    ws.addRow([
      'DataForSEO Local SERP',
      ss?.localSerp.status ?? 'N/A',
      ss ? `ตรวจ ${ss.localSerp.checkedCount} คำ` : 'N/A',
      'Thailand (location 2764)',
      fmtDate(ss?.localSerp.fetchedAt),
      cellValue(ss?.localSerp.message ?? 'ตรวจแบบ tiered เฉพาะคำ local/commercial เด่นสุด เพื่อคุมค่าใช้จ่าย'),
    ]);
    ws.addRow([
      'OpenRouter AI',
      'ok',
      'N/A',
      'ใช้เฉพาะ: เสนอ candidate, ตั้งชื่อคลัสเตอร์, เขียน SEO title',
      fmtDate(meta.generatedAt),
      'AI ไม่ใช่แหล่งของตัวเลข volume/CPC/KD/competition ใด ๆ ในไฟล์นี้',
    ]);
    zebra(ws, startRow, startRow + 3, 6);
    for (let r = startRow; r <= startRow + 3; r++) ws.getRow(r).getCell(6).alignment = { wrapText: true };
  }

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `keyword-research-${fileSlug(services[0] ?? 'service')}-${fileSlug(run.primaryLocation)}-${run.targetCount}-${fmtDate(run.createdAt.toISOString())}.xlsx`;
  return new Response(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="keyword-research-${run.targetCount}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}
