/**
 * ชั้น AI ของโหมดออนไลน์ — ใช้ AI เฉพาะงานตีความ/จัดหมวด/ตั้งชื่อเท่านั้น
 *  - buildBusinessBlueprint: Business Map → Segments → Problem Map → JTBD →
 *    Solution Map → Purchase Factors → Taxonomy + Seeds (โครงสร้าง ไม่มีตัวเลข)
 *  - classifyCandidates: จัด journey/funnel/objective/relevance tier ต่อคำ
 *  - generateTitles: title + slug + เหตุผล "ทำไมคำนี้" จากข้อมูลจริงที่ส่งให้
 * AI ห้ามสร้างตัวเลข volume/CPC/KD/อันดับใด ๆ — เราไม่ส่ง field พวกนั้นให้เขียน
 * และไม่อ่านตัวเลขใด ๆ กลับจาก AI
 */

import { callGemini } from '@/lib/wordgod/gemini';
import type {
  BusinessBlueprint,
  BusinessSegment,
  JourneyStage,
  OnlineResearchInput,
  ProblemMapEntry,
  TaxonomyNode,
} from './types';
import { BUSINESS_TYPE_LABELS, JOURNEY_STAGES, JOURNEY_STAGE_MAP } from './types';
import type { WebsiteContext } from './types';

const VALID_STAGES = new Set<string>(JOURNEY_STAGES.map(s => s.stage));

function asStringArray(v: unknown, max = 50): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map(x => x.trim())
    .filter(Boolean)
    .slice(0, max);
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

// ── 1) Business Blueprint ───────────────────────────────────────────────────

