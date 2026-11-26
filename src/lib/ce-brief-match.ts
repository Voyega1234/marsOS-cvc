// Validator Pack > Brief Match: the pure half (no AI, no DB) so the Content Engine
// settings UI can import the defaults without pulling server code into the browser.
// The AI call lives in ce-brief-check.ts.

export const BRIEF_MATCH_ID = "brief_match";
export const BRIEF_MATCH_NAME = "Brief Match Validator";
export const BRIEF_MATCH_DEFAULT_PROMPT =
  "ตรวจบทความที่เขียนเสร็จแล้วเทียบกับ Master Prompt, Article Brief, Template / โครงสร้างที่กำหนด, ข้อจำกัด และ Comment ลูกค้า ต้องตรงครบทุกข้อ ห้ามหลุด ไม่ตรงให้กลับไปเขียนใหม่จนผ่าน";

export interface BriefMatchConfig {
  enabled: boolean;
  /** The validator's own instruction text — the team can edit it in the Validator Pack. */
  criteria: string;
}

export const BRIEF_MATCH_DEFAULT: BriefMatchConfig = { enabled: true, criteria: BRIEF_MATCH_DEFAULT_PROMPT };

/**
 * Read the Brief Match switch from a Validator Pack row's raw promptText.
 * Default for every project is ON: a pack saved before this validator existed, or a
 * pack written as free text, has no entry for it and therefore runs with the default.
 * Only an explicit `enabled: false` on the stored validator turns it off.
 */
export function readBriefMatchConfig(rawPackText: string | null | undefined): BriefMatchConfig {
  if (!rawPackText) return BRIEF_MATCH_DEFAULT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPackText);
  } catch {
    return BRIEF_MATCH_DEFAULT;
  }
  if (!parsed || typeof parsed !== "object") return BRIEF_MATCH_DEFAULT;
  const validators = (parsed as { validators?: unknown }).validators;
  if (!Array.isArray(validators)) return BRIEF_MATCH_DEFAULT;
  for (const item of validators) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    if (v.id !== BRIEF_MATCH_ID) continue;
    const prompt = typeof v.prompt === "string" ? v.prompt.trim() : "";
    return { enabled: v.enabled !== false, criteria: prompt || BRIEF_MATCH_DEFAULT_PROMPT };
  }
  return BRIEF_MATCH_DEFAULT;
}

/** Which instruction layer a violated rule was found in. */
export type BriefSource = "master" | "brief" | "template" | "restriction";

export const BRIEF_SOURCE_LABEL: Record<BriefSource, string> = {
  master: "Master Prompt",
  brief: "Article Brief",
  template: "Template / โครงสร้าง",
  restriction: "ข้อจำกัด / Comment",
};

export interface BriefLayers {
  masterPrompt: string;
  articleBrief: string;
  /** Restrictions + customer comments, the same text the writer received. */
  restrictions: string;
  /** The writer's task for this article: keyword, structure, template / outline. */
  task: string;
}

export interface RawBriefViolation {
  rule: string;
  quote: string;
  problem: string;
  fix: string;
}

export interface BriefViolation extends RawBriefViolation {
  source: BriefSource;
}

const MAX_VIOLATIONS = 10;
// Shorter than this (for example "ห้าม") appears in nearly every rule, so it proves nothing.
const MIN_RULE_CHARS = 8;
const MIN_QUOTE_CHARS = 4;

// Compare without punctuation or spacing: the model swaps “ ” for " and …. for ...
const NOISE = new RegExp("&[a-z0-9#]+;|[^\\p{L}\\p{N}\\p{M}]+", "gu");

function key(text: string): string {
  return text.toLowerCase().replace(NOISE, "");
}

function articleText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) : clean;
}

export function parseBriefVerdict(raw: string): RawBriefViolation[] {
  const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")) as { violations?: unknown };
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.violations)) return [];
  const out: RawBriefViolation[] = [];
  for (const item of parsed.violations) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    const rule = clip(v.rule, 300);
    if (!rule) continue;
    out.push({ rule, quote: clip(v.quote, 300), problem: clip(v.problem, 300), fix: clip(v.fix, 300) });
  }
  return out;
}

