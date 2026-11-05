// Run Test ของ Content Engine — ประกอบ prompt ด้วยฟังก์ชันเดียวกับตอนเขียนจริง แล้วรายงานว่าอะไรถูกส่งบ้าง
// ฟังก์ชันล้วน: ไม่เรียก AI ไม่แตะ DB (ตัวโหลดข้อมูลอยู่ที่ ce-writer-dry-run-server.ts)

import { articleIntentSkillBlock } from "@/lib/article-intent-skill";
import { humanVoiceSkillBlock } from "@/lib/article-human-voice-skill";
import { articleStructureSkillBlock, type ArticleStructureOptions } from "@/lib/article-structure";
import { activeComments, CLIENT_COMMENT_BUDGET, type ClientCommentsContext } from "@/lib/ce-client-comments";
import {
  approvedTermList,
  bannedTermsOf,
  cleanPlainText,
  cleanSlug,
  filesToChunks,
  hitWarnings,
  keywordWarnings,
  usableResearch,
  type RestrictionFile,
  type RestrictionsContext,
} from "@/lib/ce-restrictions";
import { isTemplateBusinessSkillName } from "@/lib/ce-layer-status";
import type { ResolvedCE, ResolvedLayer } from "@/lib/content-engine-resolve";
import type { UploadKeyword, UploadLinkPair } from "@/lib/upload-article/types";
import {
  buildWriterSystemPrompt,
  buildWriterUserPrompt,
  composeWriterConstraints,
  missingWriterLayers,
  WRITER_NOTE_MAX,
} from "@/lib/upload-article/writer";

/** upload = Upload Article / PBN · seo = โปรเจกต์ SEO / Content Studio (ตัวห่อ prompt คนละแบบ) */
export type DryRunTarget = "upload" | "seo";

/** sent = อยู่ใน prompt จริง · missing = บังคับแต่ไม่มี · off = ไม่ได้ใช้ · later = ใช้ในขั้นอื่น */
export type DryRunState = "sent" | "missing" | "off" | "later";

export interface DryRunLayer {
  key: string;
  label: string;
  state: DryRunState;
  required: boolean;
  source: string | null;
  chars: number;
  details: string[];
  text: string;
}

export interface DryRunFileReport {
  id: string;
  name: string;
  kind: string;
  layer: "ข้อจำกัด" | "Comment";
  totalChars: number;
  sentChars: number;
  status: "whole" | "partial" | "none";
  reason: string;
}

export interface DryRunStep {
  title: string;
  detail: string;
  /** no = ไม่ใช้ AI · yes = ใช้ AI ทุกครั้ง · maybe = ใช้เมื่อจำเป็น */
  ai: "no" | "yes" | "maybe";
  /** ขั้นนี้ Run Test ทำจริงหรือไม่ */
  inTest: boolean;
}

export interface DryRunWarning {
  level: "error" | "warn" | "info";
  text: string;
}

export interface WriterDryRun {
  target: DryRunTarget;
  /** true = prompt ตรงตัวอักษรกับตอนเขียนจริง · false = โครงย่อ เพราะตัวจริงมีข้อมูลเว็บ/CTA เพิ่ม */
  promptExact: boolean;
  canWrite: boolean;
  missing: string[];
  task: { keyword: string; title: string; slug: string; language: string | null; model: string | null };
  layers: DryRunLayer[];
  files: DryRunFileReport[];
  warnings: DryRunWarning[];
  steps: DryRunStep[];
  systemPrompt: string;
  userPrompt: string;
}

export interface WriterDryRunInput {
  target: DryRunTarget;
  ce: Pick<ResolvedCE, "businessSkill" | "masterPrompt" | "articleBrief" | "validatorPack" | "imagePrompt" | "missing">;
  restrictions: RestrictionsContext | null;
  clientComments: ClientCommentsContext | null;
  keyword: UploadKeyword;
  links?: UploadLinkPair[];
  language?: "th" | "en";
  brandNames?: string[];
  model?: string | null;
  /** โหลดพังตอนเขียนจริงจะเงียบ — Run Test ต้องบอก */
  loadErrors?: { restrictions?: string; comments?: string };
  /** จำนวนไฟล์ที่อัปไว้ทั้งหมดของ scope แม้ layer จะปิดอยู่ */
  uploadedFiles?: { restrictions: number; comments: number };
  /** PBN: ตอนเขียนจริงเพิ่มมุมเล่าตามเวอร์ชัน */
  pbn?: boolean;
  /** โครงบทความตามเว็บของลูกค้า — ไม่ส่ง = กฎเริ่มต้น */
  structure?: ArticleStructureOptions;
}

