// ─────────────────────────────────────────────────────────────────────────────
//  Content Engine — Comment ลูกค้า  คำสั่งเจ้าของ 2026-11-05
//
//  ทีมใส่สิ่งที่ลูกค้าติหรือขอให้ปรับ เป็นข้อความหรือไฟล์ ตัวเขียนอ่านทุกบทความของ scope นี้
//  ไฟล์ใช้แถว CE_RESTRICTION_FILE ที่ meta.kind = "comment" (เพดานและการอ่านไฟล์ชุดเดียวกับข้อจำกัด)
//  ลำดับต่ำกว่าข้อจำกัดเสมอ · ไม่กรอก/ปิด = prompt เท่าเดิม · ไม่มี fallback ข้าม scope
//  ไฟล์นี้ไม่มี prisma (หน้า settings import ได้) — ตัวโหลดอยู่ใน ce-restrictions-server.ts
// ─────────────────────────────────────────────────────────────────────────────

import {
  filesToChunks,
  pickRelevantChunks,
  restrictionsTopicText,
  type RestrictionFile,
  type RestrictionsTopic,
} from "@/lib/ce-restrictions";

export const CE_CLIENT_COMMENTS = "CE_CLIENT_COMMENTS";

/** งบตัวอักษรที่ส่งเข้าตัวเขียน — หน้า settings แสดงเลขนี้ให้ทีมเห็น */
export const CLIENT_COMMENT_BUDGET = { text: 8_000, files: 16_000 };

export interface ClientComment {
  id: string;
  text: string;
  /** วันที่เพิ่ม YYYY-MM-DD */
  date: string;
  enabled: boolean;
}

export interface ClientCommentsData {
  status: "Active" | "Draft";
  comments: ClientComment[];
}

export interface ClientCommentsContext {
  rowId: string | null;
  data: ClientCommentsData;
  files: RestrictionFile[];
}