export async function buildBusinessBlueprint(
  input: OnlineResearchInput,
  site: WebsiteContext | null
): Promise<BusinessBlueprint> {
  const bizLabel =
    input.businessType === 'OTHER' && input.businessTypeOther
      ? input.businessTypeOther
      : BUSINESS_TYPE_LABELS[input.businessType];

  const siteBlock = site && site.status === 'ok'
    ? `\nบริบทจากเว็บไซต์จริงของธุรกิจ (${site.url}):
- Title: ${site.title ?? '-'}
- Description: ${site.metaDescription ?? '-'}
- H1: ${site.h1.join(' | ') || '-'}
- H2: ${site.h2.slice(0, 12).join(' | ') || '-'}
- เมนู: ${site.navLabels.slice(0, 20).join(', ') || '-'}`
    : '';

  const stageList = JOURNEY_STAGES.map(s => `${s.stage} = ${s.labelTh}`).join('\n');

  const prompt = `คุณคือนักกลยุทธ์ SEO/AEO/GEO ที่วิเคราะห์ธุรกิจแบบ business-centric (problem-first)
วิเคราะห์ธุรกิจนี้แล้วตอบเป็น JSON เท่านั้น (ห้ามมี markdown)

ธุรกิจ:
- ประเภท: ${bizLabel}
- แบรนด์: ${input.brandName || '-'}
- สินค้า/บริการหลัก: ${input.products.join(', ')}
- กลุ่มลูกค้าเป้าหมาย: ${input.targetCustomer || '(ไม่ได้ระบุ — ให้คุณวิเคราะห์เอง)'}
- ปัญหาลูกค้าที่เจ้าของระบุ: ${(input.customerProblems ?? []).join(', ') || '(ไม่ได้ระบุ)'}
- ประเทศ: ${input.country || 'Thailand'} / ภาษา: ${input.language || 'th'}
- บริบทเพิ่มเติม: ${input.businessContext || '-'}${siteBlock}

Customer Journey 19 ขั้นของระบบ (ใช้ค่า stage ตามนี้เท่านั้น):
${stageList}

ตอบ JSON โครงนี้ (ทุกข้อความเป็นภาษาไทยธรรมชาติแบบที่คนไทยพิมพ์ค้นจริง):
{
 "businessSummary": "สรุปธุรกิจ 2-3 ประโยค",
 "segments": [ { "name": "", "description": "" } ],            // 3-5 กลุ่ม
 "problemMap": [ { "problem": "", "segment": "", "severity": "HIGH|MEDIUM|LOW", "searchBehaviors": ["วลีค้นจริง"], "relatedProduct": "" } ],  // 6-12 ปัญหา, searchBehaviors 2-4 วลี/ปัญหา
 "jtbd": [ { "job": "", "segment": "", "triggeredBy": "", "desiredOutcome": "" } ],  // 4-8 ข้อ
 "solutionMap": [ { "problem": "", "solutions": ["ทางแก้รวมทางเลือกอื่น"], "ourAnswer": "" } ],  // ตาม problemMap หลัก ๆ
 "purchaseFactors": [ { "factor": "", "weight": "HIGH|MEDIUM|LOW", "keywordAngles": ["มุมคำค้น"] } ],  // 4-7 ข้อ
 "taxonomy": [ { "branch": "ชื่อกิ่ง", "journeyStages": ["STAGE จากรายการ"], "product": "", "seedKeywords": ["seed ภาษาไทยที่คนพิมพ์ค้นจริง 4-8 คำ"] } ],  // 8-14 กิ่ง ครอบคลุมครบทั้ง TOFU/MOFU/BOFU + AEO_QUESTION + GEO_AI_TOPIC
 "negativeEntities": ["สินค้า/อุปกรณ์/บริการที่ธุรกิจนี้ไม่ได้ขายและไม่ได้ให้บริการ แต่เสี่ยงติดมากับคำค้นหมวดใกล้กัน"],  // 5-15 คำ เช่น ธุรกิจซ่อม wifi → "ไอโฟน", "ipad", "กล้องวงจรปิด", "เครื่องซักผ้า"
 "competitorBrands": ["ชื่อแบรนด์/ร้านคู่แข่งในตลาดเดียวกัน"]  // 0-10 ชื่อ รู้จริงเท่านั้น ไม่รู้ให้ปล่อยว่าง ห้ามเดา
}

กติกาเด็ดขาด:
- ห้ามใส่ตัวเลข search volume, CPC, ความยาก หรือ metric ใด ๆ
- seedKeywords ต้องเป็นคำที่คนพิมพ์ใน Google จริง ไม่ใช่ประโยคการตลาด
- ต้องมีกิ่ง taxonomy ที่ stage เป็น AEO_QUESTION (คำถาม คือ/ทำไม/ยังไง/ไหม) และ GEO_AI_TOPIC (หัวข้อ entity/authority สำหรับ AI search) อย่างละอย่างน้อย 1 กิ่ง
- ถ้าเจ้าของเปิด comparison (${input.includeComparisonKeywords !== false ? 'เปิด' : 'ปิด'}) ให้มีกิ่งเทียบ/vs ด้วย`;

  const raw = (await callGemini(prompt)) as Record<string, unknown>;

  const segments: BusinessSegment[] = (Array.isArray(raw.segments) ? raw.segments : [])
    .map((s: any): BusinessSegment => ({
      name: str(s?.name),
      description: str(s?.description),
      source: input.targetCustomer ? 'USER' : 'AI_INFERRED',
    }))
    .filter(s => s.name)
    .slice(0, 6);

  const problemMap: ProblemMapEntry[] = (Array.isArray(raw.problemMap) ? raw.problemMap : [])
    .map((p: any): ProblemMapEntry => ({
      problem: str(p?.problem),
      segment: str(p?.segment),
      severity: ['HIGH', 'MEDIUM', 'LOW'].includes(p?.severity) ? p.severity : 'MEDIUM',
      searchBehaviors: asStringArray(p?.searchBehaviors, 6),
      relatedProduct: str(p?.relatedProduct, input.products[0] ?? ''),
    }))
    .filter(p => p.problem)
    .slice(0, 14);

  const taxonomy: TaxonomyNode[] = (Array.isArray(raw.taxonomy) ? raw.taxonomy : [])
    .map((t: any): TaxonomyNode => ({
      branch: str(t?.branch),
      journeyStages: asStringArray(t?.journeyStages, 5).filter((s): s is JourneyStage => VALID_STAGES.has(s)),
      product: str(t?.product, input.products[0] ?? ''),
      seedKeywords: asStringArray(t?.seedKeywords, 10),
    }))
    .filter(t => t.branch && t.seedKeywords.length)
    .slice(0, 16);

  if (!taxonomy.length) {
    throw new Error('AI blueprint ไม่มี taxonomy/seed ที่ใช้ได้ — หยุดแทนที่จะเดาต่อ');
  }

  return {
    businessSummary: str(raw.businessSummary, `${bizLabel}: ${input.products.join(', ')}`),
    segments,
    problemMap,
    jtbd: (Array.isArray(raw.jtbd) ? raw.jtbd : [])
      .map((j: any) => ({
        job: str(j?.job), segment: str(j?.segment),
        triggeredBy: str(j?.triggeredBy), desiredOutcome: str(j?.desiredOutcome),
      }))
      .filter(j => j.job)
      .slice(0, 10),
    solutionMap: (Array.isArray(raw.solutionMap) ? raw.solutionMap : [])
      .map((s: any) => ({
        problem: str(s?.problem), solutions: asStringArray(s?.solutions, 6), ourAnswer: str(s?.ourAnswer),
      }))
      .filter(s => s.problem)
      .slice(0, 14),
    purchaseFactors: (Array.isArray(raw.purchaseFactors) ? raw.purchaseFactors : [])
      .map((f: any) => ({
        factor: str(f?.factor),
        weight: ['HIGH', 'MEDIUM', 'LOW'].includes(f?.weight) ? f.weight : 'MEDIUM',
        keywordAngles: asStringArray(f?.keywordAngles, 6),
      }))
      .filter(f => f.factor)
      .slice(0, 8),
    taxonomy,
    negativeEntities: asStringArray(raw.negativeEntities, 20),
    competitorBrands: asStringArray(raw.competitorBrands, 12),
    customerSource: input.targetCustomer ? 'USER' : 'AI_INFERRED',
  };
}