const PLACEHOLDER_RE = /\{\{\s*[\w.-]+\s*\}\}/g;

const MIN_PREFIX_MATCH = 20;

/** ความยาวต้นข้อความที่อยู่ใน block — clip ตัดจากท้ายเสมอ จึงค้นแบบ binary ได้ */
export function sentPrefixLength(text: string, block: string): number {
  const t = text.trim();
  if (!t || !block) return 0;
  if (block.includes(t)) return t.length;
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (block.includes(t.slice(0, mid))) lo = mid;
    else hi = mid - 1;
  }
  // ต้นข้อความสั้น ๆ บังเอิญซ้ำกับข้อความอื่นได้ — ไม่นับว่าส่ง
  return lo < MIN_PREFIX_MATCH ? 0 : lo;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** บรรทัดในหัวข้อย่อยของ block — ใช้นับงานวิจัยที่ถูกเลือกส่ง */
function sectionLineCount(block: string, heading: string): number {
  const start = block.indexOf(heading);
  if (start < 0) return 0;
  const bodyStart = block.indexOf("\n", start);
  if (bodyStart < 0) return 0;
  const end = block.indexOf("\n\n", bodyStart + 1);
  return block.slice(bodyStart + 1, end < 0 ? undefined : end).split("\n").filter(Boolean).length;
}

/** สินค้าที่ block นี้ส่งรายละเอียดมา = มีหัว #### ชื่อสินค้า */
function matchedProductNames(ctx: RestrictionsContext, block: string): Set<string> {
  return new Set(ctx.data.productRules.filter((p) => p.enabled && p.product.trim() && block.includes(`#### ${p.product}\n`)).map((p) => p.product));
}

function reportFile(
  file: RestrictionFile,
  layer: DryRunFileReport["layer"],
  block: string,
  noneReason: string,
  partialReason: string,
): DryRunFileReport {
  const total = file.text.trim().length;
  let sent: number;
  let whole: boolean;
  if (file.meta.kind === "criticized") {
    // ตัวอย่างที่ลูกค้าติไม่มีป้ายชื่อไฟล์ และถูกตัดจากท้าย
    sent = sentPrefixLength(file.text, block);
    whole = sent >= total;
  } else if (!block.includes(`[${file.name}]`)) {
    sent = 0;
    whole = false;
  } else {
    const chunks = filesToChunks([file]);
    const hit = chunks.filter((c) => block.includes(c.text));
    sent = hit.reduce((sum, c) => sum + c.text.length, 0);
    whole = chunks.length > 0 && hit.length === chunks.length;
  }
  return {
    id: file.id,
    name: file.name,
    kind: file.meta.kind,
    layer,
    totalChars: total,
    sentChars: sent,
    status: sent === 0 ? "none" : whole ? "whole" : "partial",
    reason: sent === 0 ? noneReason : whole ? "ส่งครบทั้งไฟล์" : partialReason,
  };
}

function restrictionFileReports(ctx: RestrictionsContext | null, block: string): DryRunFileReport[] {
  if (!ctx) return [];
  const matched = matchedProductNames(ctx, block);
  return ctx.files.map((f) => {
    const owners = ctx.data.productRules.filter((p) => p.enabled && p.product.trim() && p.fileIds.includes(f.id));
    const otherOwners = owners.filter((p) => !matched.has(p.product));
    const linkedElsewhere = owners.length > 0 && otherOwners.length === owners.length;
    const none = linkedElsewhere
      ? `ผูกกับสินค้า ${otherOwners.map((p) => p.product).join(", ")} ที่ไม่ตรงหัวข้อนี้ (ตอนเขียนจริงจะส่งถ้า Gemini ตัดสินว่าเกี่ยว)`
      : f.meta.kind === "criticized"
        ? "ไม่ถูกส่ง"
        : "ไม่มีส่วนไหนตรงกับ keyword / title / note ของบทความนี้ จึงไม่ส่งเลย";
    const partial = f.meta.kind === "criticized" ? "ตัดตามงบตัวอย่างที่ลูกค้าติ" : "ส่งเฉพาะส่วนที่ตรงหัวข้อ ตามงบตัวอักษร";
    return reportFile(f, "ข้อจำกัด", block, none, partial);
  });
}

