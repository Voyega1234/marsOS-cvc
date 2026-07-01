/**
 * Mars OS — Problem-First Keyword & AI Search Strategy Layer
 * Ported from WordGod problemFirstSkill.ts
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type JourneyStage = 'pre_purchase' | 'during_use' | 'result_interpretation' | 'caregiver' | 'post_purchase' | 'general_education';
export type StrategyMode = 'volume_first' | 'problem_first' | 'hybrid';
export type WebsiteType = 'ecommerce' | 'service' | 'knowledge';
export type AISearchRisk = 'high' | 'medium' | 'low';
export type IntentBucket = 'informational' | 'commercial' | 'transactional' | 'navigational' | 'update';

export interface DiscoveredProblem {
  problem_statement: string;
  journey_stage: JourneyStage;
  problem_group: string;
  urgency_score: number;
  keywords_to_expand: string[];
}

export interface ProblemKeyword {
  keyword: string;
  volume_estimate: number;
  competition: string;
  intent: string;
  keyword_type: string;
  content_type: string;
  journey_stage: JourneyStage;
  original_problem: string;
  problem_group: string;
  problem_urgency_score: number;
}

export interface ArticleGroupDecision {
  article_group: string;
  merge_or_split: 'merge' | 'split' | 'standalone';
  primary_keyword?: string;
  secondary_keywords?: string[];
  internal_link_target?: string;
  next_topic_ideas?: string[];
  notes?: string;
}

export interface AllScores {
  opportunity_score: number;
  sales_impact_score: number;
  buyer_intent_score: number;
  problem_urgency_score: number;
  ai_resilience_score: number;
  cluster_potential_score: number;
  volume_score: number;
  intent_bucket: IntentBucket;
  intent_bucket_score: number;
  keyword_depth_score?: number;
  internal_link_opportunity_score?: number;
  customer_pain_urgency_score?: number;
}

export interface KeywordQAResult {
  passes: boolean;
  warnings: string[];
}

// ─── 2. CustomerJourneyProblemMapper (rule-based) ──────────────────────────────

export function classifyJourneyStage(
  keyword: string,
  intent: string,
  keyword_type?: string
): JourneyStage {
  const kw = keyword.toLowerCase();

  if (/พ่อแม่|ผู้สูงอายุ|ผู้ป่วย|ลูก|เด็ก|ให้คน|สำหรับคน/.test(kw)) return 'caregiver';
  if (/ดูแล|บำรุง|ต่ออายุ|ซ่อม|เปลี่ยน|หลังใช้|ต่อ|อัปเกรด/.test(kw)) return 'post_purchase';
  if (/ผล|ค่า|ตัวเลข|หมายความว่า|อ่านค่า|ปกติไหม|อันตรายไหม|เกิน|ต่ำ|สูง/.test(kw)) return 'result_interpretation';
  if (/ใช้งาน|ตั้งค่า|ไม่ทำงาน|error|ปัญหา|วิธีใช้|ขึ้น|ไม่ขึ้น|ค้าง/.test(kw)) return 'during_use';
  if (/เลือก|ซื้อ|ยี่ห้อ|รุ่น|ราคา|เปรียบเทียบ|ดีที่สุด|แนะนำ|ก่อนซื้อ|ควรเลือก/.test(kw)) return 'pre_purchase';

  if (intent === 'transactional' || intent === 'commercial' || intent === 'comparison') return 'pre_purchase';
  if (intent === 'problem_solving') return 'during_use';
  if (intent === 'update') return 'post_purchase';

  return 'general_education';
}

// ─── 3. ProblemToKeywordExpander ───────────────────────────────────────────────

function buildProblemExpansionPrompt(
  problems: DiscoveredProblem[],
  niche: string,
  count: number,
  excludeList: string[]
): string {
  const problemLines = problems.map((p, i) =>
    `${i + 1}. [${p.journey_stage}] ${p.problem_statement} (urgency: ${p.urgency_score}/10)`
  ).join('\n');

  const excludeSection = excludeList.length > 0
    ? `\nEXCLUDE these keywords (already found):\n${excludeList.slice(0, 100).map(k => `- ${k}`).join('\n')}\n`
    : '';

  return `You are a keyword research expert.

Niche: ${niche}

Customer problems to convert into keywords:
${problemLines}
${excludeSection}
For each problem, generate search queries real Thai customers would type.
Focus on problem-first, question-based, and comparison keywords.
Generate exactly ${count} unique keywords total.

For each keyword include:
- keyword: Thai search query
- volume_estimate: estimated monthly searches (number)
- competition: LOW | MEDIUM | HIGH
- intent: Informational | Commercial | Transactional | Navigational
- journey_stage: pre_purchase | during_use | result_interpretation | caregiver | post_purchase | general_education
- original_problem: which problem statement this addresses (copy exact text)
- problem_group: short English group label

IMPORTANT: Use Google Search to find real Thai search queries for these problems first, then return as JSON only:
{
  "keywords": [
    {
      "keyword": "...",
      "volume_estimate": 500,
      "competition": "LOW",
      "intent": "Informational",
      "journey_stage": "pre_purchase",
      "original_problem": "...",
      "problem_group": "buying_decision"
    }
  ]
}`;
}

export interface ProblemExpandResult {
  keywords: ProblemKeyword[];
  groundingQueries: string[];
  groundingUrls: string[];
}

export async function runProblemToKeywordExpander(
  problems: DiscoveredProblem[],
  niche: string,
  excludeSet: Set<string>,
  onProgress: (msg: string) => void,
  callGeminiWithGrounding: (prompt: string) => Promise<{ data: any; grounding: { webSearchQueries: string[]; sourceUrls: string[] } }>
): Promise<ProblemExpandResult> {
  if (problems.length === 0) return { keywords: [], groundingQueries: [], groundingUrls: [] };

  const PER_BATCH = 5;
  const batches: DiscoveredProblem[][] = [];
  for (let i = 0; i < problems.length; i += PER_BATCH) {
    batches.push(problems.slice(i, i + PER_BATCH));
  }

  const results: ProblemKeyword[] = [];
  const allGroundingQueries: string[] = [];
  const allGroundingUrls: string[] = [];
  const PARALLEL = 3;

  for (let wave = 0; wave < batches.length; wave += PARALLEL) {
    const waveBatches = batches.slice(wave, wave + PARALLEL);
    await Promise.all(waveBatches.map(async (batch) => {
      try {
        const exclude = Array.from(excludeSet).slice(0, 100);
        const prompt = buildProblemExpansionPrompt(batch, niche, batch.length * 5, exclude);
        const { data, grounding } = await callGeminiWithGrounding(prompt);
        for (const q of grounding.webSearchQueries) {
          if (!allGroundingQueries.includes(q)) allGroundingQueries.push(q);
        }
        for (const u of grounding.sourceUrls) {
          if (!allGroundingUrls.includes(u)) allGroundingUrls.push(u);
        }
        for (const kw of (data.keywords || [])) {
          if (!kw.keyword) continue;
          const norm = kw.keyword.trim().toLowerCase();
          if (excludeSet.has(norm)) continue;
          excludeSet.add(norm);
          results.push({
            keyword: kw.keyword,
            volume_estimate: kw.volume_estimate || 0,
            competition: kw.competition || 'UNSPECIFIED',
            intent: (kw.intent || 'Informational').toLowerCase(),
            keyword_type: 'problem',
            content_type: 'problem_solving_article',
            journey_stage: kw.journey_stage || 'general_education',
            original_problem: kw.original_problem || batch[0].problem_statement,
            problem_group: kw.problem_group || batch[0].problem_group,
            problem_urgency_score: batch[0].urgency_score * 10,
          });
        }
      } catch { /* skip batch on error */ }
    }));
    onProgress(`[2b] Problem keywords: wave ${wave + 1}/${batches.length} done`);
  }

  return { keywords: results, groundingQueries: allGroundingQueries, groundingUrls: allGroundingUrls };
}