// ── 2) Classification (journey/funnel/objective/relevance) ──────────────────

export interface CandidateClassification {
  journeyStage: JourneyStage;
  businessIntent: 'INFORMATIONAL' | 'EVALUATIVE' | 'TRANSACTIONAL';
  /** 0 = ไม่เกี่ยวกับธุรกิจเลย … 4 = ตรงหัวใจธุรกิจ */
  relevanceTier: 0 | 1 | 2 | 3 | 4;
  problemGroup: string | null;
  serviceOrProduct: string;
}

export const CLASSIFY_BATCH_SIZE = 150;

export async function classifyCandidatesBatch(
  keywords: string[],
  input: OnlineResearchInput,
  blueprint: BusinessBlueprint
): Promise<Map<string, CandidateClassification>> {
  const stageList = JOURNEY_STAGES.map(s => `${s.stage}=${s.labelTh}`).join(', ');
  const problems = blueprint.problemMap.map(p => p.problem).slice(0, 12).join(' | ');

  const prompt = `จัดหมวดคีย์เวิร์ดให้ธุรกิจนี้ ตอบ JSON เท่านั้น
ธุรกิจ: ${blueprint.businessSummary}
สินค้า/บริการ: ${input.products.join(', ')}
กลุ่มปัญหาลูกค้า: ${problems || '-'}
Journey stages (ใช้ค่าเหล่านี้เท่านั้น): ${stageList}

คีย์เวิร์ด (${keywords.length} คำ):
${keywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}

ตอบ: {"items":[{"i":เลขข้อ,"stage":"JOURNEY_STAGE","intent":"INFORMATIONAL|EVALUATIVE|TRANSACTIONAL","tier":0-4,"problem":"กลุ่มปัญหาที่เกี่ยว หรือ null","product":"สินค้า/บริการที่ตรงที่สุดจากรายการ"}]}
กติกา: tier 4=คำซื้อ/จ้างตรงธุรกิจ, 3=เกี่ยวชัดเจน, 2=เกี่ยวทางอ้อม, 1=แตะขอบ, 0=ไม่เกี่ยว
ห้ามใส่ตัวเลข volume/metric ใด ๆ ตอบครบทุกข้อ`;

  const raw = (await callGemini(prompt)) as { items?: any[] };
  const out = new Map<string, CandidateClassification>();
  for (const item of raw.items ?? []) {
    const idx = Number(item?.i) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= keywords.length) continue;
    const stage: JourneyStage = VALID_STAGES.has(item?.stage) ? item.stage : 'EDUCATION_BASICS';
    const tierNum = Number(item?.tier);
    const tier = ([0, 1, 2, 3, 4] as const).includes(tierNum as 0) ? (tierNum as 0 | 1 | 2 | 3 | 4) : 1;
    out.set(keywords[idx], {
      journeyStage: stage,
      businessIntent: ['INFORMATIONAL', 'EVALUATIVE', 'TRANSACTIONAL'].includes(item?.intent)
        ? item.intent
        : JOURNEY_STAGE_MAP[stage].funnel === 'BOFU'
          ? 'TRANSACTIONAL'
          : JOURNEY_STAGE_MAP[stage].funnel === 'MOFU'
            ? 'EVALUATIVE'
            : 'INFORMATIONAL',
      relevanceTier: tier,
      problemGroup: typeof item?.problem === 'string' && item.problem.trim() && item.problem !== 'null' ? item.problem.trim() : null,
      serviceOrProduct: str(item?.product, input.products[0] ?? ''),
    });
  }
  return out;
}