function commentFileReports(ctx: ClientCommentsContext | null, block: string): DryRunFileReport[] {
  if (!ctx) return [];
  return ctx.files.map((f) =>
    reportFile(f, "Comment", block, "เกินงบ Comment จึงไม่ถูกส่ง", `ไฟล์ยาว ส่งเฉพาะส่วนที่ตรงหัวข้อหรือจากต้นไฟล์ (งบรวม ${fmt(CLIENT_COMMENT_BUDGET.files)} ตัวอักษร)`),
  );
}

function restrictionDetails(ctx: RestrictionsContext | null, block: string): string[] {
  if (!ctx) return [];
  const d = ctx.data;
  const out: string[] = [];
  const terms = bannedTermsOf(d);
  if (terms.length) {
    const sent = terms.filter((t) => block.includes(`- "${t.term}"`)).length;
    out.push(`คำต้องห้าม: ส่ง ${fmt(sent)}/${fmt(terms.length)} คำ${sent < terms.length ? " (เกินงบใน prompt แต่ยังถูกตรวจทุกคำหลังเขียน)" : ""}${d.strictMode ? " · โหมดเข้มงวด" : ""}`);
  }
  const approved = approvedTermList(d);
  if (approved.length) out.push(`ถ้อยคำที่อนุมัติ: ส่ง ${fmt(approved.filter((a) => block.includes(a)).length)}/${fmt(approved.length)} รายการ`);
  if (d.rules.trim()) out.push(`กฎ: ส่ง ${fmt(sentPrefixLength(d.rules, block))}/${fmt(d.rules.trim().length)} ตัวอักษร`);
  const enabled = d.productRules.filter((p) => p.enabled && p.product.trim());
  const matched = matchedProductNames(ctx, block);
  for (const p of enabled.filter((x) => matched.has(x.product))) {
    out.push(`สินค้า "${p.product}": ส่งข้อมูล ${fmt(sentPrefixLength(p.info, block))}/${fmt(p.info.trim().length)} ตัวอักษร`);
  }
  const others = enabled.filter((x) => !matched.has(x.product));
  if (others.length) out.push(`สินค้าที่ไม่ตรงหัวข้อ ส่งแค่ชื่อ: ${others.map((p) => p.product).join(", ")}`);
  const research = usableResearch(d);
  if (research.length) out.push(`งานวิจัย: ส่ง ${fmt(sectionLineCount(block, "### งานวิจัยที่อนุญาตให้อ้างอิง"))}/${fmt(research.length)} รายการ`);
  if (d.criticizedSamples.trim()) out.push(`ตัวอย่างที่ลูกค้าติ: ส่ง ${fmt(sentPrefixLength(d.criticizedSamples, block))}/${fmt(d.criticizedSamples.trim().length)} ตัวอักษร`);
  return out;
}

function commentDetails(ctx: ClientCommentsContext | null, block: string): string[] {
  if (!ctx) return [];
  const active = activeComments(ctx.data);
  const out: string[] = [];
  if (active.length) {
    const sent = active.filter((c) => block.includes(c.text.trim())).length;
    out.push(`Comment: ส่ง ${fmt(sent)}/${fmt(active.length)} ข้อ${sent < active.length ? ` (เกินงบ ${fmt(CLIENT_COMMENT_BUDGET.text)} ตัวอักษร เก็บข้อใหม่ก่อน)` : ""}`);
  }
  out.push("ไม่มีรอบตรวจหลังเขียน: ต้องอาศัยให้ AI ทำตามเอง");
  return out;
}

/** โครงบทความที่ได้จากการสแกนเว็บ — แสดงให้ทีมเห็นว่าตัวเขียนได้กฎอะไร */
function structureDetails(s: ArticleStructureOptions | undefined): string[] {
  if (!s) return ["ใช้กฎเริ่มต้นของระบบ"];
  return [
    "ใช้โครงตามเว็บของลูกค้า",
    s.takeaways === false ? "ไม่มีกล่องสรุปประเด็นสำคัญ" : "มีกล่องสรุปประเด็นสำคัญ",
    s.faqPlain ? "FAQ เป็นหัวข้อกับย่อหน้า เปิดตลอด" : "FAQ ตามแบบของระบบ",
    ...(s.conclusionBeforeFaq ? ["บทสรุปมาก่อน FAQ"] : []),
    ...(s.references ? [`ส่วนอ้างอิง เลือกจาก ${s.library?.length ?? 0} แหล่งในรายการ`] : []),
  ];
}