// ─── 4. AISearchRiskClassifier (rule-based) ────────────────────────────────────

export function classifyAISearchRisk(
  keyword: string,
  intent: string,
  content_type: string
): { risk: AISearchRisk; ai_resilience_score: number } {
  const kw = keyword.toLowerCase();

  const highRiskPatterns = [
    /^.{0,20}คืออะไร\??$/,
    /^.{0,15}หมายถึงอะไร\??$/,
    /^.{0,15}แปลว่าอะไร\??$/,
  ];
  const isShortDefinition = highRiskPatterns.some(p => p.test(kw)) && kw.split(/\s+/).length <= 4;

  if (isShortDefinition) return { risk: 'high', ai_resilience_score: 25 };

  if (intent === 'informational' && !/(เปรียบ|ต่างกัน|ไหนดี|เลือก|ปัญหา|อันตราย|ควร)/.test(kw)) {
    return { risk: 'high', ai_resilience_score: 35 };
  }

  const lowRiskPatterns = [
    /ราคา|ซื้อ|สั่ง|จอง|ติดต่อ|บริการ|รับทำ|รับยื่น/,
    /เปรียบเทียบ|vs\.?|ดีกว่า|ไหนดี|ยี่ห้อไหน/,
    /ปัญหา|แก้|ไม่ทำงาน|error|ขึ้น error/,
    /อันตราย|เสี่ยง|ควรกังวล|ผลข้างเคียง/,
    /เช็คลิสต์|checklist|ขั้นตอน|วิธีเลือก|ควรรู้ก่อน/,
    /รีวิว|ประสบการณ์|pantip/,
  ];
  if (lowRiskPatterns.some(p => p.test(kw))) return { risk: 'low', ai_resilience_score: 82 };

  if (['transactional', 'commercial', 'service_seeking', 'comparison', 'price', 'review', 'problem_solving'].includes(intent)) {
    return { risk: 'low', ai_resilience_score: 75 };
  }

  return { risk: 'medium', ai_resilience_score: 55 };
}

