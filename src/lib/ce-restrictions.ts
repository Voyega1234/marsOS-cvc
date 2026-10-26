// ─────────────────────────────────────────────────────────────────────────────
//  Content Engine — ข้อจำกัด (Restrictions)  คำสั่งเจ้าของ 2026-10-26
//
//  ข้อจำกัดของลูกค้ารายนั้น ที่ตัวเขียนบทความทุกตัว + Validator ต้องถือตาม:
//  - คำ/ข้อความต้องห้าม (เช่น สายการแพทย์: "หายขาด", "รักษาได้ 100%") — มีคำแทนได้ "คำ => คำแทน"
//  - กฎที่ต้องทำตามเสมอ (ข้อความอิสระ)
//  - ข้อมูลสินค้าที่ละเอียดอ่อน: เขียนถึงสินค้านี้เมื่อไร ต้องใช้ข้อมูลชุดนี้เท่านั้น
//  - ไฟล์ข้อกำหนด/ข้อมูลอ้างอิงขนาดใหญ่ — เบราว์เซอร์อ่านเป็นข้อความก่อนส่ง (ไม่ส่งไฟล์ดิบ)
//    แล้วเก็บแยกแถวละไฟล์ (CE_RESTRICTION_FILE) ไม่ให้ทุกการบันทึกคัดลอกข้อความ MB ลง version
//
//  ตัวเขียนได้แค่ส่วนที่ตรงหัวข้อ (เลือกด้วยคำที่ซ้ำกับ keyword/title/หัวข้อ) ภายในงบตัวอักษร
//  ไม่มี fallback ข้าม scope — โหลดเฉพาะ projectId เดียวกับ Content Engine ที่ resolve
//  ไฟล์นี้ไม่มี prisma (หน้า settings import ได้) — ส่วนที่อ่าน DB อยู่ใน ce-restrictions-server.ts
// ─────────────────────────────────────────────────────────────────────────────

import { CE_COMPILED_KEY } from "@/lib/ce-compiled-fields";

export const CE_RESTRICTIONS = "CE_RESTRICTIONS";
export const CE_RESTRICTION_FILE = "CE_RESTRICTION_FILE";

/** ข้อความไฟล์ต่อแถว — คำไทย 1 ตัว = 3 byte ใน UTF-8 → 1,000,000 ตัวอักษร ≈ 3MB ยังต่ำกว่าเพดาน body 4.5MB ของ Vercel */
export const RESTRICTION_FILE_MAX_CHARS = 1_000_000;
/** ไฟล์อ้างอิงทั้ง scope รวมกัน */
export const RESTRICTION_FILES_TOTAL_MAX_CHARS = 8_000_000;
/** ตัวอย่างข้อความที่ GET /api/prompts ส่งให้หน้า settings (ข้อความเต็มอยู่ฝั่งเซิร์ฟเวอร์) */
export const RESTRICTION_FILE_PREVIEW_CHARS = 1_500;

export type RestrictionFileKind = "rules" | "reference";

export interface ProductRule {
  id: string;
  /** ชื่อสินค้า/บริการ/หมวด */
  product: string;
  /** คำที่ถ้าเจอใน keyword/title/หัวข้อ = บทความนี้พูดถึงสินค้านี้ (คั่นด้วย , หรือขึ้นบรรทัดใหม่) */
  triggers: string;
  /** ข้อมูลที่ต้องใช้ตอนเขียนถึงสินค้านี้ */
  info: string;
  /** ไฟล์อ้างอิงที่เป็นของสินค้านี้ (id ของแถว CE_RESTRICTION_FILE) */
  fileIds: string[];
  enabled: boolean;
}

export interface RestrictionsData {
  status: "Active" | "Draft";
  /** บรรทัดละคำ — "คำ => คำแทน" ได้ */
  bannedTerms: string;
  /** กฎ/ข้อห้ามที่ต้องทำตามทุกบทความ */
  rules: string;
  productRules: ProductRule[];
}

export interface RestrictionFileMeta {
  kind: RestrictionFileKind;
  chars: number;
  size: number;
  pages?: number;
  /** ไฟล์ที่ยาวเกินแถวเดียว ถูกแบ่งเป็นหลายส่วน — ทุกส่วนมี group เดียวกัน */
  group?: string;
  part?: number;
  parts?: number;
}

export interface RestrictionFile {
  id: string;
  name: string;
  meta: RestrictionFileMeta;
  text: string;
}

export interface BannedTerm {
  term: string;
  replacement: string | null;
}

