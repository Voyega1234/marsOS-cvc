// Validator Pack > Brief Match: judge a finished article against the instructions it was
// written from (Master Prompt, Article Brief, template / structure, restrictions, comments).
// The judge only reports; the caller decides whether to send the writer back for a rewrite.
// A failed check never fails the write — it comes back as status "error".
import { OR_MODELS, orChat, type ORUsage } from "@/lib/openrouter";
import {
  BRIEF_JUDGE_SYSTEM_PROMPT,
  BRIEF_SYSTEM_HANDLED,
  parseBriefVerdict,
  verifyBriefViolations,
  type BriefLayers,
  type BriefViolation,
} from "@/lib/ce-brief-match";

const MAX_LAYER_CHARS = 60_000;
const MAX_ARTICLE_CHARS = 80_000;
const MAX_TOKENS = 4_000;
const DEFAULT_TIMEOUT_MS = 90_000;

export interface BriefCheckResult {
  /** pass = nothing provable found · fail = verified violations · error = the check itself failed */
  status: "pass" | "fail" | "error";
  violations: BriefViolation[];
  costUsd: number;
  tokens: number;
}

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[ตัดส่วนที่เหลือออกเพราะยาวเกิน]` : text;
}

export function buildBriefCheckUserMessage(params: {
  criteria: string;
  layers: BriefLayers;
  html: string;
  systemHandled: string[];
}): string {
  const { layers } = params;
  return [
    `# เกณฑ์ของ Validator\n${params.criteria}`,
    `# Master Prompt\n${cap(layers.masterPrompt, MAX_LAYER_CHARS)}`,
    `# Article Brief\n${cap(layers.articleBrief, MAX_LAYER_CHARS)}`,
    `# ข้อจำกัด และ Comment ลูกค้า\n${layers.restrictions.trim() ? cap(layers.restrictions, MAX_LAYER_CHARS) : "(ไม่มี)"}`,
    `# โจทย์และโครงสร้างของบทความนี้ (template / outline)\n${cap(layers.task, MAX_LAYER_CHARS)}`,
    `# ระบบทำให้เองหลังเขียน ไม่ต้องตรวจ\n${params.systemHandled.map((line) => `- ${line}`).join("\n")}`,
    `# บทความที่ต้องตรวจ (HTML)\n${cap(params.html, MAX_ARTICLE_CHARS)}`,
  ].join("\n\n");
}

export { BRIEF_SYSTEM_HANDLED };

export async function checkAgainstBrief(params: {
  criteria: string;
  layers: BriefLayers;
  html: string;
  /** Extra items the caller's pipeline fixes by itself after this check. */
  systemHandled?: string[];
  trace: string;
  client?: string;
  timeoutMs?: number;
  chat?: typeof orChat;
}): Promise<BriefCheckResult> {
  let usage: ORUsage | undefined;
  try {
    const res = await (params.chat ?? orChat)({
      trace: params.trace,
      client: params.client,
      model: OR_MODELS.default(),
      jsonMode: true,
      temperature: 0,
      maxTokens: MAX_TOKENS,
      timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      messages: [
        { role: "system", content: BRIEF_JUDGE_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildBriefCheckUserMessage({
            criteria: params.criteria,
            layers: params.layers,
            html: params.html,
            systemHandled: [...BRIEF_SYSTEM_HANDLED, ...(params.systemHandled ?? [])],
          }),
        },
      ],
    });
    usage = res.usage;
    const violations = verifyBriefViolations({
      violations: parseBriefVerdict(res.text),
      layers: params.layers,
      html: params.html,
    });
    return {
      status: violations.length ? "fail" : "pass",
      violations,
      costUsd: usage?.costUsd ?? 0,
      tokens: usage?.totalTokens ?? 0,
    };
  } catch (e) {
    console.warn(`[brief-check] failed (${params.trace}):`, e instanceof Error ? e.message : e);
    const failed = usage ?? (e as Error & { usage?: ORUsage }).usage;
    return { status: "error", violations: [], costUsd: failed?.costUsd ?? 0, tokens: failed?.totalTokens ?? 0 };
  }
}