function missingLayersOf(input: WriterDryRunInput): string[] {
  if (input.target === "upload") return missingWriterLayers(input.ce);
  // SEO ไม่เริ่มเขียนถ้าไม่มี Image Prompt เพราะรูปอยู่ใน request เดียวกัน
  const missing = [...input.ce.missing];
  if (!input.ce.imagePrompt?.text.trim() && !missing.includes("Image Prompt")) missing.push("Image Prompt");
  return missing;
}

function uploadSteps(model: string | null): DryRunStep[] {
  return [
    { title: "เช็ค Layer บังคับ", detail: "ต้องมี Business Skill, Master Prompt, Article Brief, Validator Pack ครบ ขาดตัวเดียวหยุดทันที ไม่เสียเงิน", ai: "no", inTest: true },
    { title: "โหลดข้อจำกัด + Comment", detail: "ใช้ scope เดียวกับ layer อื่น ไม่ดึงข้ามลูกค้า สถานะ Draft หรือยังไม่บันทึก = ปิด และไฟล์ของ layer นั้นไม่ถูกส่ง", ai: "no", inTest: true },
    { title: "ล้าง title / slug", detail: "แทนคำต้องห้ามที่มีคำแทน ที่เหลือเตือน ส่วน keyword หลักไม่แก้ แค่เตือน", ai: "no", inTest: true },
    { title: "เลือก Internal Link", detail: "จัดอันดับตามคำที่ตรงหัวข้อบทความ", ai: "no", inTest: true },
    { title: "เลือกข้อมูลสินค้าและไฟล์", detail: "จับคู่สินค้าด้วยคำตรงก่อน แล้วให้ Gemini ตัดสินสินค้าที่เหลือ ไฟล์ส่งเฉพาะส่วนที่ตรงหัวข้อ Run Test ข้ามส่วน Gemini จึงใช้คำตรงอย่างเดียว", ai: "yes", inTest: true },
    { title: "ประกอบ prompt", detail: "system = Master → Business Skill → Brief → ข้อจำกัด + Comment → Validator · user = งาน, keyword, note, Intent, Human Voice, Structure, Internal Link, รูปแบบผลลัพธ์", ai: "no", inTest: true },
    { title: "ค้นแหล่งอ้างอิงจากเว็บ", detail: "ก่อนเขียน ค้นเฉพาะโดเมนที่เว็บนี้เคยอ้างอิง แล้วส่งชื่อเรื่องกับข้อความจริงให้ตัวเขียน ทำเฉพาะเว็บที่สแกนแล้วเปิดส่วนอ้างอิงและมีรายการแหล่ง ค้นไม่เจอใช้เฉพาะแหล่งที่สแกนไว้ Run Test ไม่ค้นจริง", ai: "maybe", inTest: false },
    { title: "AI เขียนบทความ", detail: `เรียก ${model ?? "โมเดลเขียน"} ครั้งเดียวจาก prompt ด้านบน สูงสุด 20,000 tokens`, ai: "yes", inTest: false },
    { title: "เขียนต่อถ้าถูกตัด", detail: "สูงสุด 2 รอบ ยังไม่จบ = ล้มเหลว ไม่บันทึกบทความครึ่งเดียว", ai: "maybe", inTest: false },
    { title: "ล้าง HTML", detail: "ตัด markup แปลกปลอมและข้อความตรวจทานภายในที่หลุดเข้าบทความ เหลือสั้นเกิน = ล้มเหลว", ai: "no", inTest: false },
    { title: "เติม FAQ", detail: "มีน้อยกว่า 2 ข้อ เรียก AI เติม สูงสุด 2 ครั้ง", ai: "maybe", inTest: false },
    { title: "ตรวจคำต้องห้ามหลังเขียน", detail: "เช็คทุกคำในรายการ แทนคำที่มีคำแทน ให้ AI แก้ประโยคที่เหลือ (สูงสุด 40 จุด และต้องเหลือเวลา) แก้ไม่หมด = เตือน ไม่ทำให้งานล้ม", ai: "maybe", inTest: false },
    { title: "ตรวจกับ Comment หลังเขียน", detail: "ให้ AI อ่านบทความเทียบกับ Comment ลูกค้า แก้เฉพาะท่อนที่ขัด ถ้าขัดกับข้อจำกัดให้ยึดข้อจำกัด แก้ไม่ได้ = เตือน ไม่มี Comment = ไม่เรียก AI", ai: "maybe", inTest: false },
    { title: "ประกอบและบันทึก", detail: "ใส่ CTA ถ้าติ๊ก, ประกอบ HTML, บันทึกสถานะ GENERATED", ai: "no", inTest: false },
    { title: "สร้างรูป (ถ้าติ๊ก)", detail: "งานแยกหลังเขียนเสร็จ ใช้ Image Prompt ไม่ได้ใช้ตอนเขียนเนื้อหา", ai: "yes", inTest: false },
  ];
}