export function emptyRestrictions(): RestrictionsData {
  return { status: "Active", bannedTerms: "", rules: "", productRules: [] };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** อ่าน promptText ของแถว CE_RESTRICTIONS — ไม่ใช่ JSON (ทีมพิมพ์ข้อความล้วน) = ถือเป็นกฎทั้งก้อน */
export function parseRestrictions(raw: string | null | undefined): RestrictionsData {
  const out = emptyRestrictions();
  const text = (raw ?? "").trim();
  if (!text) return out;
  let d: Record<string, unknown> | null = null;
  try {
    const v = JSON.parse(text);
    d = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    d = null;
  }
  if (!d) return { ...out, rules: text };
  const compiled = str(d[CE_COMPILED_KEY]);
  return {
    status: d.status === "Draft" ? "Draft" : "Active",
    bannedTerms: str(d.bannedTerms),
    rules: [str(d.rules), compiled].filter((s) => s.trim()).join("\n\n"),
    productRules: Array.isArray(d.productRules)
      ? (d.productRules as Record<string, unknown>[])
          .filter((p) => p && typeof p === "object")
          .map((p, i) => ({
            id: str(p.id) || `p${i}`,
            product: str(p.product).trim(),
            triggers: str(p.triggers),
            info: str(p.info),
            fileIds: Array.isArray(p.fileIds) ? (p.fileIds as unknown[]).filter((x): x is string => typeof x === "string") : [],
            enabled: p.enabled !== false,
          }))
      : [],
  };
}

export function parseRestrictionFileMeta(raw: string | null | undefined): RestrictionFileMeta {
  try {
    const d = JSON.parse(raw ?? "") as Partial<RestrictionFileMeta>;
    return {
      kind: d.kind === "rules" ? "rules" : "reference",
      chars: Number(d.chars) || 0,
      size: Number(d.size) || 0,
      pages: Number(d.pages) || undefined,
      group: typeof d.group === "string" && d.group ? d.group : undefined,
      part: Number(d.part) || undefined,
      parts: Number(d.parts) || undefined,
    };
  } catch {
    return { kind: "reference", chars: 0, size: 0 };
  }
}

/** บรรทัดละคำ, "คำ => คำแทน" (รับ -> และ → ด้วย), บรรทัดว่าง/ขึ้นต้นด้วย # ข้าม, คำซ้ำเหลือตัวแรก */
export function parseBannedTerms(raw: string): BannedTerm[] {
  const seen = new Set<string>();
  const out: BannedTerm[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const m = l.split(/\s*(?:=>|->|→)\s*/);
    const term = (m[0] ?? "").trim().replace(/^["'“”]+|["'“”]+$/g, "");
    if (term.length < 2) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const rep = m.length > 1 ? m.slice(1).join(" ").trim() : "";
    out.push({ term, replacement: rep || null });
  }
  return out;
}

/**
 * แปลงข้อความจากไฟล์รายการคำ (CSV/XLSX→CSV/TXT) เป็นบรรทัด bannedTerms
 * คอลัมน์ที่ 1 = คำ, คอลัมน์ที่ 2 (ถ้ามี) = คำแทน — แถวหัวตารางที่หน้าตาเป็นชื่อคอลัมน์ข้าม
 */
export function bannedTermsFromTable(text: string): string {
  const lines: string[] = [];
  for (const row of text.split(/\r?\n/)) {
    const cells = splitCsvRow(row).map((c) => c.trim()).filter((c, i) => i < 2);
    const term = cells[0] ?? "";
    if (!term || /^(term|word|keyword|คำ|คำต้องห้าม|คำที่ห้ามใช้|ข้อความ)$/i.test(term)) continue;
    const rep = cells[1] ?? "";
    lines.push(rep && !/^(replacement|คำแทน|ใช้แทน)$/i.test(rep) ? `${term} => ${rep}` : term);
  }
  return lines.join("\n");
}

function splitCsvRow(row: string): string[] {
  if (row.includes("\t") && !row.includes(",")) return row.split("\t");
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (q) {
      if (ch === '"' && row[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ── แยกคำ + ให้คะแนนความตรงหัวข้อ ───────────────────────────────────────────

const STOPWORDS = new Set([
  "และ", "หรือ", "ที่", "ของ", "ใน", "การ", "ความ", "เป็น", "มี", "ได้", "ให้", "จะ", "ไม่", "กับ", "แล้ว", "ก็", "ว่า",
  "นี้", "นั้น", "เพื่อ", "โดย", "จาก", "ถึง", "อย่าง", "ไร", "อะไร", "ยัง", "ต้อง", "ด้วย", "แต่", "หาก", "ถ้า", "คือ",
  "the", "and", "for", "with", "this", "that", "from", "are", "you", "your", "how", "what", "why",
]);

// RegExp constructor: the "u" flag literal fails tsc at this project's target
const NON_WORD_RE = new RegExp("[^\\p{L}\\p{N}]+", "u");

let segmenter: Intl.Segmenter | null | undefined;
function getSegmenter(): Intl.Segmenter | null {
  if (segmenter !== undefined) return segmenter;
  try {
    segmenter = new Intl.Segmenter("th", { granularity: "word" });
  } catch {
    segmenter = null;
  }
  return segmenter;
}

/** คำในข้อความ (ตัวเล็ก, ไม่เอาคำเชื่อม/คำสั้น 1 ตัว) — ไทยตัดด้วย ICU */
export function tokenize(text: string): string[] {
  const t = text.toLowerCase();
  const seg = getSegmenter();
  const out: string[] = [];
  if (seg) {
    for (const s of Array.from(seg.segment(t))) {
      if (!s.isWordLike) continue;
      const w = s.segment.trim();
      if (w.length >= 2 && !STOPWORDS.has(w)) out.push(w);
    }
    return out;
  }
  for (const w of t.split(NON_WORD_RE)) if (w.length >= 2 && !STOPWORDS.has(w)) out.push(w);
  return out;
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

export function splitTriggers(raw: string): string[] {
  return raw.split(/[,\n،、]+/).map((s) => s.trim()).filter((s) => s.length >= 2);
}

/** สินค้าที่บทความนี้พูดถึง — ชื่อสินค้าหรือคำ trigger อยู่ใน keyword/title/หัวข้อ (ไม่สนช่องว่าง/ตัวพิมพ์) */
export function matchProductRules(rules: ProductRule[], topicText: string): ProductRule[] {
  const topic = normalizeForMatch(topicText);
  if (!topic) return [];
  return rules.filter((r) => {
    if (!r.enabled || !r.product.trim()) return false;
    const keys = [r.product, ...splitTriggers(r.triggers)];
    return keys.some((k) => {
      const n = normalizeForMatch(k);
      return n.length >= 2 && topic.includes(n);
    });
  });
}

export interface TextChunk {
  fileId: string;
  fileName: string;
  index: number;
  text: string;
}

/** ตัดข้อความเป็นก้อน ~size ตัวอักษร ตามย่อหน้า/บรรทัด (ไม่ตัดกลางบรรทัด ยกเว้นบรรทัดยาวเกินก้อน) */
export function chunkText(text: string, size = 1_500): string[] {
  const out: string[] = [];
  let cur = "";
  const push = () => {
    const c = cur.trim();
    if (c) out.push(c);
    cur = "";
  };
  for (const line of text.split(/\n/)) {
    if (line.length > size) {
      push();
      for (let i = 0; i < line.length; i += size) out.push(line.slice(i, i + size).trim());
      continue;
    }
    if (cur.length + line.length + 1 > size) push();
    cur += (cur ? "\n" : "") + line;
  }
  push();
  return out.filter(Boolean);
}

/**
 * ก้อนที่ตรงหัวข้อที่สุดภายในงบตัวอักษร — คะแนน = ผลรวม idf ของคำหัวข้อที่อยู่ในก้อน
 * (คำที่เจอทุกก้อนได้น้ำหนักน้อย) คะแนน 0 ไม่เอา, เรียงคืนตามลำดับในไฟล์เพื่ออ่านต่อเนื่อง
 */
export function pickRelevantChunks(chunks: TextChunk[], queryText: string, budgetChars: number): TextChunk[] {
  if (chunks.length === 0 || budgetChars <= 0) return [];
  const q = Array.from(new Set(tokenize(queryText)));
  if (q.length === 0) return [];
  const chunkTokens = chunks.map((c) => new Set(tokenize(c.text)));
  const df = new Map<string, number>();
  for (const w of q) df.set(w, chunkTokens.reduce((n, s) => n + (s.has(w) ? 1 : 0), 0));
  const N = chunks.length;
  const scored = chunks
    .map((c, i) => {
      let score = 0;
      for (const w of q) {
        if (!chunkTokens[i].has(w)) continue;
        const d = df.get(w) ?? 0;
        score += Math.log(1 + N / Math.max(1, d)) * Math.min(3, w.length / 2);
      }
      return { c, i, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const picked: { c: TextChunk; i: number }[] = [];
  let used = 0;
  for (const s of scored) {
    if (used + s.c.text.length > budgetChars) continue;
    picked.push(s);
    used += s.c.text.length;
    if (used >= budgetChars * 0.95) break;
  }
  return picked.sort((a, b) => a.i - b.i).map((p) => p.c);
}

function filesToChunks(files: RestrictionFile[]): TextChunk[] {
  const out: TextChunk[] = [];
  for (const f of files) {
    chunkText(f.text).forEach((text, index) => out.push({ fileId: f.id, fileName: f.name, index, text }));
  }
  return out;
}

function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}\n…(ตัดที่ ${max.toLocaleString()} ตัวอักษร)`;
}

// ── ข้อความที่ส่งเข้าตัวเขียน ────────────────────────────────────────────────

export interface RestrictionsTopic {
  keyword?: string | null;
  title?: string | null;
  /** หัวข้อ H2/H3 หรือ outline — ใช้จับคู่สินค้าและเลือกส่วนของไฟล์ */
  outline?: string | null;
}

export interface RestrictionsContext {
  rowId: string | null;
  data: RestrictionsData;
  files: RestrictionFile[];
}

const BUDGET = {
  bannedTerms: 12_000,
  rules: 10_000,
  productInfo: 16_000,
  productFiles: 14_000,
  rulesFiles: 10_000,
  referenceFiles: 8_000,
};

export function hasRestrictions(ctx: RestrictionsContext | null | undefined): boolean {
  if (!ctx) return false;
  const d = ctx.data;
  return Boolean(
    d.bannedTerms.trim() || d.rules.trim() || d.productRules.some((p) => p.enabled && p.product.trim()) || ctx.files.length,
  );
}

/**
 * ข้อจำกัดเป็นข้อความสำหรับ system prompt ของตัวเขียน (ว่าง = ไม่มีข้อจำกัด)
 * คำต้องห้าม + กฎ = ทุกบทความ, ข้อมูลสินค้า = เฉพาะสินค้าที่บทความพูดถึง, ไฟล์ = เฉพาะส่วนที่ตรงหัวข้อ
 */
export function buildRestrictionsBlock(ctx: RestrictionsContext | null | undefined, topic: RestrictionsTopic): string {
  if (!ctx || !hasRestrictions(ctx)) return "";
  const d = ctx.data;
  const topicText = [topic.keyword, topic.title, topic.outline].filter(Boolean).join("\n");
  const parts: string[] = [];

  const terms = parseBannedTerms(d.bannedTerms);
  if (terms.length) {
    const lines = terms.map((t) => (t.replacement ? `- "${t.term}" → ใช้ "${t.replacement}" แทน` : `- "${t.term}"`));
    parts.push(
      `### คำ/ข้อความต้องห้าม (ห้ามใช้ทุกรูปแบบ ทั้งหัวข้อ เนื้อหา FAQ meta และ alt รูป)\n${clip(lines.join("\n"), BUDGET.bannedTerms)}`,
    );
  }

  if (d.rules.trim()) parts.push(`### กฎที่ต้องทำตามทุกบทความ\n${clip(d.rules, BUDGET.rules)}`);

  const matched = matchProductRules(d.productRules, topicText);
  if (matched.length) {
    const per = Math.floor(BUDGET.productInfo / matched.length);
    parts.push(
      `### ข้อมูลสินค้าที่บทความนี้พูดถึง (ข้อมูลละเอียดอ่อน — ใช้ตามนี้เท่านั้น ห้ามแต่งสเปก/สรรพคุณ/ตัวเลข/ราคาเพิ่มเอง)\n` +
        matched.map((p) => `#### ${p.product}\n${clip(p.info || "(ไม่มีข้อความ — ใช้จากไฟล์อ้างอิงด้านล่าง)", per)}`).join("\n\n"),
    );
  }
  const others = d.productRules.filter((p) => p.enabled && p.product.trim() && !matched.includes(p));
  if (others.length) {
    parts.push(
      `### สินค้าที่มีข้อมูลควบคุม (บทความนี้ไม่ได้พูดถึงโดยตรง)\n${others.map((p) => `- ${p.product}`).join("\n")}\nถ้าจำเป็นต้องเอ่ยถึง ให้เอ่ยแค่ชื่อ ห้ามใส่รายละเอียด สเปก สรรพคุณ หรือคำกล่าวอ้างของสินค้าเหล่านี้`,
    );
  }

  const productFileIds = new Set(matched.flatMap((p) => p.fileIds));
  const linkedToAnyProduct = new Set(d.productRules.flatMap((p) => p.fileIds));
  const productFiles = ctx.files.filter((f) => productFileIds.has(f.id));
  const rulesFiles = ctx.files.filter((f) => f.meta.kind === "rules" && !productFileIds.has(f.id));
  // ไฟล์ของสินค้าอื่นที่บทความไม่ได้พูดถึง ไม่ส่ง — กันข้อมูลสินค้าหนึ่งไปโผล่ในบทความของอีกสินค้า
  const refFiles = ctx.files.filter((f) => f.meta.kind !== "rules" && !productFileIds.has(f.id) && !linkedToAnyProduct.has(f.id));

  const query = [topicText, ...matched.map((p) => `${p.product} ${p.triggers}`)].join("\n");
  const section = (title: string, files: RestrictionFile[], budget: number) => {
    const chunks = pickRelevantChunks(filesToChunks(files), query, budget);
    if (!chunks.length) return;
    const body = chunks.map((c) => `[${c.fileName}]\n${c.text}`).join("\n\n");
    parts.push(`### ${title}\n${body}`);
  };
  section("ข้อมูลสินค้าจากไฟล์อ้างอิง (ใช้ตามนี้เท่านั้น)", productFiles, BUDGET.productFiles);
  section("ข้อกำหนดจากไฟล์ (ส่วนที่เกี่ยวกับหัวข้อนี้ — ต้องทำตาม)", rulesFiles, BUDGET.rulesFiles);
  section("ข้อมูลอ้างอิงจากไฟล์ (ส่วนที่เกี่ยวกับหัวข้อนี้ — ใช้เป็นข้อเท็จจริง ห้ามขัดแย้ง)", refFiles, BUDGET.referenceFiles);

  if (!parts.length) return "";
  return [
    "## ข้อจำกัด (Restrictions) — บังคับ ไม่ผ่านห้ามส่งงาน",
    "ข้อจำกัดชุดนี้มาจากลูกค้า/ข้อกฎหมาย มีลำดับเหนือกว่าคำสั่งเรื่องสไตล์ SEO และความน่าอ่านทุกข้อ ถ้าขัดกันให้ยึดข้อจำกัด",
    ...parts,
  ].join("\n\n");
}

// ── ตรวจคำต้องห้ามหลังเขียน (deterministic) ─────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** คำละติน = ต้องเป็นคำเต็ม, คำไทย/ผสม = เจอตรงไหนก็นับ (ไทยไม่มีช่องว่างระหว่างคำ) */
function termRegex(term: string): RegExp {
  const body = escapeRegExp(term.trim()).replace(/\s+/g, "\\s*");
  const latin = /^[\x20-\x7e]+$/.test(term);
  return latin ? new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu") : new RegExp(body, "giu");
}

export interface BannedHit {
  term: string;
  replacement: string | null;
  count: number;
}

function textSegments(html: string): { text: string; isTag: boolean }[] {
  const out: { text: string; isTag: boolean }[] = [];
  const re = /<[^>]*>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m.index > last) out.push({ text: html.slice(last, m.index), isTag: false });
    out.push({ text: m[0], isTag: true });
    last = m.index + m[0].length;
  }
  if (last < html.length) out.push({ text: html.slice(last), isTag: false });
  return out;
}

/** คำต้องห้ามที่เจอในข้อความที่คนอ่านเห็น (ไม่นับใน tag/attribute และใน <style>/<script>) */
export function findBannedTerms(html: string, terms: BannedTerm[]): BannedHit[] {
  if (!terms.length || !html) return [];
  const visible = stripNonVisible(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ");
  const hits: BannedHit[] = [];
  for (const t of terms) {
    const n = (visible.match(termRegex(t.term)) || []).length;
    if (n) hits.push({ term: t.term, replacement: t.replacement, count: n });
  }
  return hits;
}

function stripNonVisible(html: string): string {
  return html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
}

/** แทนคำต้องห้ามที่มีคำแทนไว้ — แตะเฉพาะข้อความ ไม่แตะ tag/attribute/<style>/<script> */
export function applyBannedReplacements(html: string, terms: BannedTerm[]): { html: string; replaced: number } {
  const reps = terms.filter((t) => t.replacement);
  if (!reps.length || !html) return { html, replaced: 0 };
  let replaced = 0;
  let inRaw = false;
  const out = textSegments(html).map((s) => {
    if (s.isTag) {
      if (/^<(style|script)\b/i.test(s.text)) inRaw = true;
      else if (/^<\/(style|script)\s*>/i.test(s.text)) inRaw = false;
      return s.text;
    }
    if (inRaw) return s.text;
    let t = s.text;
    for (const r of reps) {
      t = t.replace(termRegex(r.term), () => {
        replaced++;
        return r.replacement as string;
      });
    }
    return t;
  });
  return { html: out.join(""), replaced };
}

// ── แก้คำต้องห้ามที่ไม่มีคำแทน: ส่งเฉพาะท่อนข้อความที่เจอให้ AI เขียนใหม่ ────

export interface BannedSegment {
  /** ลำดับของท่อนข้อความใน textSegments(html) */
  id: number;
  text: string;
}

/** ท่อนข้อความที่คนอ่านเห็นซึ่งยังมีคำต้องห้าม (ไม่นับ tag/<style>/<script>) — ตัดที่ max ท่อน/maxChars */
export function collectBannedSegments(
  html: string,
  terms: BannedTerm[],
  max = 40,
  maxChars = 40_000,
): BannedSegment[] {
  if (!terms.length || !html) return [];
  const regexes = terms.map((t) => termRegex(t.term));
  const out: BannedSegment[] = [];
  let chars = 0;
  let inRaw = false;
  const segs = textSegments(html);
  for (let i = 0; i < segs.length && out.length < max; i++) {
    const s = segs[i];
    if (s.isTag) {
      if (/^<(style|script)\b/i.test(s.text)) inRaw = true;
      else if (/^<\/(style|script)\s*>/i.test(s.text)) inRaw = false;
      continue;
    }
    if (inRaw || !s.text.trim()) continue;
    const plain = s.text.replace(/&nbsp;|&#160;/g, " ");
    if (!regexes.some((re) => new RegExp(re.source, re.flags).test(plain))) continue;
    if (chars + s.text.length > maxChars) break;
    chars += s.text.length;
    out.push({ id: i, text: s.text });
  }
  return out;
}

/** ใส่ท่อนข้อความที่เขียนใหม่กลับที่เดิม — ข้อความใหม่ห้ามมี tag (ตัดทิ้ง) ส่วน tag เดิมไม่ถูกแตะ */
export function replaceSegments(html: string, rewrites: Map<number, string>): string {
  if (!rewrites.size) return html;
  return textSegments(html)
    .map((s, i) => {
      const next = rewrites.get(i);
      if (s.isTag || next === undefined) return s.text;
      const clean = next.replace(/<[^>]*>/g, "").replace(/[<>]/g, "");
      if (!clean.trim()) return s.text;
      // คงช่องว่างหัว/ท้ายของท่อนเดิม — กันคำติดกับ tag ข้างเคียง
      const lead = s.text.match(/^\s*/)?.[0] ?? "";
      const trail = s.text.match(/\s*$/)?.[0] ?? "";
      return lead + clean.trim() + trail;
    })
    .join("");
}

/** ข้อความสั้นสำหรับแนบท้าย Validator Pack — ให้ตัวตรวจรู้ว่าต้องเช็คข้อจำกัดด้วย */
export function restrictionsValidatorNote(ctx: RestrictionsContext | null | undefined): string {
  if (!ctx || !hasRestrictions(ctx)) return "";
  return [
    "- [BLOCKING — ไม่ผ่านห้ามส่งงาน] ข้อจำกัดของลูกค้า: ไม่มีคำ/ข้อความต้องห้ามแม้แต่คำเดียว,",
    "  ทำตามกฎทุกข้อ, ข้อมูลสินค้าตรงกับข้อมูลที่ให้ไว้ ไม่แต่งเพิ่ม (ดูหัวข้อ \"ข้อจำกัด (Restrictions)\")",
  ].join("\n");
}

// ── title / H1 / meta / slug / keyword: ข้อความล้วน (ไม่ใช่ HTML) ────────────
//  คำสั่งเจ้าของ 2026-10-26: คำต้องห้ามห้ามหลุดไปที่ title, SEO title, meta description, slug แม้ body สะอาดแล้ว
//  keyword หลักห้ามแก้ — มีคำต้องห้ามได้แค่เตือน

export interface PlainCleanResult {
  text: string;
  /** จำนวนคำที่แทนด้วยคำแทนที่ตั้งไว้ */
  replaced: number;
  /** คำต้องห้ามที่ยังเหลือ (ไม่มีคำแทน หรือแทนไม่ได้) */
  remaining: BannedHit[];
}

/** คำต้องห้ามในข้อความล้วน — ไม่ตัด tag (title/meta ไม่ใช่ HTML) */
export function findBannedInText(text: string, terms: BannedTerm[]): BannedHit[] {
  if (!terms.length || !text) return [];
  const plain = text.replace(/&nbsp;|&#160;/g, " ");
  const hits: BannedHit[] = [];
  for (const t of terms) {
    const n = (plain.match(termRegex(t.term)) || []).length;
    if (n) hits.push({ term: t.term, replacement: t.replacement, count: n });
  }
  return hits;
}

/** แทนคำต้องห้ามที่มีคำแทนในข้อความล้วน (ไม่ escape HTML) แล้วตรวจที่เหลือ */
export function cleanPlainText(text: string, terms: BannedTerm[]): PlainCleanResult {
  if (!text || !terms.length) return { text, replaced: 0, remaining: [] };
  let t = text;
  let replaced = 0;
  for (const r of terms) {
    if (!r.replacement) continue;
    t = t.replace(termRegex(r.term), () => {
      replaced++;
      return r.replacement as string;
    });
  }
  return { text: t, replaced, remaining: findBannedInText(t, terms) };
}

const ASCII_RE = /^[\x20-\x7e]+$/;

/** คำ/วลี → รูป slug (ตัวเล็ก คั่นด้วย -) */
function slugWords(s: string): string {
  return s.toLowerCase().split(NON_WORD_RE).filter(Boolean).join("-");
}

function slugTermRegex(term: string, words: string): RegExp {
  const body = escapeRegExp(words);
  return ASCII_RE.test(term) ? new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu") : new RegExp(body, "giu");
}

/**
 * slug: คำต้องห้ามที่มีคำแทนเป็นคำ (ในรูป slug) → แทนที่ · ไม่มีคำแทน/แทนด้วยอักษรไทยใน slug อังกฤษไม่ได้ → ปล่อยไว้แล้วคืนใน remaining
 * คำต้องห้ามภาษาไทยไม่ปรากฏใน slug อังกฤษอยู่แล้ว (ข้าม) — ไม่แตะ slug ที่ไม่เจอคำเลย
 */
export function cleanSlug(slug: string, terms: BannedTerm[]): PlainCleanResult {
  if (!slug || !terms.length) return { text: slug, replaced: 0, remaining: [] };
  const asciiSlug = ASCII_RE.test(slug);
  let s = slug;
  let replaced = 0;
  const remaining: BannedHit[] = [];
  for (const t of terms) {
    const words = slugWords(t.term);
    if (!words) continue;
    const re = slugTermRegex(t.term, words);
    const repWords = t.replacement ? slugWords(t.replacement) : "";
    if (repWords && (!asciiSlug || ASCII_RE.test(repWords))) {
      s = s.replace(re, () => {
        replaced++;
        return repWords;
      });
    }
  }
  if (replaced) s = s.replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
  for (const t of terms) {
    const words = slugWords(t.term);
    if (!words) continue;
    const n = (s.match(slugTermRegex(t.term, words)) || []).length;
    if (n) remaining.push({ term: t.term, replacement: t.replacement, count: n });
  }
  return { text: s, replaced, remaining };
}

/** คำเตือนที่ขึ้นหน้า UI: "<label>: คำ (จำนวน)" — ใช้ช่อง restrictionWarnings เดิมของแต่ละ route */
export function hitWarnings(label: string, hits: BannedHit[]): string[] {
  return hits.map((h) => `${label}: ${h.term} (${h.count})`);
}

/** keyword หลักห้ามแก้ — มีคำต้องห้ามแค่เตือน */
export function keywordWarnings(keyword: string, terms: BannedTerm[]): string[] {
  return findBannedInText(keyword, terms).map((h) => `keyword มีคำต้องห้าม: ${h.term}`);
}

export interface SeoMetaCleanResult {
  html: string;
  replaced: number;
  warnings: string[];
}

const SEO_META_FIELDS: Array<{ key: string; label: string; slug?: boolean }> = [
  { key: "meta_title", label: "meta title" },
  { key: "meta_description", label: "meta description" },
  { key: "en_slug", label: "slug", slug: true },
  { key: "cover_image_alt", label: "cover alt" },
];

/**
 * บล็อก <!-- CONVERT_CAKE_SEO_META --> ของตัวเขียน SEO/SME เป็น comment (ตัว enforce ของ body ไม่แตะ)
 * แต่ meta_title / meta_description / en_slug ถูกอ่านไป push เป็น SEO title, description, URL จริง — แทนคำต้องห้ามในบรรทัดเหล่านี้
 */
export function cleanSeoMetaBlock(html: string, terms: BannedTerm[]): SeoMetaCleanResult {
  const none = { html, replaced: 0, warnings: [] as string[] };
  if (!terms.length || !html) return none;
  const m = /(<!--\s*CONVERT_CAKE_SEO_META)([\s\S]*?)(-->)/i.exec(html);
  if (!m) return none;
  let block = m[2];
  let replaced = 0;
  const warnings: string[] = [];
  for (const f of SEO_META_FIELDS) {
    block = block.replace(new RegExp(`^([ \\t]*${f.key}[ \\t]*[:=][ \\t]*)(.*)$`, "gim"), (_all, head: string, value: string) => {
      const r = f.slug ? cleanSlug(value, terms) : cleanPlainText(value, terms);
      replaced += r.replaced;
      warnings.push(...hitWarnings(f.label, r.remaining));
      return head + r.text;
    });
  }
  if (block === m[2]) return { html, replaced: 0, warnings };
  return { html: html.slice(0, m.index) + m[1] + block + m[3] + html.slice(m.index + m[0].length), replaced, warnings };
}

// ── generator ของ title/meta/slug: ใส่ข้อจำกัดใน prompt + แทนคำหลังได้ผล ───────

export interface TitleRestrictions {
  terms: BannedTerm[];
  /** ข้อความกะทัดรัดต่อท้าย prompt ('' = ไม่มีข้อจำกัด) */
  block: string;
}

export const NO_TITLE_RESTRICTIONS: TitleRestrictions = { terms: [], block: "" };

const TITLE_BUDGET = { bannedTerms: 3_000, rules: 1_500 };

/** ข้อจำกัดแบบสั้นสำหรับ prompt ตั้ง title/meta/slug — เฉพาะคำต้องห้าม + กฎ (ไม่ส่งข้อมูลสินค้า/ไฟล์ เพราะ prompt เป็น batch) */
export function titleRestrictionsFrom(ctx: RestrictionsContext | null | undefined): TitleRestrictions {
  if (!ctx) return NO_TITLE_RESTRICTIONS;
  const terms = parseBannedTerms(ctx.data.bannedTerms);
  const rules = ctx.data.rules.trim();
  if (!terms.length && !rules) return NO_TITLE_RESTRICTIONS;
  const parts = ["## ข้อจำกัดของลูกค้า (บังคับ — ใช้กับ title / H1 / meta title / meta description / slug ทุกช่อง)"];
  if (terms.length) {
    const lines = terms.map((t) => (t.replacement ? `- "${t.term}" → ใช้ "${t.replacement}" แทน` : `- "${t.term}"`));
    parts.push(
      `ห้ามใช้คำ/ข้อความเหล่านี้ทุกรูปแบบ (รวมสะกดต่าง เว้นวรรค และคำแปลอังกฤษใน slug):\n${clip(lines.join("\n"), TITLE_BUDGET.bannedTerms)}`,
    );
  }
  if (rules) parts.push(`กฎที่ต้องทำตาม (title/meta/slug ห้ามขัด):\n${clip(rules, TITLE_BUDGET.rules)}`);
  return { terms, block: parts.join("\n") };
}

/** ผลจาก generator ทีละแถว → แทนคำใน title (และ meta/slug ถ้ามี) แล้วสะสมคำที่เหลือลง tally */
export function cleanGeneratedFields(
  tr: TitleRestrictions,
  f: { title?: string; metaDescription?: string; slug?: string },
  tally?: Map<string, number>,
): { title?: string; metaDescription?: string; slug?: string } {
  if (!tr.terms.length) return f;
  const out = { ...f };
  const add = (hits: BannedHit[]) => {
    if (tally) for (const h of hits) tally.set(h.term, (tally.get(h.term) ?? 0) + h.count);
  };
  if (f.title) {
    const r = cleanPlainText(f.title, tr.terms);
    out.title = r.text;
    add(r.remaining);
  }
  if (f.metaDescription) {
    const r = cleanPlainText(f.metaDescription, tr.terms);
    out.metaDescription = r.text;
    add(r.remaining);
  }
  if (f.slug) {
    const r = cleanSlug(f.slug, tr.terms);
    out.slug = r.text;
    add(r.remaining);
  }
  return out;
}

/** สรุป tally เป็นคำเตือนบรรทัดเดียว (null = ไม่มีคำเหลือ) */
export function tallyWarning(label: string, tally: Map<string, number>): string | null {
  if (!tally.size) return null;
  return `${label}: ${Array.from(tally.entries()).map(([term, n]) => `${term} (${n})`).join(", ")}`;
}
