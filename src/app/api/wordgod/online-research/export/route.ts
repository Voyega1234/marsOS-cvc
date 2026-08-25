/**
 * WordGod Online — Excel export ของ Business-Centric SEO/AEO/GEO Keyword Engine
 *
 * GET /api/wordgod/online-research/export?researchId=...
 *
 * กติกาสำคัญ (สเปกเดียวกับโหมด local §88–§92):
 *  - export อ่านจาก research run ที่บันทึกไว้แล้วเท่านั้น — ไม่มีการวิจัยซ้ำ
 *    ทำให้ UI = Excel = Handoff มาจาก canonical dataset ชุดเดียวกันเสมอ
 *  - 7 ชีตพอดี: Overview / Keywords_{TARGET} / Wave1_{COUNT} / Seed_Taxonomy /
 *    System_Blueprint / Scoring_Model / Sources
 *  - NULL → "N/A" (ไม่ใช่ 0), Google กับ DFS แสดงแยกคอลัมน์ — ไม่มีการเฉลี่ยรวม
 */
import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { referenceSourceLabel } from '@/lib/wordgod/local/metrics';
import {
  BUSINESS_TYPE_LABELS,
  JOURNEY_STAGE_MAP,
  STRATEGY_PRESETS,
  type OnlineKeywordResult,
  type OnlineResearchResponse,
} from '@/lib/wordgod/online/types';

export const maxDuration = 120;

// ── สไตล์กลาง (ชุดเดียวกับ export ของโหมด local) ─────────────────────────────
const HEADER_FILL: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const ALT_FILL: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 14, color: { argb: 'FF111827' } };

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

