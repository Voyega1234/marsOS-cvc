// สถานะ layer เสริม (ข้อจำกัด / Comment) สำหรับการ์ดสถานะ — ใช้กติกาเดียวกับตัวโหลดตอนเขียนจริง
import {
  CE_RESTRICTIONS,
  CE_RESTRICTION_FILE,
  approvedTermList,
  bannedTermsOf,
  hasRestrictions,
  parseRestrictionFileMeta,
  parseRestrictions,
  usableResearch,
  type RestrictionFile,
} from "@/lib/ce-restrictions";
import { CE_CLIENT_COMMENTS, activeComments, hasClientComments, parseClientComments } from "@/lib/ce-client-comments";

/** แท็บไฟล์ยิง event นี้เมื่อรายการไฟล์เปลี่ยน — การ์ดสถานะอัปเดตโดยไม่ต้อง refresh ทั้งหน้า (ร่างที่แก้อยู่ไม่หาย) */
export const CE_FILES_CHANGED_EVENT = "ce-files-changed";

/** ชื่อแบบนี้คือแม่แบบตั้งต้น ยังไม่ใช่ข้อมูลลูกค้า */
export function isTemplateBusinessSkillName(name: string): boolean {
  return /แม่แบบ|Clone ไปกรอก|โครงมาตรฐาน/.test(name);
}

export interface LayerStatusRow {
  id: string;
  name?: string;
  type: string;
  isActive?: boolean;
  promptText?: string;
  description?: string | null;
}

/** on = ส่งเข้าตัวเขียน · off = ไม่ได้ใช้ · blocked = อัปไฟล์ไว้แต่ layer ปิด ไฟล์จึงไม่ถูกส่ง */
export interface OptionalLayerStatus {
  label: string;
  state: "on" | "off" | "blocked";
  /** ข้อความบนชิป เช่น "คำห้าม 600 · ไฟล์ 3" */
  detail: string;
}

/** ไฟล์เดียวอาจแบ่งหลายแถว — รวมตาม group */
function fileStubs(rows: LayerStatusRow[], wantComment: boolean): RestrictionFile[] {
  const seen = new Map<string, RestrictionFile>();
  for (const r of rows) {
    if (r.type !== CE_RESTRICTION_FILE) continue;
    const meta = parseRestrictionFileMeta(r.description);
    if ((meta.kind === "comment") !== wantComment) continue;
    const key = meta.group ?? r.id;
    if (!seen.has(key)) seen.set(key, { id: r.id, name: r.name ?? "", meta, text: "" });
  }
  return Array.from(seen.values());
}

function join(parts: Array<string | false>): string {
  return parts.filter(Boolean).join(" · ");
}

export function restrictionsLayerStatus(rows: LayerStatusRow[]): OptionalLayerStatus {
  const label = "ข้อจำกัด";
  const files = fileStubs(rows, false);
  const row = rows.find((r) => r.type === CE_RESTRICTIONS && r.isActive);
  const data = row ? parseRestrictions(row.promptText ?? "") : null;
  if (!data || data.status === "Draft") {
    const why = data ? "Draft" : "ยังไม่ได้บันทึก";
    if (files.length) return { label, state: "blocked", detail: `${why} · ไฟล์ ${files.length} ไม่ถูกส่ง` };
    return { label, state: "off", detail: data ? "Draft" : "ไม่ได้ใช้" };
  }
  if (!hasRestrictions({ rowId: row?.id ?? null, data, files })) return { label, state: "off", detail: "ไม่ได้ใช้" };
  const banned = bannedTermsOf(data).length;
  const products = data.productRules.filter((p) => p.enabled && p.product.trim()).length;
  const approved = approvedTermList(data).length;
  const research = usableResearch(data).length;
  return {
    label,
    state: "on",
    detail: join([
      banned > 0 && `คำห้าม ${banned}`,
      Boolean(data.rules.trim()) && "กฎ",
      products > 0 && `สินค้า ${products}`,
      approved > 0 && `ถ้อยคำอนุมัติ ${approved}`,
      research > 0 && `งานวิจัย ${research}`,
      files.length > 0 && `ไฟล์ ${files.length}`,
    ]),
  };
}

export function commentsLayerStatus(rows: LayerStatusRow[]): OptionalLayerStatus {
  const label = "Comment";
  const files = fileStubs(rows, true);
  const row = rows.find((r) => r.type === CE_CLIENT_COMMENTS && r.isActive);
  const data = row ? parseClientComments(row.promptText ?? "") : null;
  if (!data || data.status === "Draft") {
    const why = data ? "Draft" : "ยังไม่ได้บันทึก";
    if (files.length) return { label, state: "blocked", detail: `${why} · ไฟล์ ${files.length} ไม่ถูกส่ง` };
    return { label, state: "off", detail: data ? "Draft" : "ไม่ได้ใช้" };
  }
  if (!hasClientComments({ rowId: row?.id ?? null, data, files })) return { label, state: "off", detail: "ไม่ได้ใช้" };
  const active = activeComments(data).length;
  return { label, state: "on", detail: join([active > 0 && `${active} ข้อ`, files.length > 0 && `ไฟล์ ${files.length}`]) };
}
