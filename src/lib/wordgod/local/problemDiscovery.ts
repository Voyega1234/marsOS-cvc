/**
 * WordGod Local SME — Problem Discovery (topic universe → ปัญหาลูกค้า → seed)
 *
 * พอร์ตวิธีของโหมด "ไม่มีหน้าร้าน" (keywords/route.ts::runProblemDiscovery) เข้ามา
 * แต่ยิง LLM ผ่าน OpenRouter (callGeminiWithGrounding ของ local) ไม่แตะ Vertex
 *
 * โฟกัส Location แบบไม่ทำให้คำซ้ำ: ส่งพื้นที่เป็น "บริบทธุรกิจ" เท่านั้น และสั่ง
 * ห้ามเติมชื่อเขต/อำเภอต่อท้ายทุกคีย์เวิร์ด — การผูกทำเลทำโดย seed generation
 * เชิงกำหนด (deterministic) อยู่แล้ว คำจากขั้นนี้จึงเป็นคำปัญหา/วิธี/ความรู้
 * ระดับประเทศ ที่ไปเป็น "ครึ่ง traffic / บทความ" ของผลลัพธ์
 */
import type { DiscoveredProblem } from '@/lib/skills/problemFirstSkill';
import type { LocalArea, LocalLanguage } from './types';

export interface LocalProblemDiscoveryInput {
  services: string[];
  primaryLocation: LocalArea;
  nearbyLocations: LocalArea[];
  businessContext?: string;
  language: LocalLanguage;
}

export interface LocalProblemDiscoveryDeps {
  /** ต้องเป็นตัวที่คืน grounding (callGeminiWithGrounding(prompt, true) ของ local) */
  callGeminiWithGrounding: (
    prompt: string
  ) => Promise<{ data: any; grounding: { webSearchQueries: string[]; sourceUrls: string[] } }>;
}

export interface LocalProblemDiscoveryResult {
  problems: DiscoveredProblem[];
  groundingUrls: string[];
}

/**
 * ค้นหา "ปัญหาจริง" ที่ลูกค้าในไทยเจอกับบริการนี้ แล้วคืน seed keyword ต่อปัญหา
 * (ใช้ web search grounding — ถ้าล้มเหลวคืน [] เพื่อไม่ให้ทั้ง pipeline พัง)
 */
export async function runLocalProblemDiscovery(
  input: LocalProblemDiscoveryInput,
  deps: LocalProblemDiscoveryDeps
): Promise<LocalProblemDiscoveryResult> {
  const niche = input.services.join(' / ');
  const areaLine = input.nearbyLocations.length
    ? `${input.primaryLocation.name} และพื้นที่ใกล้เคียง (${input.nearbyLocations.map(a => a.name).join(', ')})`
    : input.primaryLocation.name;
  const businessContext =
    input.businessContext?.trim() ||
    `ธุรกิจบริการ: ${input.services.join(', ')} — ให้บริการพื้นที่ ${areaLine}`;

  const researchPrompt = `You are a customer research expert for SEO keyword strategy of a LOCAL service business in Thailand.

Business context: ${businessContext}
Services (niche): ${niche}
Service area: ${areaLine}

IMPORTANT — DISCOVERY MODE:
Use web search to find REAL Thai customer questions, complaints, worries, and confusion about these services.
Search Thai-language forums (Pantip, Reddit Thailand), reviews, Q&A, Facebook groups related to "${niche}".
Find REAL problems Thai customers face — not generic marketing statements.

CRITICAL LOCATION RULE:
- DO NOT append a district/area name (เช่น "${input.primaryLocation.name}") to every keyword.
- The area targeting is already handled by the system with location keywords.
- Here, generate NATIONAL problem/how-to/knowledge keywords that pull traffic and become blog articles
  (เช่น "แอร์ไม่เย็นเกิดจากอะไร", "ล้างแอร์เองได้ไหม", "ควรล้างแอร์บ่อยแค่ไหน").

WHAT COUNTS AS A "PROBLEM" (be broad — include all):
- Confusion before hiring/buying: not knowing which option/provider to choose
- Fear of wrong choice: worried about wasting money, being overcharged, or damage
- Comparison anxiety: overwhelmed by too many choices
- Technical difficulty / symptoms: things not working, error symptoms, when to call a pro
- Post-service doubt: wondering if the job was done right
- General knowledge gaps: lacking background to make an informed decision

Journey stages: pre_purchase, during_use, result_interpretation, post_purchase, general_education

REQUIREMENTS:
- Return MINIMUM 5 problems, up to 10
- At least 2 problems must have urgency_score >= 7
- Problems must be specific, not vague marketing statements
- Write problem_statement in natural Thai that a real customer would express
- If specific data unavailable, generate realistic problems Thai customers commonly face for these services
- Generate 3–5 Thai keyword seeds per problem (NATIONAL phrasing, no district suffix)

Use web search first to find real Thai customer problems, then return your findings as JSON only (no markdown):
{
  "problems": [
    {
      "problem_statement": "...",
      "journey_stage": "pre_purchase",
      "problem_group": "buying_decision",
      "urgency_score": 8,
      "keywords_to_expand": ["keyword1", "keyword2", "keyword3"]
    }
  ]
}`;

  try {
    const { data, grounding } = await deps.callGeminiWithGrounding(researchPrompt);
    const problems: DiscoveredProblem[] = (data?.problems ?? []).filter(
      (p: any) => p?.problem_statement && Array.isArray(p?.keywords_to_expand) && p.keywords_to_expand.length > 0
    );
    return { problems, groundingUrls: grounding?.sourceUrls ?? [] };
  } catch {
    return { problems: [], groundingUrls: [] };
  }
}