function fileSlug(s: string): string {
  return s.trim().replace(/[\\/:*?"<>|#%&{}\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'export';
}

const KEYWORD_COLUMNS: Array<{ header: string; key: string; width: number }> = [
  { header: 'Rank', key: 'rank', width: 7 },
  { header: 'Keyword', key: 'keyword', width: 32 },
  { header: 'Recommended Title', key: 'title', width: 40 },
  { header: 'Slug', key: 'slug', width: 24 },
  { header: 'Slug Status', key: 'slugStatus', width: 11 },
  { header: 'Reference Volume', key: 'refVolume', width: 14 },
  { header: 'Volume Source', key: 'refSource', width: 12 },
  { header: 'Google Volume', key: 'googleVolume', width: 13 },
  { header: 'DFS Volume', key: 'dfsVolume', width: 12 },
  { header: 'Confidence', key: 'confidence', width: 12 },
  { header: 'Search Intent', key: 'intent', width: 13 },
  { header: 'Business Intent', key: 'bizIntent', width: 14 },
  { header: 'Journey Stage', key: 'journey', width: 20 },
  { header: 'Funnel', key: 'funnel', width: 9 },
  { header: 'Objective', key: 'objective', width: 10 },
  { header: 'Cluster', key: 'cluster', width: 22 },
  { header: 'Cluster Role', key: 'clusterRole', width: 11 },
  { header: 'Problem Group', key: 'problem', width: 22 },
  { header: 'KD', key: 'kd', width: 8 },
  { header: 'CPC (฿)', key: 'cpc', width: 10 },
  { header: 'Business Score', key: 'business', width: 12 },
  { header: 'SEO Opp', key: 'seo', width: 10 },
  { header: 'AEO Opp', key: 'aeo', width: 10 },
  { header: 'GEO Opp', key: 'geo', width: 10 },
  { header: 'Final Score', key: 'final', width: 11 },
  { header: 'Page Type', key: 'pageType', width: 15 },
  { header: 'Topic Role', key: 'topicRole', width: 12 },
  { header: 'Suggested Path', key: 'path', width: 26 },
  { header: 'Wave', key: 'wave', width: 7 },
  { header: 'Secondary Keywords', key: 'secondary', width: 32 },
  { header: 'Why This Keyword', key: 'why', width: 44 },
  { header: 'Google Retrieved', key: 'googleAt', width: 13 },
  { header: 'DFS Retrieved', key: 'dfsAt', width: 13 },
];

function keywordRow(r: OnlineKeywordResult): Record<string, string | number | boolean> {
  return {
    rank: r.rank,
    keyword: r.keyword,
    title: cellValue(r.recommendedTitle) as string,
    slug: cellValue(r.suggestedSlug) as string,
    slugStatus: r.slugStatus,
    refVolume: cellValue(r.reference.volume),
    refSource: referenceSourceLabel(r.reference.source),
    googleVolume: cellValue(r.google.status === 'ok' || r.google.status === 'zero' ? r.google.avgMonthlySearches ?? 0 : null),
    dfsVolume: cellValue(r.dfs.status === 'ok' || r.dfs.status === 'zero' ? r.dfs.searchVolume ?? 0 : null),
    confidence: r.confidence === 'NO_VOLUME' ? 'NO VOLUME' : r.confidence,
    intent: cellValue(r.searchIntent.intent),
    bizIntent: r.businessIntent,
    journey: `${r.journeyOrder}. ${JOURNEY_STAGE_MAP[r.journeyStage]?.labelTh ?? r.journeyStage}`,
    funnel: r.funnelStage,
    objective: r.objective,
    cluster: r.cluster,
    clusterRole: r.clusterRole,
    problem: cellValue(r.problemGroup),
    kd: cellValue(r.dfs.keywordDifficulty),
    cpc: cellValue(r.dfs.cpc ?? r.google.bidHighMicros),
    business: Math.round(r.scores.businessScore),
    seo: Math.round(r.scores.seoOpportunity),
    aeo: Math.round(r.scores.aeoOpportunity),
    geo: Math.round(r.scores.geoOpportunity),
    final: Math.round(r.scores.finalScore * 10) / 10,
    pageType: r.pageType,
    topicRole: r.sitemap.topicRole,
    path: cellValue(r.sitemap.suggestedPath),
    wave: r.priorityWave,
    secondary: r.secondaryKeywords.length ? r.secondaryKeywords.join(', ') : '',
    why: cellValue(r.whyThisKeyword) as string,
    googleAt: fmtDate(r.google.retrievedAt),
    dfsAt: fmtDate(r.dfs.retrievedAt),
  };
}

function buildKeywordSheet(wb: ExcelJS.Workbook, name: string, rows: OnlineKeywordResult[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = KEYWORD_COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.width }));
  rows.forEach(r => ws.addRow(keywordRow(r)));
  styleHeaderRow(ws, 1, KEYWORD_COLUMNS.length);
  if (rows.length > 0) {
    zebra(ws, 2, rows.length + 1, KEYWORD_COLUMNS.length);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: KEYWORD_COLUMNS.length } };
    for (const key of ['refVolume', 'googleVolume', 'dfsVolume']) ws.getColumn(key).numFmt = '#,##0';
    ws.getColumn('cpc').numFmt = '#,##0.00';
    ws.getColumn('final').numFmt = '0.0';
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
  if (!run || run.organizationId !== orgId || run.mode !== 'online_business') {
    return NextResponse.json({ error: 'ไม่พบผลการวิจัยนี้' }, { status: 404 });
  }
  if (run.status === 'running') {
    return NextResponse.json({ error: 'run นี้ยังประมวลผลไม่เสร็จ — รอให้เสร็จก่อนแล้วค่อย export' }, { status: 409 });
  }

  let data: OnlineResearchResponse;
  try {
    data = JSON.parse(run.resultData);
  } catch {
    return NextResponse.json({ error: 'ข้อมูลผลการวิจัยเสียหาย ไม่สามารถ export ได้' }, { status: 500 });
  }
  const results = data.results ?? [];
  const meta = data.meta;
  const bp = data.blueprint;
  const products: string[] = JSON.parse(run.services || '[]');
  const preset = STRATEGY_PRESETS[meta.strategyGoal] ?? STRATEGY_PRESETS.BALANCED;
  const bizLabel = meta.businessType === 'OTHER' && meta.businessTypeOther
    ? meta.businessTypeOther : BUSINESS_TYPE_LABELS[meta.businessType];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'MarsOS — Business-Centric SEO/AEO/GEO Keyword Engine';
  wb.created = new Date(run.createdAt);

  // ── ชีต 1: Overview ─────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Overview');
    ws.columns = [{ width: 36 }, { width: 64 }];
    addTitleBlock(ws, 'Business-Centric Keyword Intelligence — Overview',
      `${bizLabel}: ${products.join(', ')} · สร้างเมื่อ ${fmtDate(run.createdAt.toISOString())}`);
    const highConf = results.filter(r => r.confidence === 'HIGH').length;
    const kdVals = results.map(r => r.dfs.keywordDifficulty).filter((v): v is number => typeof v === 'number');
    const refDemand = results.reduce((sum, r) => sum + (r.reference.volume ?? 0), 0);
    const money = results.filter(r => r.sitemap.topicRole === 'MONEY_PAGE').length;
    const aeoRows = results.filter(r => r.journeyStage === 'AEO_QUESTION').length;
    const geoRows = results.filter(r => r.journeyStage === 'GEO_AI_TOPIC').length;
    addKeyValueRows(ws, [
      ['ประเภทธุรกิจ', bizLabel],
      ['สินค้า/บริการ', products.join(', ')],
      ['แบรนด์', meta.brandName ?? 'N/A'],
      ['เว็บไซต์', meta.websiteUrl ?? 'ไม่ได้ระบุ'],
      ['ประเทศ / ภาษา', `${meta.country} / ${meta.language}`],
      ['Strategy Goal', `${preset.label} (Traffic ${preset.traffic}% / Sales ${preset.sales}%)`],
      ['กลุ่มลูกค้า', meta.customerSource === 'AI_INFERRED' ? 'AI วิเคราะห์เอง (ไม่ได้ระบุมา)' : 'ระบุโดยผู้ใช้'],
      ['เป้าหมาย (คีย์เวิร์ด)', run.targetCount],
      ['Candidates ที่วิเคราะห์', meta.candidateCount],
      ['คีย์เวิร์ดที่ได้', meta.qualifiedCount],
      ['Reference Demand รวม (เฉพาะคำที่มีข้อมูล — ไม่ใช่คำสัญญา traffic)', refDemand],
      ['คำที่ Confidence = HIGH', `${highConf} (${results.length ? Math.round((highConf / results.length) * 100) : 0}%)`],
      ['ค่าเฉลี่ย Keyword Difficulty', kdVals.length ? Math.round(kdVals.reduce((a, b) => a + b, 0) / kdVals.length) : 'N/A'],
      ['Money Pages ในแผน', money],
      ['คำ AEO (Answer Engine) / GEO (Generative Engine)', `${aeoRows} / ${geoRows}`],
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

  // ── ชีต 2: Keywords_{TARGET} ────────────────────────────────────────────────
  buildKeywordSheet(wb, `Keywords_${results.length}`, results);

  // ── ชีต 3: Wave1_{COUNT} ────────────────────────────────────────────────────
  const wave1 = results.filter(r => r.priorityWave === 1);
  buildKeywordSheet(wb, `Wave1_${wave1.length}`, wave1);

  // ── ชีต 4: Seed_Taxonomy ────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Seed_Taxonomy', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.columns = [{ width: 26 }, { width: 22 }, { width: 40 }, { width: 60 }];
    addTitleBlock(ws, 'Seed Taxonomy', 'โครงสร้างหัวข้อจาก Business Blueprint และ seed ที่ใช้ค้นจริง');
    const header = ws.addRow(['Branch', 'Product', 'Journey Stages', 'Seed Keywords']);
    styleHeaderRow(ws, header.number, 4);
    const startRow = header.number + 1;
    for (const t of bp?.taxonomy ?? []) {
      const r = ws.addRow([
        t.branch, t.product,
        t.journeyStages.map(s => JOURNEY_STAGE_MAP[s]?.labelTh ?? s).join(', '),
        t.seedKeywords.join(', '),
      ]);
      r.getCell(3).alignment = { wrapText: true };
      r.getCell(4).alignment = { wrapText: true };
    }
    let endRow = ws.lastRow?.number ?? startRow;
    if (endRow >= startRow) zebra(ws, startRow, endRow, 4);
    ws.addRow([]);
    const h2 = ws.addRow(['Clusters ที่ได้จากผลจริง']);
    h2.getCell(1).font = { bold: true };
    const ch = ws.addRow(['Cluster', 'Primary Keyword', 'Keywords', 'Search Demand รวม']);
    styleHeaderRow(ws, ch.number, 4);
    const cStart = ch.number + 1;
    for (const c of data.clusters ?? []) {
      ws.addRow([c.name, c.primaryKeyword, c.keywordCount, cellValue(c.totalReferenceVolume)]);
    }
    endRow = ws.lastRow?.number ?? cStart;
    if (endRow >= cStart) zebra(ws, cStart, endRow, 4);
  }

  // ── ชีต 5: System_Blueprint ─────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('System_Blueprint');
    ws.columns = [{ width: 6 }, { width: 30 }, { width: 84 }];
    addTitleBlock(ws, 'System Blueprint', 'ขั้นตอนที่ระบบใช้ผลิตผลลัพธ์ชุดนี้ (DATA → AI, business-first)');
    const header = ws.addRow(['#', 'ขั้นตอน', 'รายละเอียด']);
    styleHeaderRow(ws, header.number, 3);
    const steps: Array<[string, string]> = [
      ['Business Input + Website Context', 'อ่านข้อมูลธุรกิจที่กรอก + สแกนบริบทจากเว็บไซต์ (title/H1/เมนู/path — ไม่ใช่ technical audit)'],
      ['Business Blueprint (AI ตีความ)', 'Business Map → Segments → Problem Map → JTBD → Solution Map → Purchase Factors — AI เสนอ "ความเข้าใจ" เท่านั้น ไม่ใช่ตัวเลข'],
      ['Customer Journey 19 ขั้น', 'ตั้งแต่ Problem Awareness ถึง Purchase + คำถาม AEO + หัวข้อ GEO (Generative Engine Optimization — ไม่ใช่ภูมิศาสตร์)'],
      ['Seed Taxonomy + Pattern', 'สร้าง seed จาก taxonomy + พฤติกรรมค้นของปัญหาจริง + pattern ซื้อ/รีวิว/เทียบ/คำถาม'],
      ['Discovery', 'ขยาย pool จาก DataForSEO keyword ideas + คำที่คู่แข่งติดอันดับจริง — เป้า pool 8–16× ของเป้าหมาย'],
      ['Google Keyword Planner', 'ดึง volume/CPC/competition จริง = Primary Reference Volume'],
      ['DataForSEO Cross-check', 'ดึง volume แยกอีกแหล่งเพื่อคำนวณ Confidence — เก็บแยกคอลัมน์ ไม่เฉลี่ยรวมเด็ดขาด'],
      ['Search Intent + KD', 'DataForSEO Labs ระบุ intent (มี probability) และ Keyword Difficulty ต่อคำ'],
      ['AI Classification', 'AI จัด journey stage / business intent / ความเกี่ยวข้องกับธุรกิจ — จากรายการคำ ไม่แตะตัวเลข'],
      ['SERP Validation (selective)', 'ตรวจ SERP จริงเฉพาะคำ Tier A (เชิงพาณิชย์/volume สูง) เพื่อคุมค่าใช้จ่าย'],
      ['System Scores', 'Business / SEO Opportunity / AEO / GEO / Final คำนวณในโค้ดทั้งหมด (ดูชีต Scoring_Model)'],
      ['Cannibalization Control', 'คำเจตนาซ้ำ (similarity/SERP overlap สูง) ถูกรวมเป็นคำรองหรือโดน penalty — กันหน้า doorway'],
      ['Cluster Quota Selection', 'คัดตามโควตาต่อ cluster (∝ ขนาด×คุณภาพ) ไม่ใช่ top-N ล้วน — portfolio สมดุลทุกหมวด'],
      ['Titles / Slug / Why (AI)', 'AI เขียน title, slug (ตาม convention ของเว็บไซต์), เหตุผลอิงข้อมูลจริง — หลังข้อมูลจบแล้วเท่านั้น'],
      ['Sitemap + Waves', 'จัด PILLAR/CLUSTER/SUPPORTING/MONEY_PAGE + Wave 1 เป็น portfolio สมดุล SALE/LEAD/TRAFFIC'],
      ['Canonical Save', 'บันทึกทั้งชุดเป็น research run เดียว — UI, Excel นี้ และ handoff ไปหน้า Keyword อ่านจากชุดเดียวกัน'],
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
    ws.columns = [{ width: 32 }, { width: 12 }, { width: 74 }];
    const w = meta.finalWeights ?? preset.finalWeights;
    addTitleBlock(ws, 'Scoring Model',
      `Final = Business×${Math.round(w.business * 100)}% + SEO×${Math.round(w.seo * 100)}% + ((AEO+GEO)/2)×${Math.round(w.aeoGeo * 100)}% − Cannibalization Penalty − Confidence Penalty (น้ำหนักตาม Strategy: ${preset.label})`);
    const h1 = ws.addRow(['Business Score (คุณค่าต่อธุรกิจ)', 'น้ำหนัก', 'วัดจาก']);
    styleHeaderRow(ws, h1.number, 3);
    const bizRows: Array<[string, string, string]> = [
      ['Business Relevance', '30%', 'ตรงกับสินค้า/บริการที่ขายจริงแค่ไหน (AI relevance tier + product token)'],
      ['Revenue Proximity', '30%', 'ใกล้เงินแค่ไหนตามช่วงของ journey stage (band ต่อ stage, intent จริงจาก DFS ดันขึ้น)'],
      ['Problem Relevance', '20%', 'ผูกกับปัญหาจริงของลูกค้าใน Problem Map แค่ไหน (severity ถ่วง)'],
      ['Journey Fit', '20%', 'เหมาะกับ Strategy Goal ที่เลือกแค่ไหน (BOFU สำหรับ Sales, TOFU สำหรับ Traffic)'],
    ];
    for (const row of bizRows) ws.addRow(row).getCell(3).alignment = { wrapText: true };
    ws.addRow([]);
    const h2 = ws.addRow(['SEO Opportunity', 'น้ำหนัก', 'วัดจาก']);
    styleHeaderRow(ws, h2.number, 3);
    const seoRows: Array<[string, string, string]> = [
      ['Demand', '30%', 'log10(Reference Volume) — Google Keyword Planner ก่อน, DataForSEO สำรอง, ไม่มีข้อมูล = 0'],
      ['Low Difficulty', '20%', '100 − Keyword Difficulty (DataForSEO); ไม่มีข้อมูล = คะแนนกลาง 50'],
      ['SERP Opportunity', '20%', 'SERP จริง: UGC/directory เยอะ = แทรกง่าย, แบรนด์ใหญ่ครอง = ยาก (คำที่ไม่ได้ตรวจ = กลาง)'],
      ['Business Relevance', '20%', 'คำที่ตรงธุรกิจได้โอกาสก่อน'],
      ['Trend', '10%', '3 เดือนล่าสุดเทียบก่อนหน้า จาก monthly volumes ของ Google'],
    ];
    for (const row of seoRows) ws.addRow(row).getCell(3).alignment = { wrapText: true };
    ws.addRow([]);
    const h3 = ws.addRow(['AEO / GEO Opportunity', '', 'วัดจาก']);
    styleHeaderRow(ws, h3.number, 3);
    const agRows: Array<[string, string, string]> = [
      ['AEO (Answer Engine)', '', 'รูปคำถาม (คืออะไร/ทำไม/ดีไหม), stage AEO_QUESTION, intent informational, SERP มีบทความเยอะ'],
      ['GEO (Generative Engine)', '', 'หัวข้อที่ AI search ชอบอ้างอิง: authority/เปรียบเทียบ/entity ชัด, stage GEO_AI_TOPIC — ไม่ใช่คำ "ภูมิศาสตร์"'],
    ];
    for (const row of agRows) ws.addRow(row).getCell(3).alignment = { wrapText: true };
    ws.addRow([]);
    const h4 = ws.addRow(['Confidence', 'Penalty', 'ความหมาย']);
    styleHeaderRow(ws, h4.number, 3);
    const confRows: Array<[string, string, string]> = [
      ['HIGH', '0', 'Google และ DataForSEO ตรงกัน (ต่างกัน ≤1.5 เท่า)'],
      ['MEDIUM', '−2', 'มีแหล่งเดียว หรือสองแหล่งต่างกัน ≤3 เท่า'],
      ['LOW', '−6', 'สองแหล่งต่างกัน >3 เท่า — ใช้ตัวเลขอย่างระวัง'],
      ['NO VOLUME', '−8', 'ไม่มีข้อมูล volume จากแหล่งใดเลย — แสดง N/A ตามจริง ไม่แต่งตัวเลข'],
    ];
    for (const row of confRows) ws.addRow(row).getCell(3).alignment = { wrapText: true };
  }

  // ── ชีต 7: Sources ──────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Sources', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.columns = [{ width: 30 }, { width: 12 }, { width: 12 }, { width: 30 }, { width: 14 }, { width: 50 }];
    addTitleBlock(ws, 'Data Sources', 'สถานะและความครอบคลุมของแต่ละแหล่งข้อมูล — ตัวเลขทุกตัวมาจาก API จริง ไม่มีตัวเลขจาก AI');
    const header = ws.addRow(['แหล่งข้อมูล', 'สถานะ', 'Coverage', 'ขอบเขต', 'ดึงเมื่อ', 'หมายเหตุ']);
    styleHeaderRow(ws, header.number, 6);
    const ss = data.sourceStatus;
    const startRow = header.number + 1;
    ws.addRow([
      'Google Keyword Planner (Primary Reference)',
      ss?.googleKeywordPlanner.status ?? 'N/A',
      ss ? `${Math.round(ss.googleKeywordPlanner.coverage * 100)}%` : 'N/A',
      ss?.googleKeywordPlanner.geo ?? meta.country,
      fmtDate(ss?.googleKeywordPlanner.fetchedAt),
      cellValue(ss?.googleKeywordPlanner.message ?? ''),
    ]);
    ws.addRow([
      'DataForSEO (Cross-check + Ideas + Intent + KD)',
      ss?.dataForSeo.status ?? 'N/A',
      ss ? `${Math.round(ss.dataForSeo.coverage * 100)}%` : 'N/A',
      'Thailand (location 2764)',
      fmtDate(ss?.dataForSeo.fetchedAt),
      cellValue(ss?.dataForSeo.message ?? ''),
    ]);
    ws.addRow([
      'DataForSEO SERP Validation',
      ss?.serp.status ?? 'N/A',
      ss ? `ตรวจ ${ss.serp.checkedCount} คำ` : 'N/A',
      'เฉพาะคำ Tier A (เชิงพาณิชย์/volume สูง)',
      fmtDate(ss?.serp.fetchedAt),
      cellValue(ss?.serp.message ?? 'ตรวจแบบ selective เพื่อคุมค่าใช้จ่าย'),
    ]);
    ws.addRow([
      'OpenRouter AI',
      'ok',
      'N/A',
      'ใช้เฉพาะ: Business Blueprint, จัดหมวด journey, ตั้ง title/slug/เหตุผล',
      fmtDate(meta.generatedAt),
      'AI ไม่ใช่แหล่งของตัวเลข volume/CPC/KD/competition ใด ๆ ในไฟล์นี้',
    ]);
    zebra(ws, startRow, startRow + 3, 6);
    for (let r = startRow; r <= startRow + 3; r++) ws.getRow(r).getCell(6).alignment = { wrapText: true };
  }

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `keyword-online-${fileSlug(products[0] ?? 'business')}-${run.targetCount}-${fmtDate(run.createdAt.toISOString())}.xlsx`;
  return new Response(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="keyword-online-${run.targetCount}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}
