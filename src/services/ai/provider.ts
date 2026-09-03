import { orChat, OR_MODELS } from "@/lib/openrouter";

export interface AIProviderOptions {
  provider: "CLAUDE" | "OPENAI" | "GEMINI" | "CUSTOM";
  model: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  /** SOP §3: ชื่อฟังก์ชันที่เรียก — ปกติคือ jobType ของ AIJob */
  trace?: string;
}

export interface AIProviderResult {
  content: string;
  tokensUsed: number;
  estimatedCost: number;
}

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Legacy AI runner — ตอนนี้ทุก provider วิ่งผ่าน OpenRouter (นโยบาย 2026-08-19)
 * จุดนี้อยู่กลุ่ม "จุดอื่น ๆ" = MODEL_DEFAULT (gemini-3.7-flash) เสมอ
 * ไม่ว่าค่า provider/model เดิมใน PromptTemplate จะเป็นอะไร
 */
export async function callAIProvider(opts: AIProviderOptions): Promise<AIProviderResult> {
  const { prompt, temperature = 0.7, maxTokens = 4000, trace = "ai_job" } = opts;

  if (process.env.OPENROUTER_API_KEY) {
    const msg = await orChat({
      trace,
      model: OR_MODELS.default(),
      maxTokens,
      temperature,
      messages: [{ role: "user", content: prompt }],
    });
    return {
      content: msg.text,
      tokensUsed: msg.usage.totalTokens,
      estimatedCost: msg.usage.costUsd,
    };
  }

  // ── Fallback: mock (no API key configured) ────────────────────────────────
  await delay(800 + Math.random() * 800);
  const tokensUsed = Math.floor(prompt.length / 4) + Math.floor(Math.random() * 500);
  return { content: "__MOCK__", tokensUsed, estimatedCost: 0 };
}
