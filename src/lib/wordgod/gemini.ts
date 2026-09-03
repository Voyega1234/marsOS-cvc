/**
 * WordGod AI caller — ตอนนี้วิ่งผ่าน OpenRouter ทั้งหมด (นโยบาย 2026-08-19:
 * AI ทั้งระบบใช้ OpenRouter key เดียว) — model จุดนี้คือกลุ่ม "จุดอื่น ๆ"
 * = OPENROUTER_MODEL_DEFAULT (google/gemini-3.7-flash)
 *
 * คง export signature เดิมทุกตัว (callGemini / callGeminiWithGrounding /
 * session usage) เพื่อไม่ต้องแตะ pipeline และ skill ทั้งหมดที่เรียกใช้
 *
 * หมายเหตุ grounding: Google Search grounding ของ Vertex ถูกแทนด้วย
 * web search plugin ของ OpenRouter — ได้ URL อ้างอิงจริงเหมือนเดิม
 * แต่ไม่มี "hidden search queries" ของ Google ให้เก็บอีก (webSearchQueries
 * จะว่าง — pipeline รองรับกรณีนี้อยู่แล้ว)
 */

import { orChat, OR_MODELS } from '@/lib/openrouter';

const USD_TO_THB = Number(process.env.USD_TO_THB_RATE || 34);

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  cost_thb: number;
}

export interface GeminiCallOptions {
  /** ป้ายบอกว่าเรียกจากฟังก์ชันไหน (ใช้ทำ log/label เท่านั้น) */
  functionLabel?: string;
  labels?: Record<string, string>;
}

let sessionUsage: TokenUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, cost_thb: 0 };

export function resetSessionUsage() {
  sessionUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, cost_thb: 0 };
}

export function getSessionUsage(): TokenUsage {
  return { ...sessionUsage };
}

function trackUsage(inputTokens: number, outputTokens: number, costUsd: number) {
  sessionUsage.input_tokens += inputTokens;
  sessionUsage.output_tokens += outputTokens;
  sessionUsage.total_tokens += inputTokens + outputTokens;
  sessionUsage.cost_usd += costUsd;
  sessionUsage.cost_thb += costUsd * USD_TO_THB;
}

const CALL_TIMEOUT_MS = 180_000;
const MAX_RETRIES = 2;

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      // 4xx ที่ไม่ใช่ rate limit — retry ไปก็พังเหมือนเดิม
      if (/OpenRouter 4(?!29)/.test(msg)) throw err;
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
    }
  }
  throw lastError;
}

function parseJSON(text: string): any {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned); } catch { /* ลองแกะก้อน JSON */ }
  const start = Math.min(...['{', '['].map(c => {
    const i = cleaned.indexOf(c);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  }));
  if (!Number.isFinite(start)) throw new Error(`AI response is not JSON: ${cleaned.slice(0, 160)}`);
  const opener = cleaned[start];
  const closer = opener === '{' ? '}' : ']';
  const end = cleaned.lastIndexOf(closer);
  if (end <= start) throw new Error(`AI response is not JSON: ${cleaned.slice(0, 160)}`);
  return JSON.parse(cleaned.slice(start, end + 1));
}

export interface GroundingMetadata {
  webSearchQueries: string[];
  sourceUrls: string[];
  sourceTitles: string[];
}

export interface GroundedResult {
  data: any;
  grounding: GroundingMetadata;
}

async function generateOpenRouterText(prompt: string, useWebSearch = false, options: GeminiCallOptions = {}, jsonMode = false, stage = '') {
  // SOP §3: ป้ายชื่อฟังก์ชันมาจาก functionLabel ที่ผู้เรียกส่งมา (มีอยู่แล้วเดิม)
  const label = (options.functionLabel || '').trim() || 'wordgod_call'
  try {
    const result = await orChat({
      trace: stage ? `${label}_${stage}` : label,
      prompt,
      model: OR_MODELS.default(),
      webSearch: useWebSearch,
      jsonMode,
      timeoutMs: CALL_TIMEOUT_MS,
    });
    trackUsage(result.usage.inputTokens, result.usage.outputTokens, result.usage.costUsd);
    return result;
  } catch (err) {
    // call ที่ล้มกลางทางก็เสียเงินค่า input แล้ว — ถ้ามี usage แนบมาให้นับเข้าต้นทุนด้วย
    // ไม่งั้นตัวเลขต้นทุนที่รายงานจะต่ำกว่าจริงทุกครั้งที่มี retry
    const u = (err as { usage?: { inputTokens: number; outputTokens: number; costUsd: number } }).usage;
    if (u) trackUsage(u.inputTokens, u.outputTokens, u.costUsd);
    throw err;
  }
}

// แยก JSON schema ออกจาก prompt วิจัย เพื่อให้โมเดลตั้งใจค้นเว็บก่อนค่อย format
function splitResearchPrompt(prompt: string): { researchPrompt: string; jsonSchema: string } {
  const jsonStart = prompt.search(/\{[\s\S]*"(?:keywords|problems)":/);
  if (jsonStart === -1) return { researchPrompt: prompt, jsonSchema: '' };
  const beforeJson = prompt.substring(0, jsonStart);
  const lastRealLine = beforeJson.lastIndexOf('\n', beforeJson.trimEnd().length - 1);
  const instructions = beforeJson.substring(0, lastRealLine).trimEnd();
  const schema = prompt.substring(jsonStart).trim();
  const researchPrompt = instructions +
    '\n\nUse web search to research this topic. Report all findings as plain text — real keywords, problems, data, patterns you find.';
  return { researchPrompt, jsonSchema: schema };
}

export async function callGeminiWithGrounding(prompt: string): Promise<any>;
export async function callGeminiWithGrounding(prompt: string, returnGrounding: false, options?: GeminiCallOptions): Promise<any>;
export async function callGeminiWithGrounding(prompt: string, returnGrounding: true, options?: GeminiCallOptions): Promise<GroundedResult>;
export async function callGeminiWithGrounding(prompt: string, returnGrounding?: boolean, options: GeminiCallOptions = {}): Promise<any> {
  if (!returnGrounding) {
    return withRetry(async () => {
      // ใช้ web search — jsonMode ร่วมด้วยไม่ได้ (orChat จะตัดทิ้งอยู่แล้ว) จึงพึ่ง parseJSON + retry ตามเดิม
      const result = await generateOpenRouterText(prompt, true, options, false);
      return parseJSON(result.text);
    });
  }

  const { researchPrompt, jsonSchema } = splitResearchPrompt(prompt);

  const researchResult = await withRetry(() => generateOpenRouterText(researchPrompt, true, options, false, 'research'));
  const researchText = researchResult.text;
  const grounding: GroundingMetadata = {
    webSearchQueries: [], // OpenRouter ไม่เปิดเผย search query ภายในของโมเดล
    sourceUrls: researchResult.citations.map(c => c.url),
    sourceTitles: researchResult.citations.map(c => c.title),
  };

  let data: any;
  if (jsonSchema) {
    const formatPrompt = `Based on this research:\n\n${researchText}\n\nReturn ONLY valid JSON matching this schema (no markdown):\n${jsonSchema}`;
    data = await withRetry(async () => {
      const formatResult = await generateOpenRouterText(formatPrompt, false, options, true, 'format');
      return parseJSON(formatResult.text);
    });
  } else {
    data = parseJSON(researchText);
  }

  return { data, grounding };
}

export async function callGemini(prompt: string, options: GeminiCallOptions = {}) {
  return withRetry(async () => {
    const result = await generateOpenRouterText(prompt, false, options, true);
    return parseJSON(result.text);
  });
}