// ─── 5. ArticleGroupingDecisionEngine (rule-based) ────────────────────────────

export async function runArticleGroupingDecisionEngine(
  keywords: Array<{ keyword: string; intent: string; volume: number; journey_stage?: string }>,
  niche: string,
  onProgress: (msg: string) => void
): Promise<Map<string, ArticleGroupDecision>> {
  onProgress(`[Article grouping] Grouping ${keywords.length} keywords (rule-based)...`);
  const resultMap = new Map<string, ArticleGroupDecision>();

  const buckets = new Map<string, typeof keywords>();
  for (const kw of keywords) {
    const key = `${kw.intent}__${kw.journey_stage ?? 'general'}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(kw);
  }

  Array.from(buckets.entries()).forEach(([bucketKey, group]) => {
    const [intent, journeyStage] = bucketKey.split('__');
    (group as Array<{ keyword: string; intent: string; volume: number; journey_stage?: string }>)
      .sort((a, b) => b.volume - a.volume);
    const [primary, ...rest] = group;
    const groupLabel = `${intent}_${journeyStage}`.replace(/[^a-z_]/g, '_');
    const mergeOrSplit: 'merge' | 'split' | 'standalone' = group.length >= 3 ? 'merge' : 'standalone';

    resultMap.set(primary.keyword, {
      article_group: groupLabel,
      merge_or_split: mergeOrSplit,
      primary_keyword: primary.keyword,
      secondary_keywords: (rest as Array<{ keyword: string }>).map(k => k.keyword),
      next_topic_ideas: [],
    });

    for (const kw of (rest as Array<{ keyword: string }>) ) {
      resultMap.set(kw.keyword, {
        article_group: groupLabel,
        merge_or_split: mergeOrSplit,
        primary_keyword: primary.keyword,
        secondary_keywords: [],
        next_topic_ideas: [],
      });
    }
  });

  return resultMap;
}

// ─── 5b. Intent-Bucket Scoring ────────────────────────────────────────────────

export function computeKnowledgeImpactScore(keyword: string, intent: string): number {
  const kw = keyword.toLowerCase();
  let score = 40;
  if (/คืออะไร|หมายถึง|อธิบาย|ทำงานอย่างไร|หลักการ/.test(kw)) score += 25;
  if (/วิธี|ขั้นตอน|สาธิต|ตัวอย่าง/.test(kw)) score += 20;
  if (/ประกอบด้วย|ประเภท|ชนิด|แบบ/.test(kw)) score += 15;
  if (/ความรู้|เข้าใจ|เรียนรู้|ศึกษา/.test(kw)) score += 10;
  if (intent === 'informational') score += 10;
  return Math.min(100, score);
}

function computeDepthPotentialScore(keyword: string): number {
  const words = keyword.trim().split(/\s+/).length;
  if (words >= 5) return 80;
  if (words >= 4) return 70;
  if (words >= 3) return 60;
  if (words >= 2) return 50;
  return 35;
}

function computeTopicalAuthorityScore(keyword: string, intent: string): number {
  const kw = keyword.toLowerCase();
  let score = 50;
  if (/ทั้งหมด|ครบ|สมบูรณ์|รวม|คู่มือ|guide/.test(kw)) score += 25;
  if (/มือใหม่|เริ่มต้น|พื้นฐาน|101/.test(kw)) score += 15;
  if (intent === 'informational') score += 10;
  return Math.min(100, score);
}

function computeComparisonValueScore(keyword: string): number {
  const kw = keyword.toLowerCase();
  let score = 40;
  if (/เปรียบเทียบ|vs\.?|ต่างกัน|ดีกว่า/.test(kw)) score += 30;
  if (/ยี่ห้อไหน|รุ่นไหน|แบบไหนดี|อะไรดี/.test(kw)) score += 25;
  if (/ข้อดีข้อเสีย|pros.*cons|ดีไหม/.test(kw)) score += 20;
  if (/รีวิว|review/.test(kw)) score += 15;
  return Math.min(100, score);
}

function computeConversionPotentialScore(keyword: string, intent: string): number {
  const kw = keyword.toLowerCase();
  let score = 40;
  if (/ซื้อ|สั่ง|จอง|ชำระ/.test(kw)) score += 35;
  if (/ราคา|ค่าใช้จ่าย|โปรโมชัน|ส่วนลด/.test(kw)) score += 25;
  if (/ติดต่อ|โทร|line|สมัคร|ขอใบเสนอ/.test(kw)) score += 30;
  if (/บริการ|รับทำ|รับยื่น/.test(kw)) score += 20;
  if (intent === 'transactional') score += 10;
  return Math.min(100, score);
}

function computeServiceRelevanceScore(keyword: string): number {
  const kw = keyword.toLowerCase();
  let score = 40;
  if (/บริการ|agency|รับจัด|รับทำ|ผู้เชี่ยวชาญ/.test(kw)) score += 30;
  if (/ให้คำปรึกษา|consult|มืออาชีพ/.test(kw)) score += 20;
  if (/ฟรี|free|ทดลอง|demo/.test(kw)) score += 15;
  return Math.min(100, score);
}

function computeBrandRelevanceScore(keyword: string): number {
  const kw = keyword.toLowerCase();
  let score = 40;
  if (/เกี่ยวกับ|about|ประวัติ/.test(kw)) score += 20;
  if (/ทำไมเลือก|เหตุผล|จุดเด่น/.test(kw)) score += 25;
  if (/รีวิวจากลูกค้า|testimonial|pantip|ดีจริงไหม/.test(kw)) score += 30;
  return Math.min(100, score);
}

function computeConversionSupportScore(keyword: string, intent: string): number {
  const kw = keyword.toLowerCase();
  let score = 40;
  if (/ขั้นตอน|กระบวนการ|วิธีทำงาน/.test(kw)) score += 20;
  if (/case study|ตัวอย่าง|ผลลัพธ์/.test(kw)) score += 25;
  if (intent === 'commercial' || intent === 'transactional') score += 15;
  return Math.min(100, score);
}

function computeTrustBuildingScore(keyword: string): number {
  const kw = keyword.toLowerCase();
  let score = 40;
  if (/รีวิว|ความน่าเชื่อถือ|ใบอนุญาต|มาตรฐาน/.test(kw)) score += 25;
  if (/ประสบการณ์|ผู้เชี่ยวชาญ|certified/.test(kw)) score += 20;
  if (/รางวัล|award|ที่สุด|ดีที่สุด/.test(kw)) score += 15;
  return Math.min(100, score);
}

function computeContentGapScore(keyword: string): number {
  const words = keyword.trim().split(/\s+/).length;
  if (words >= 4) return 70;
  if (words >= 3) return 55;
  return 40;
}

function computeFreshnessNeedScore(keyword: string): number {
  const kw = keyword.toLowerCase();
  let score = 40;
  if (/ล่าสุด|2026|2025|ใหม่|อัปเดต/.test(kw)) score += 35;
  if (/กฎใหม่|เงื่อนไขใหม่|ประกาศ|นโยบาย/.test(kw)) score += 30;
  if (/เทรนด์|trend|ตลาด|สถิติ/.test(kw)) score += 20;
  return Math.min(100, score);
}

function computeChangeImpactScore(keyword: string): number {
  const kw = keyword.toLowerCase();
  let score = 40;
  if (/กฎ|law|ข้อบังคับ|regulation|ภาษี|tax/.test(kw)) score += 30;
  if (/ราคา|ค่า|fee|อัตรา/.test(kw)) score += 25;
  if (/เปลี่ยน|ปรับ|แก้ไข/.test(kw)) score += 20;
  return Math.min(100, score);
}

function computeSourceAvailabilityScore(keyword: string): number {
  const kw = keyword.toLowerCase();
  let score = 50;
  if (/ข่าว|news|ประกาศ|สื่อ/.test(kw)) score += 30;
  if (/รายงาน|report|สถิติ/.test(kw)) score += 20;
  return Math.min(100, score);
}

export function computeIntentBucketScore(
  keyword: string,
  intent: string,
  bucket: IntentBucket,
  base: { volume_score: number; ai_resilience_score: number; sales_impact_score: number; buyer_intent_score: number }
): number {
  const { volume_score, ai_resilience_score, sales_impact_score, buyer_intent_score } = base;

  switch (bucket) {
    case 'informational': {
      const knowledge = computeKnowledgeImpactScore(keyword, intent);
      const depth = computeDepthPotentialScore(keyword);
      const topical = computeTopicalAuthorityScore(keyword, intent);
      return Math.round(
        knowledge           * 0.25 +
        ai_resilience_score * 0.25 +
        depth               * 0.20 +
        topical             * 0.15 +
        volume_score        * 0.15
      );
    }
    case 'commercial': {
      const comparison = computeComparisonValueScore(keyword);
      return Math.round(
        buyer_intent_score  * 0.30 +
        sales_impact_score  * 0.25 +
        comparison          * 0.20 +
        ai_resilience_score * 0.15 +
        volume_score        * 0.10
      );
    }
    case 'transactional': {
      const conversion = computeConversionPotentialScore(keyword, intent);
      const service = computeServiceRelevanceScore(keyword);
      return Math.round(
        conversion          * 0.35 +
        sales_impact_score  * 0.30 +
        service             * 0.20 +
        volume_score        * 0.10 +
        ai_resilience_score * 0.05
      );
    }
    case 'navigational': {
      const brand = computeBrandRelevanceScore(keyword);
      const convSupport = computeConversionSupportScore(keyword, intent);
      const trust = computeTrustBuildingScore(keyword);
      const gap = computeContentGapScore(keyword);
      return Math.round(
        brand       * 0.35 +
        convSupport * 0.25 +
        trust       * 0.20 +
        volume_score * 0.10 +
        gap         * 0.10
      );
    }
    case 'update': {
      const freshness = computeFreshnessNeedScore(keyword);
      const changeImpact = computeChangeImpactScore(keyword);
      const sourceAvail = computeSourceAvailabilityScore(keyword);
      const topical = computeTopicalAuthorityScore(keyword, intent);
      return Math.round(
        freshness    * 0.30 +
        changeImpact * 0.25 +
        sourceAvail  * 0.20 +
        volume_score * 0.15 +
        topical      * 0.10
      );
    }
    default:
      return Math.round((sales_impact_score + volume_score + ai_resilience_score) / 3);
  }
}

// ─── 5c. Gap-Fill Scoring ─────────────────────────────────────────────────────

export function computeKeywordDepthScore(keyword: string, topicClusterRole?: string): number {
  const kw = keyword.toLowerCase();
  const words = kw.trim().split(/\s+/).length;
  let score = 0;

  if (words >= 6) score += 40;
  else if (words >= 4) score += 30;
  else if (words >= 3) score += 20;
  else if (words >= 2) score += 10;

  if (/ขั้นตอน|วิธีการ|คู่มือ|guide|checklist|เช็กลิสต์/.test(kw)) score += 25;
  if (/เปรียบเทียบ|vs\.?|ต่างกัน|pros.*cons/.test(kw)) score += 20;
  if (/ทีละขั้น|step.by.step|ละเอียด|สมบูรณ์/.test(kw)) score += 20;
  if (/ปัญหา|error|แก้ไข|วิธีแก้/.test(kw)) score += 15;

  if (topicClusterRole === 'parent_topic') score += 15;
  if (topicClusterRole === 'cluster_topic') score += 10;
  if (topicClusterRole === 'glossary') score -= 10;

  return Math.max(0, Math.min(100, score));
}

export function computeInternalLinkOpportunityScore(
  keyword: string,
  intent: string,
  topicClusterRole?: string
): number {
  const kw = keyword.toLowerCase();
  let score = 30;

  if (/เปรียบเทียบ|แนะนำ|รีวิว|ยี่ห้อไหน|วิธีเลือก/.test(kw)) score += 30;
  if (['commercial', 'comparison', 'review'].includes(intent)) score += 20;
  if (/ปัญหา|error|แก้ไข/.test(kw)) score += 25;
  if (topicClusterRole === 'faq_candidate') score += 20;
  if (topicClusterRole === 'cluster_topic') score += 15;
  if (topicClusterRole === 'troubleshooting') score += 20;
  if (intent === 'informational') score += 10;
  if (intent === 'navigational') score += 5;

  return Math.max(0, Math.min(100, score));
}

export function computeCustomerPainUrgencyScore(
  keyword: string,
  problemUrgencyScore?: number,
  journeyStage?: string
): number {
  let score = problemUrgencyScore ?? 40;
  const kw = keyword.toLowerCase();

  if (/อันตราย|เสี่ยง|ผลข้างเคียง|ควรกังวล|ฉุกเฉิน/.test(kw)) score += 30;
  if (/ไม่ได้เรื่อง|ไม่ทำงาน|error|พัง|ล้ม/.test(kw)) score += 25;
  if (/ด่วน|ตอนนี้|เร็วที่สุด|ทันที/.test(kw)) score += 20;
  if (/ปัญหา|แก้ไข|วิธีแก้|ช่วย/.test(kw)) score += 15;
  if (/กังวล|สงสัย|ไม่แน่ใจ/.test(kw)) score += 10;

  if (journeyStage === 'result_interpretation') score += 20;
  if (journeyStage === 'during_use') score += 15;
  if (journeyStage === 'caregiver') score += 10;
  if (journeyStage === 'general_education') score -= 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function suggestAnchorText(keyword: string, intent: string): string {
  const kw = keyword.trim();
  if (/ราคา|ค่าใช้จ่าย/.test(kw.toLowerCase())) return `ดูราคา${kw.replace(/ราคา.*/, '').trim()}`;
  if (/เปรียบเทียบ|vs\.?/.test(kw.toLowerCase())) return `เปรียบเทียบ${kw.replace(/เปรียบเทียบ/, '').trim()}`;
  if (/วิธีเลือก|ก่อนซื้อ/.test(kw.toLowerCase())) return `คู่มือเลือก${kw.replace(/วิธีเลือก|ก่อนซื้อ/, '').trim()}`;
  if (intent === 'transactional') return `ดูบริการ${kw}`;
  if (intent === 'commercial') return `อ่านรีวิว${kw}`;
  return kw;
}

export function validateKeywordResearchQA(kw: {
  keyword: string;
  intent?: string;
  journey_stage?: string;
  ai_search_risk?: string;
  sales_impact_score?: number;
  priority_score?: number;
  volume?: number;
  customer_problem?: string;
  article_group?: string;
  internal_link_opportunity_score?: number;
  intent_bucket?: string;
}): KeywordQAResult {
  const warnings: string[] = [];
  const bucket = kw.intent_bucket ?? 'informational';
  const isCommercialOrTransactional = ['commercial', 'transactional'].includes(bucket);

  if (!kw.journey_stage) warnings.push('Journey Stage not assigned');
  if (!kw.intent) warnings.push('Search Intent not assigned');
  if (!kw.ai_search_risk) warnings.push('AI Search Resilience not scored');

  if (isCommercialOrTransactional && (kw.sales_impact_score ?? 0) === 0 && !kw.customer_problem) {
    warnings.push('Commercial/Transactional keyword has no sales impact score or customer problem');
  }

  if (!kw.article_group && !kw.customer_problem) {
    warnings.push('Keyword not connected to any customer problem or article group');
  }

  if ((kw.priority_score ?? 0) === 0) {
    warnings.push('Priority Score is 0 — scoring incomplete');
  }

  return { passes: warnings.length === 0, warnings };
}

// ─── 6. SalesImpactScoringEngine ──────────────────────────────────────────────

const INTENT_SALES_VALUE: Record<string, number> = {
  transactional: 95, service_seeking: 85, price: 80, commercial: 75,
  comparison: 70, review: 60, problem_solving: 50, checklist: 45,
  informational: 30, navigational: 25, update: 20,
};

const JOURNEY_MULTIPLIER: Record<string, number> = {
  pre_purchase: 1.30,
  result_interpretation: 1.20,
  during_use: 1.00,
  caregiver: 1.10,
  post_purchase: 0.90,
  general_education: 0.70,
};

const WEBSITE_TYPE_INTENT_BOOST: Record<WebsiteType, string[]> = {
  ecommerce: ['transactional', 'commercial', 'price', 'comparison'],
  service: ['service_seeking', 'commercial', 'transactional'],
  knowledge: ['informational', 'update', 'checklist'],
};

export function computeSalesImpactScore(
  intent: string,
  journey_stage: string,
  volume: number,
  website_type?: WebsiteType
): number {
  const intentBase = INTENT_SALES_VALUE[intent] ?? 30;
  const journeyMult = JOURNEY_MULTIPLIER[journey_stage] ?? 0.80;

  let score = intentBase * journeyMult;

  if (volume > 0) score += Math.min(15, Math.log10(volume + 1) * 5);

  if (website_type && WEBSITE_TYPE_INTENT_BOOST[website_type]?.includes(intent)) {
    score = Math.min(score * 1.15, 100);
  }
  if (website_type === 'knowledge' && ['transactional', 'service_seeking'].includes(intent)) {
    score = Math.min(score, 30);
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function computeBuyerIntentScore(intent: string): number {
  return INTENT_SALES_VALUE[intent] ?? 30;
}

export function computeVolumeScore(volume: number): number {
  if (volume >= 100000) return 100;
  if (volume >= 50000) return 90;
  if (volume >= 20000) return 80;
  if (volume >= 10000) return 70;
  if (volume >= 5000) return 60;
  if (volume >= 1000) return 50;
  if (volume >= 500) return 40;
  if (volume >= 100) return 30;
  if (volume > 0) return 20;
  return 10;
}

// ─── 7. ProblemFirstPriorityEngine ────────────────────────────────────────────

const STRATEGY_BUCKET_WEIGHT: Record<IntentBucket, Record<StrategyMode, {
  bucket_weight: number;
  volume_weight: number;
  pain_weight: number;
  resilience_weight: number;
}>> = {
  informational: {
    volume_first:  { bucket_weight: 0.50, volume_weight: 0.30, pain_weight: 0.10, resilience_weight: 0.10 },
    hybrid:        { bucket_weight: 0.65, volume_weight: 0.15, pain_weight: 0.10, resilience_weight: 0.10 },
    problem_first: { bucket_weight: 0.55, volume_weight: 0.05, pain_weight: 0.25, resilience_weight: 0.15 },
  },
  commercial: {
    volume_first:  { bucket_weight: 0.45, volume_weight: 0.30, pain_weight: 0.15, resilience_weight: 0.10 },
    hybrid:        { bucket_weight: 0.60, volume_weight: 0.15, pain_weight: 0.15, resilience_weight: 0.10 },
    problem_first: { bucket_weight: 0.50, volume_weight: 0.05, pain_weight: 0.30, resilience_weight: 0.15 },
  },
  transactional: {
    volume_first:  { bucket_weight: 0.40, volume_weight: 0.35, pain_weight: 0.15, resilience_weight: 0.10 },
    hybrid:        { bucket_weight: 0.55, volume_weight: 0.20, pain_weight: 0.15, resilience_weight: 0.10 },
    problem_first: { bucket_weight: 0.45, volume_weight: 0.05, pain_weight: 0.35, resilience_weight: 0.15 },
  },
  navigational: {
    volume_first:  { bucket_weight: 0.50, volume_weight: 0.30, pain_weight: 0.10, resilience_weight: 0.10 },
    hybrid:        { bucket_weight: 0.65, volume_weight: 0.15, pain_weight: 0.10, resilience_weight: 0.10 },
    problem_first: { bucket_weight: 0.60, volume_weight: 0.05, pain_weight: 0.20, resilience_weight: 0.15 },
  },
  update: {
    volume_first:  { bucket_weight: 0.45, volume_weight: 0.35, pain_weight: 0.10, resilience_weight: 0.10 },
    hybrid:        { bucket_weight: 0.60, volume_weight: 0.20, pain_weight: 0.10, resilience_weight: 0.10 },
    problem_first: { bucket_weight: 0.50, volume_weight: 0.05, pain_weight: 0.30, resilience_weight: 0.15 },
  },
};

export function computePriorityScore(scores: AllScores, strategy_mode: StrategyMode = 'hybrid'): number {
  const {
    ai_resilience_score,
    volume_score,
    keyword_depth_score,
    internal_link_opportunity_score,
    customer_pain_urgency_score,
    problem_urgency_score,
    intent_bucket,
    intent_bucket_score,
  } = scores;

  const painScore = customer_pain_urgency_score ?? problem_urgency_score;
  const depthScore = keyword_depth_score ?? 50;
  const linkScore = internal_link_opportunity_score ?? 50;

  const w = STRATEGY_BUCKET_WEIGHT[intent_bucket]?.[strategy_mode]
    ?? STRATEGY_BUCKET_WEIGHT.informational.hybrid;

  const raw =
    intent_bucket_score  * w.bucket_weight +
    volume_score         * w.volume_weight +
    painScore            * w.pain_weight +
    ai_resilience_score  * w.resilience_weight;

  const bonus = (depthScore * 0.03) + (linkScore * 0.02);

  return Math.max(0, Math.min(100, Math.round(raw + bonus)));
}

// ─── 8. ProblemFirstTitleGenerator ────────────────────────────────────────────

const TITLE_PATTERNS: Record<JourneyStage, string[]> = {
  pre_purchase: [
    'วิธีเลือก{keyword}ให้เหมาะกับการใช้งานจริง ก่อนตัดสินใจซื้อ',
    '{keyword}แบบไหนดี? เปรียบเทียบให้ชัดก่อนเลือกซื้อ',
    'ก่อนซื้อ{keyword}ควรรู้อะไรบ้าง? เช็กลิสต์สำหรับมือใหม่',
  ],
  during_use: [
    '{keyword}เกิดจากอะไร? วิธีเช็กปัญหาเบื้องต้นก่อนส่งซ่อม',
    'ใช้{keyword}แล้วเจอปัญหาแบบนี้ ควรแก้อย่างไร',
  ],
  result_interpretation: [
    '{keyword}หมายความว่าอะไร? ควรกังวลแค่ไหนและควรทำอย่างไรต่อ',
    '{keyword}อันตรายไหม? ข้อควรรู้ก่อนตัดสินใจซื้อหรือใช้งานต่อ',
  ],
  caregiver: [
    'เลือก{keyword}ให้พ่อแม่หรือผู้สูงอายุ ควรดูอะไรบ้าง',
    '{keyword}สำหรับผู้สูงอายุ เลือกอย่างไรให้ใช้งานง่ายและปลอดภัย',
  ],
  post_purchase: [
    '{keyword}ต้องดูแลอย่างไร? วิธีใช้และดูแลให้ใช้งานได้นาน',
    '{keyword}มีปัญหาหลังซื้อ แก้อย่างไรและควรเช็กอะไรบ้าง',
  ],
  general_education: [
    '{keyword}คืออะไร? รวมข้อควรรู้ที่เข้าใจง่ายสำหรับมือใหม่',
  ],
};

export function buildProblemFirstTitlePrompt(
  requests: Array<{
    keyword: string;
    volume: number;
    competition: string;
    intent: string;
    keyword_type: string;
    content_type: string;
    business_context: string;
    category: string;
    journey_stage?: JourneyStage;
    original_problem?: string;
    ai_resilience_score?: number;
  }>,
  targetLanguage: string
): string {
  const rows = requests.map((r, i) => {
    const patterns = r.journey_stage ? TITLE_PATTERNS[r.journey_stage] : [];
    const patternHint = patterns.length > 0 ? `Pattern hint: ${patterns[0].replace('{keyword}', r.keyword)}` : '';
    const aiHint = (r.ai_resilience_score ?? 100) < 40
      ? 'AI RISK HIGH: Make title emphasize specific personal context, unique data, or expert opinion — content AI cannot fully replace.'
      : '';
    const problemHint = r.original_problem ? `Customer problem context: "${r.original_problem}"` : '';
    return `${i}|${r.keyword}|${r.intent}|${r.journey_stage || ''}|${r.volume}|${patternHint}|${aiHint}|${problemHint}`;
  }).join('\n');

  return `You are an SEO Title Expert. Write problem-first SEO titles / H1 in ${targetLanguage === 'th' ? 'Thai' : 'English'}.

Business context: ${requests[0]?.business_context || ''}

Rules:
1. Title must include the keyword or close variation
2. Title must clearly show the problem being solved or question being answered
3. Match the journey stage framing (pre_purchase=buying guide, during_use=troubleshooting, result_interpretation=explanation, caregiver=caregiver guide, post_purchase=maintenance, general_education=educational)
4. No keyword stuffing, no overclaiming, no guaranteed results
5. FORBIDDEN words in title: pantip, sanook, wongnai, reddit, facebook, youtube, tiktok, blockdit, medium
6. Natural Thai language
7. 50-70 characters ideal

Format: index|keyword|journey_stage
${rows}

Return ONLY valid JSON:
{
  "titles": [
    {
      "keyword": "...",
      "title": "...",
      "aeo_question": "...",
      "seo_score": 8,
      "aeo_score": 7,
      "ai_search_score": 8,
      "ctr_score": 7,
      "notes": "..."
    }
  ]
}`;
}