// ── 3) Titles / slugs / why-this-keyword ────────────────────────────────────

export interface TitleResult {
  title: string;
  slug: string;
  why: string;
}

export const TITLE_BATCH_SIZE = 80;

export interface TitleBatchRow {
  keyword: string;
  journeyStage: JourneyStage;
  pageType: string;
  /** ข้อเท็จจริงจริงจากข้อมูล (volume source, cluster, ปัญหา) — เป็น "วัตถุดิบ" ให้เหตุผล */
  facts: string;
}

export async function generateTitlesBatch(
  rows: TitleBatchRow[],
  input: OnlineResearchInput,
  slugConvention: 'latin' | 'thai' | 'mixed' | 'unknown'
): Promise<Map<string, TitleResult>> {
  const slugRule =
    slugConvention === 'thai'
      ? 'slug เป็นภาษาไทยได้ (คั่นด้วย -) ตาม convention เดิมของเว็บ'
      : 'slug เป็นภาษาอังกฤษตัวเล็กคั่นด้วย - (a-z0-9-) เท่านั้น แปลความหมายของคีย์เวิร์ด';

  const prompt = `เขียน SEO title + slug + เหตุผลสั้น ให้คีย์เวิร์ดของธุรกิจนี้ ตอบ JSON เท่านั้น
ธุรกิจ: ${input.brandName || input.products.join(', ')} (${input.products.join(', ')})
ภาษา: ไทย มนุษย์อ่านแล้วอยากคลิก ไม่ยัดคีย์เวิร์ด ห้ามซ้ำกันระหว่างข้อ
${slugRule}

รายการ (${rows.length} ข้อ) — facts คือข้อมูลจริงของแต่ละคำ ใช้เขียน why ห้ามแต่งตัวเลขเพิ่ม:
${rows.map((r, i) => `${i + 1}. "${r.keyword}" | stage=${r.journeyStage} | page=${r.pageType} | facts: ${r.facts}`).join('\n')}

ตอบ: {"items":[{"i":เลขข้อ,"title":"≤60 ตัวอักษรถ้าทำได้","slug":"...","why":"เหตุผล 1-2 ประโยคว่าทำไมคำนี้คุ้มทำ อิง facts เท่านั้น"}]}`;

  const raw = (await callGemini(prompt)) as { items?: any[] };
  const out = new Map<string, TitleResult>();
  for (const item of raw.items ?? []) {
    const idx = Number(item?.i) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= rows.length) continue;
    const title = str(item?.title);
    let slug = str(item?.slug).toLowerCase().replace(/\s+/g, '-');
    if (slugConvention !== 'thai') slug = slug.replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
    if (!title) continue;
    out.set(rows[idx].keyword, { title, slug, why: str(item?.why) });
  }
  return out;
}