function seoSteps(model: string | null): DryRunStep[] {
  return [
    { title: "เช็ค Layer บังคับ", detail: "ต้องมี Business Skill, Master Prompt, Article Brief, Validator Pack, Image Prompt ครบ ขาดตัวเดียวหยุดทันที ไม่เสียเงิน", ai: "no", inTest: true },
    { title: "โหลดข้อจำกัด + Comment", detail: "ใช้ scope เดียวกับ layer อื่น ไม่ดึงข้ามโปรเจกต์ สถานะ Draft หรือยังไม่บันทึก = ปิด", ai: "no", inTest: true },
    { title: "ล้าง title", detail: "แทนคำต้องห้ามที่มีคำแทน ส่วน keyword หลักไม่แก้ แค่เตือน", ai: "no", inTest: true },
    { title: "เลือกข้อมูลสินค้าและไฟล์", detail: "จับคู่สินค้าด้วยคำตรงก่อน แล้วให้ Gemini ตัดสินสินค้าที่เหลือ Run Test ข้ามส่วน Gemini จึงใช้คำตรงอย่างเดียว", ai: "yes", inTest: true },
    { title: "ประกอบ prompt", detail: "LAYER 1 Business Skill → LAYER 2 Master → LAYER 3 Brief → ข้อจำกัด + Comment → LAYER 4 Validator + Intent, Human Voice, Structure ตอนเขียนจริงมีข้อมูลเว็บ CTA ตัวอย่างบทความ และผู้เขียนเพิ่ม", ai: "no", inTest: true },
    { title: "ค้นแหล่งอ้างอิงจากเว็บ", detail: "ก่อนเขียน ค้นเฉพาะโดเมนที่เว็บนี้เคยอ้างอิง แล้วส่งชื่อเรื่องกับข้อความจริงให้ตัวเขียน ทำเฉพาะเว็บที่สแกนแล้วเปิดส่วนอ้างอิงและมีรายการแหล่ง ค้นไม่เจอใช้เฉพาะแหล่งที่สแกนไว้ Run Test ไม่ค้นจริง", ai: "maybe", inTest: false },
    { title: "AI เขียนบทความ", detail: `เรียก ${model ?? "โมเดลเขียน"} ครั้งเดียว สูงสุด 20,000 tokens`, ai: "yes", inTest: false },
    { title: "ล้าง HTML", detail: "ตัด markup และข้อความตรวจทานภายใน จัด FAQ กับกล่องสรุป เนื้อหาสั้นผิดปกติ = ล้มเหลว", ai: "no", inTest: false },
    { title: "ตรวจคำต้องห้ามหลังเขียน", detail: "เช็คทุกคำในรายการ แทนคำ ให้ AI แก้ประโยคที่เหลือ แก้ไม่หมด = เตือน", ai: "maybe", inTest: false },
    { title: "ตรวจกับ Comment หลังเขียน", detail: "ให้ AI อ่านบทความเทียบกับ Comment ลูกค้า แก้เฉพาะท่อนที่ขัด ถ้าขัดกับข้อจำกัดให้ยึดข้อจำกัด แก้ไม่ได้ = เตือน ไม่มี Comment = ไม่เรียก AI", ai: "maybe", inTest: false },
    { title: "สร้างรูปและบันทึก", detail: "ใช้ Image Prompt สร้างปกและรูปประกอบใน request เดียวกัน แล้วบันทึกบทความ", ai: "yes", inTest: false },
  ];
}