export function emptyClientComments(): ClientCommentsData {
  return { status: "Active", comments: [] };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** ไม่ใช่ JSON (ทีมพิมพ์ข้อความล้วน) = comment เดียวทั้งก้อน */
export function parseClientComments(raw: string | null | undefined): ClientCommentsData {
  const text = (raw ?? "").trim();
  if (!text) return emptyClientComments();
  let d: Record<string, unknown> | null = null;
  try {
    const v = JSON.parse(text);
    d = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    d = null;
  }
  if (!d) return { status: "Active", comments: [{ id: "c0", text, date: "", enabled: true }] };
  return {
    status: d.status === "Draft" ? "Draft" : "Active",
    comments: Array.isArray(d.comments)
      ? (d.comments as Record<string, unknown>[])
          .filter((c) => c && typeof c === "object")
          .map((c, i) => ({ id: str(c.id) || `c${i}`, text: str(c.text), date: str(c.date), enabled: c.enabled !== false }))
      : [],
  };
}

export function activeComments(data: ClientCommentsData): ClientComment[] {
  return data.comments.filter((c) => c.enabled && c.text.trim());
}

export function hasClientComments(ctx: ClientCommentsContext | null | undefined): boolean {
  return Boolean(ctx && (activeComments(ctx.data).length || ctx.files.length));
}

/** Comment ล่าสุดสำคัญกว่า — เรียงใหม่ไปเก่า แล้วตัดที่งบ */
function commentsText(data: ClientCommentsData): string {
  const out: string[] = [];
  let used = 0;
  for (const c of activeComments(data).reverse()) {
    const line = `- ${c.date ? `[${c.date}] ` : ""}${c.text.trim()}`;
    if (used + line.length > CLIENT_COMMENT_BUDGET.text) {
      const room = CLIENT_COMMENT_BUDGET.text - used;
      if (room > 200) out.push(`${line.slice(0, room).trimEnd()}…`);
      break;
    }
    out.push(line);
    used += line.length;
  }
  return out.join("\n");
}

/** งบรวมกัน: ไฟล์สั้นเอาเท่าที่ใช้ ที่เหลือแบ่งให้ไฟล์ยาว · ไฟล์ยาวเลือกส่วนที่ตรงหัวข้อ ไม่เจอเลยส่งจากต้นไฟล์ */
function commentFileText(files: RestrictionFile[], query: string): string {
  if (!files.length) return "";
  const out: string[] = files.map(() => "");
  const shortFirst = files
    .map((f, index) => ({ f, index, text: f.text.trim() }))
    .sort((a, b) => a.text.length - b.text.length);
  let left = CLIENT_COMMENT_BUDGET.files;
  shortFirst.forEach(({ f, index, text }, n) => {
    const per = Math.floor(left / (shortFirst.length - n));
    if (text.length <= per) {
      out[index] = `[${f.name}]\n${text}`;
      left -= text.length;
      return;
    }
    const all = filesToChunks([f]);
    let chunks = pickRelevantChunks(all, query, per);
    if (!chunks.length) {
      let used = 0;
      chunks = all.filter((c) => (used += c.text.length) <= per);
    }
    if (!chunks.length) return;
    const body = chunks.map((c) => c.text).join("\n\n");
    out[index] = `[${f.name}]\n${body}`;
    left = Math.max(0, left - body.length);
  });
  return out.filter(Boolean).join("\n\n");
}

export function buildClientCommentsBlock(ctx: ClientCommentsContext | null | undefined, topic: RestrictionsTopic): string {
  if (!ctx || !hasClientComments(ctx)) return "";
  const text = commentsText(ctx.data);
  const fromFiles = commentFileText(ctx.files, restrictionsTopicText(topic));
  if (!text && !fromFiles) return "";
  return [
    "## Comment จากลูกค้า — ต้องปรับบทความให้ตรงทุกข้อ",
    "สิ่งที่ลูกค้าติหรือขอให้ปรับ บทความนี้ต้องไม่มีปัญหาแบบเดียวกัน",
    "- เรื่องมุมมอง น้ำเสียง และสิ่งที่ต้องเน้น Comment ชนะ Master Prompt, Article Brief, Intent Skill, Human Voice และโครงสร้างบทความ แต่รูปแบบ output ยังต้องตามที่กำหนด",
    "- ถ้า Comment ขัดกับข้อจำกัด คำต้องห้าม หรือกฎ ให้ยึดข้อจำกัด และเขียนให้ตรง Comment เท่าที่ข้อจำกัดอนุญาต",
    "- ข้อมูลจริงที่ลูกค้าให้ไว้ใน Comment เป็นแหล่งข้อมูลที่ใช้ได้ และต้องนำมาใช้เมื่อบทความเกี่ยวข้อง ยกเว้นส่วนที่ Comment บอกว่าพูดไม่ได้",
    "- ห้ามแต่งข้อมูล ตัวเลข งานวิจัย หรือคำกล่าวอ้างที่ไม่มีใน Comment หรือข้อจำกัด เพื่อทำตาม Comment",
    "- ห้ามเอ่ยถึง Comment ในบทความ",
    "- ส่วนที่ Comment บอกว่าพูดไม่ได้ ไม่เปิดเผย หรือให้อ่านประกอบ ใช้เพื่อความเข้าใจเท่านั้น ห้ามเขียนลงบทความ",
    "- Comment ที่ระบุบทความหรือหัวข้อเฉพาะ ใช้เมื่อบทความนี้เป็นเรื่องเดียวกันเท่านั้น ส่วน Comment ทั่วไปใช้ทุกบทความ",
    ...(text ? [`### Comment\n${text}`] : []),
    ...(fromFiles ? [`### Comment จากไฟล์\n${fromFiles}`] : []),
  ].join("\n\n");
}

export function clientCommentsValidatorNote(ctx: ClientCommentsContext | null | undefined): string {
  if (!hasClientComments(ctx)) return "";
  return '- [BLOCKING] บทความต้องไม่มีปัญหาที่ลูกค้าเคยติ (ดูหัวข้อ "Comment จากลูกค้า") โดยไม่ขัดกับข้อจำกัด';
}

/** รวมบล็อกที่ไม่ว่าง — ไม่มีเลยได้ '' ตัวเขียนจึงได้ prompt เท่าเดิม */
export function joinPromptBlocks(...blocks: Array<string | null | undefined>): string {
  return blocks.map((b) => b?.trim() ?? "").filter(Boolean).join("\n\n");
}