/** The parts of a quoted rule between ellipses — the model shortens long rules with "...". */
function ruleParts(rule: string): string[] {
  return rule
    .split(/\.{3,}|…/)
    .map(key)
    .filter((part) => part.length >= MIN_RULE_CHARS);
}

/**
 * Keep only violations that can be proven from the texts themselves, so a judge that
 * invents a rule or a quote cannot send a correct article back for a paid rewrite:
 * - the rule must appear word for word in one of the instruction layers
 * - a quote, when given, must appear in the article (an empty quote = something missing)
 * The source is taken from where the rule was actually found, never from the judge.
 */
export function verifyBriefViolations(params: {
  violations: RawBriefViolation[];
  layers: BriefLayers;
  html: string;
}): BriefViolation[] {
  const layerKeys: Array<[BriefSource, string]> = [
    ["restriction", key(params.layers.restrictions)],
    ["master", key(params.layers.masterPrompt)],
    ["brief", key(params.layers.articleBrief)],
    ["template", key(params.layers.task)],
  ];
  const article = key(articleText(params.html));
  const seen = new Set<string>();
  const out: BriefViolation[] = [];
  for (const v of params.violations) {
    if (out.length >= MAX_VIOLATIONS) break;
    const parts = ruleParts(v.rule);
    if (!parts.length) continue;
    const found = layerKeys.find(([, text]) => parts.every((part) => text.includes(part)));
    if (!found) continue;
    const quote = key(v.quote);
    if (quote && (quote.length < MIN_QUOTE_CHARS || !article.includes(quote))) continue;
    const id = `${parts.join("|")}::${quote}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ...v, source: found[0] });
  }
  return out;
}

function short(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Lines shown under the article when it is saved without passing. */
export function briefViolationWarnings(violations: BriefViolation[], limit = 5): string[] {
  const lines = violations.slice(0, limit).map((v) => {
    const what = v.problem || (v.quote ? `"${short(v.quote, 80)}"` : "ขาดส่วนที่กำหนด");
    return `ยังไม่ตรง ${BRIEF_SOURCE_LABEL[v.source]}: "${short(v.rule, 90)}" — ${short(what, 120)}`;
  });
  if (violations.length > limit) lines.push(`ยังไม่ตรง Brief อีก ${violations.length - limit} จุด กรุณาตรวจเอง`);
  return lines;
}

/**
 * The message sent back to the writer (after its own draft) asking for a full rewrite.
 * It keeps the original system + task messages in force, so the output format stays the same.
 */
export function buildBriefRevisePrompt(violations: BriefViolation[]): string {
  const list = violations.map((v, i) => {
    const lines = [`${i + 1}. [${BRIEF_SOURCE_LABEL[v.source]}] คำสั่ง: "${v.rule}"`];
    if (v.quote) lines.push(`   ในบทความ: "${v.quote}"`);
    if (v.problem) lines.push(`   ปัญหา: ${v.problem}`);
    if (v.fix) lines.push(`   ต้องแก้: ${v.fix}`);
    return lines.join("\n");
  });
  return [
    "บทความที่เพิ่งเขียนยังไม่ผ่าน Brief Match Validator เพราะยังไม่ตรงคำสั่งในจุดต่อไปนี้",
    "",
    ...list,
    "",
    "เขียนบทความใหม่ทั้งบทความ แก้ให้ครบทุกข้อข้างบน",
    "ทำตาม Master Prompt, Article Brief, โครงสร้างที่กำหนด, ข้อจำกัด และ Comment ทุกข้อเหมือนเดิม คงส่วนที่ถูกต้องอยู่แล้วไว้ ห้ามตัดเนื้อหาให้สั้นลง",
    "ตอบในรูปแบบผลลัพธ์เดิมทุกประการ (รูปแบบเดียวกับคำตอบก่อนหน้า) ภาษาเดียวกับบทความเดิม ห้ามอธิบายสิ่งที่แก้ ห้ามใส่หมายเหตุถึงบรรณาธิการ",
  ].join("\n");
}