function layerFromCe(key: string, label: string, layer: ResolvedLayer | null, inPrompt: (t: string) => boolean): DryRunLayer {
  const text = layer?.text ?? "";
  return {
    key,
    label,
    required: true,
    state: layer && text.trim() && inPrompt(text) ? "sent" : "missing",
    source: layer ? `${layer.name} (v${layer.version})` : null,
    chars: text.length,
    details: [],
    text,
  };
}

/** บล็อกที่ระบบแนบให้เอง — สถานะดูจากการอยู่ใน prompt จริง */
function systemBlock(key: string, label: string, text: string, inPrompt: (t: string) => boolean, details: string[]): DryRunLayer {
  const has = Boolean(text.trim()) && inPrompt(text);
  return { key, label, required: false, state: has ? "sent" : "off", source: "ระบบแนบให้", chars: has ? text.length : 0, details, text: has ? text : "" };
}

export function buildWriterDryRun(input: WriterDryRunInput): WriterDryRun {
  const { target, ce, restrictions, clientComments, keyword } = input;
  const links = input.links ?? [];
  const model = input.model ?? null;

  const bannedTerms = restrictions ? bannedTermsOf(restrictions.data) : [];
  const titleClean = cleanPlainText(keyword.title || keyword.keyword, bannedTerms);
  const slugClean = cleanSlug(keyword.slug || "", bannedTerms);
  const title = titleClean.text;
  // ตอนเขียนจริงมี relatedProductIds จาก Gemini เพิ่ม — Run Test ไม่เรียก AI จึงเหลือคำตรง
  const constraints = composeWriterConstraints({
    restrictions,
    clientComments,
    topic: { keyword: keyword.keyword, title, outline: keyword.note },
  });

  const language = input.language;
  const intentBlock = articleIntentSkillBlock({
    intent: keyword.intent,
    articleType: keyword.articleType,
    keyword: keyword.keyword,
    title: keyword.title ? title : keyword.title,
    brandNames: input.brandNames,
  });
  const voiceBlock = humanVoiceSkillBlock(language ?? "th");
  const structureBlock = articleStructureSkillBlock(language === "en" ? "en" : "th", input.structure);
  const note = (keyword.note || "").trim().slice(0, WRITER_NOTE_MAX);

  let systemPrompt: string;
  let userPrompt: string;
  if (target === "upload") {
    systemPrompt = buildWriterSystemPrompt({
      masterPrompt: ce.masterPrompt?.text ?? "",
      businessSkill: ce.businessSkill?.text ?? "",
      articleBrief: ce.articleBrief?.text ?? "",
      validatorPack: ce.validatorPack?.text ?? "",
      restrictions: constraints.restrictions,
      restrictionsNote: constraints.restrictionsNote,
    });
    userPrompt = buildWriterUserPrompt({
      keyword: { ...keyword, title: keyword.title ? title : keyword.title, slug: keyword.slug ? slugClean.text : keyword.slug },
      links,
      language,
      brandNames: input.brandNames,
      constraintLayers: constraints.layerNames,
      structure: input.structure,
    });
  } else {
    // ตัวเขียน SEO ส่งข้อความเดียว และตัวห่อเต็มอยู่ใน route — แสดงลำดับ layer ด้วยข้อความจริงของแต่ละ layer
    systemPrompt = [
      `LAYER 1: BUSINESS SKILL\n${ce.businessSkill?.text ?? ""}`,
      `LAYER 2: MASTER PROMPT\n${ce.masterPrompt?.text ?? ""}`,
      `LAYER 3: ARTICLE BRIEF TEMPLATE\n${ce.articleBrief?.text ?? ""}`,
      constraints.restrictions,
      `LAYER 4: VALIDATOR PACK\n${ce.validatorPack?.text ?? ""}${constraints.restrictionsNote ? `\n${constraints.restrictionsNote}` : ""}`,
    ].filter(Boolean).join("\n\n");
    userPrompt = [`Keyword: ${keyword.keyword}`, `Title: ${title}`, note ? `หมายเหตุ: ${note}` : "", intentBlock, voiceBlock, structureBlock].filter(Boolean).join("\n\n");
  }

  const inPrompt = (t: string) => {
    const s = t.trim();
    return Boolean(s) && (systemPrompt.includes(s) || userPrompt.includes(s));
  };

  const restrictionFiles = restrictionFileReports(restrictions, constraints.restrictionsBlock);
  const commentFiles = commentFileReports(clientComments, constraints.commentsBlock);
  const files = [...restrictionFiles, ...commentFiles];

  const validatorText = `${ce.validatorPack?.text ?? ""}${constraints.restrictionsNote ? `\n${constraints.restrictionsNote}` : ""}`;
  const validator = layerFromCe("validator", "Validator Pack", ce.validatorPack, inPrompt);
  validator.text = ce.validatorPack ? validatorText : "";
  validator.chars = validator.text.length;
  validator.details = ["AI ตรวจตัวเองจากข้อความนี้ ไม่มีรอบตรวจแยก"];
  if (constraints.restrictionsNote) validator.details.push("ต่อท้ายด้วยบรรทัดตรวจข้อจำกัด / Comment");

  const restrictionsLayer: DryRunLayer = {
    key: "restrictions",
    label: "ข้อจำกัด",
    required: false,
    state: constraints.restrictionsBlock && inPrompt(constraints.restrictionsBlock) ? "sent" : "off",
    source: restrictions ? `ตั้งค่าแล้ว · ไฟล์ ${restrictionFiles.length}` : null,
    chars: constraints.restrictionsBlock.length,
    details: restrictions ? restrictionDetails(restrictions, constraints.restrictionsBlock) : ["ไม่มีแถวที่บันทึกเป็น Active: ไฟล์ของ layer นี้ไม่ถูกส่ง"],
    text: constraints.restrictionsBlock,
  };
  const commentsLayer: DryRunLayer = {
    key: "comments",
    label: "Comment ลูกค้า",
    required: false,
    state: constraints.commentsBlock && inPrompt(constraints.commentsBlock) ? "sent" : "off",
    source: clientComments ? `ตั้งค่าแล้ว · ไฟล์ ${commentFiles.length}` : null,
    chars: constraints.commentsBlock.length,
    details: clientComments ? commentDetails(clientComments, constraints.commentsBlock) : ["ไม่มีแถวที่บันทึกเป็น Active: ไฟล์ของ layer นี้ไม่ถูกส่ง"],
    text: constraints.commentsBlock,
  };

  const linkText = links.map((l) => `- anchor: "${l.keyword}" → url: ${l.url}`).join("\n");
  const linksLayer: DryRunLayer =
    target === "upload"
      ? { ...systemBlock("links", "Internal Link", linkText, inPrompt, [links.length ? `${links.length} ลิงก์ที่ตรงหัวข้อ` : "ไม่มีลิงก์ให้ใช้รอบนี้"]), source: "Project Setting + บทความในระบบ" }
      : { key: "links", label: "Internal Link", required: false, state: "later", source: null, chars: 0, details: ["เลือกตอนเขียนจริงจากแหล่งลิงก์ของโปรเจกต์ ไม่แสดงใน Run Test"], text: "" };

  const layers: DryRunLayer[] = [
    layerFromCe("master", "Master Prompt", ce.masterPrompt, inPrompt),
    layerFromCe("business", "Business Skill", ce.businessSkill, inPrompt),
    layerFromCe("brief", "Article Brief", ce.articleBrief, inPrompt),
    restrictionsLayer,
    commentsLayer,
    validator,
    systemBlock("note", "Note ของบทความนี้", note, inPrompt, note ? [] : ["ไม่มี Note"]),
    systemBlock("intent", "Intent Skill", intentBlock, inPrompt, []),
    systemBlock("voice", "Human Voice", voiceBlock, inPrompt, []),
    systemBlock("structure", "Article Structure", structureBlock, inPrompt, structureDetails(input.structure)),
    linksLayer,
    {
      key: "image",
      label: "Image Prompt",
      required: false,
      state: "later",
      source: ce.imagePrompt ? `${ce.imagePrompt.name} (v${ce.imagePrompt.version})` : null,
      chars: 0,
      details: ["ใช้ตอนสร้างรูปเท่านั้น ไม่ได้ส่งตอนเขียนเนื้อหา"],
      text: "",
    },
  ];

  const missing = missingLayersOf(input);
  const warnings: DryRunWarning[] = [];
  if (missing.length) warnings.push({ level: "error", text: `เขียนไม่ได้ ขาด ${missing.join(", ")}` });
  if (input.loadErrors?.restrictions) warnings.push({ level: "error", text: `โหลดข้อจำกัดไม่สำเร็จ: ${input.loadErrors.restrictions}` });
  if (input.loadErrors?.comments) warnings.push({ level: "error", text: `โหลด Comment ไม่สำเร็จ ตอนเขียนจริงจะข้ามไปเงียบ ๆ: ${input.loadErrors.comments}` });
  if (ce.businessSkill && isTemplateBusinessSkillName(ce.businessSkill.name)) {
    warnings.push({ level: "warn", text: `Business Skill ที่ Active ชื่อ "${ce.businessSkill.name}" ดูเป็นแม่แบบที่ยังไม่ได้กรอกข้อมูลลูกค้า เปิดตรวจก่อนเขียน` });
  }
  const placeholders = Array.from(new Set(`${systemPrompt}\n${userPrompt}`.match(PLACEHOLDER_RE) ?? []));
  if (placeholders.length) {
    warnings.push({ level: "warn", text: `มีตัวแปรที่ไม่ถูกแทนค่า ${placeholders.length} ตัว AI จะเห็นตามตัวอักษร: ${placeholders.slice(0, 12).join(", ")}${placeholders.length > 12 ? " ..." : ""}` });
  }
  const uploaded = input.uploadedFiles;
  if (uploaded && !restrictions && uploaded.restrictions > 0) {
    warnings.push({ level: "warn", text: `อัปไฟล์ข้อจำกัดไว้ ${uploaded.restrictions} ไฟล์ แต่ layer ยังไม่ Active ไฟล์เหล่านี้ไม่ถูกส่ง` });
  }
  if (uploaded && !clientComments && uploaded.comments > 0) {
    warnings.push({ level: "warn", text: `อัปไฟล์ Comment ไว้ ${uploaded.comments} ไฟล์ แต่ layer ยังไม่ Active ไฟล์เหล่านี้ไม่ถูกส่ง` });
  }
  const unsent = files.filter((f) => f.status === "none");
  if (unsent.length) warnings.push({ level: "warn", text: `ไฟล์ ${unsent.length}/${files.length} ไม่ถูกส่งเลยสำหรับบทความนี้: ${unsent.map((f) => f.name).join(", ")}` });
  const fieldWarnings = [
    ...keywordWarnings(keyword.keyword, bannedTerms),
    ...hitWarnings("title", titleClean.remaining),
    ...hitWarnings("slug", slugClean.remaining),
  ];
  for (const w of fieldWarnings) warnings.push({ level: "warn", text: w });
  if (titleClean.replaced || slugClean.replaced) warnings.push({ level: "info", text: `title / slug ถูกแทนคำต้องห้าม ${titleClean.replaced + slugClean.replaced} จุด` });
  if (restrictions?.data.productRules.some((p) => p.enabled && p.product.trim() && !constraints.restrictionsBlock.includes(`#### ${p.product}\n`))) {
    warnings.push({ level: "info", text: "Run Test จับคู่สินค้าด้วยคำตรงเท่านั้น ตอนเขียนจริง Gemini อาจเลือกสินค้าเพิ่ม" });
  }
  if (input.structure?.references && !input.structure.library?.length) {
    warnings.push({ level: "warn", text: "เปิดส่วนอ้างอิงไว้แต่ยังไม่มีรายการแหล่ง บทความจะไม่มีส่วนอ้างอิง เพิ่มรายการที่หน้า Article Style หรือสแกนบทความที่มีอ้างอิง" });
  }
  if (input.pbn) warnings.push({ level: "info", text: "PBN: ตอนเขียนจริงเพิ่มมุมเล่าตามเวอร์ชันและสไตล์ตามเว็บปลายทาง" });
  if (target === "seo") warnings.push({ level: "info", text: "Prompt ด้านล่างเป็นโครงเรียงตามลำดับจริง ตอนเขียนจริงมีข้อมูลเว็บ CTA ตัวอย่างบทความ และผู้เขียนเพิ่ม" });

  return {
    target,
    promptExact: target === "upload",
    canWrite: missing.length === 0,
    missing,
    task: { keyword: keyword.keyword, title, slug: slugClean.text, language: language ?? null, model },
    layers,
    files,
    warnings,
    steps: target === "upload" ? uploadSteps(model) : seoSteps(model),
    systemPrompt,
    userPrompt,
  };
}
