// ─────────────────────────────────────────────────────────────────────────────
//  อ่านไฟล์ข้อจำกัด (Content Engine) ในเบราว์เซอร์ — ส่งขึ้นเซิร์ฟเวอร์เฉพาะข้อความ
//  ไฟล์ดิบ (PDF คู่มือ/ข้อกฎหมาย หลายสิบ MB) เกินเพดาน body 4.5MB ของ Vercel แต่ข้อความจริงเล็กกว่ามาก
//  ข้อความที่ยาวเกินแถวเดียวถูกแบ่งเป็นหลายส่วน (chunkText + RESTRICTION_FILE_MAX_CHARS) ที่หน้า settings
// ─────────────────────────────────────────────────────────────────────────────

import { readPdfText } from "@/lib/pdf-text-client";
import { RESTRICTION_FILES_TOTAL_MAX_CHARS } from "@/lib/ce-restrictions";

export const RESTRICTION_FILE_ACCEPT = ".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.json,.html,.htm";
/** ไฟล์ตารางคำต้องห้าม (คอลัมน์ 1 = คำ, คอลัมน์ 2 = คำแทน) */
export const BANNED_TERMS_ACCEPT = ".xlsx,.xls,.csv,.txt";

function extOf(file: File): string {
  return file.name.toLowerCase().split(".").pop() ?? "";
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** ข้อความทั้งไฟล์ — อ่านได้ไม่เกินเพดานรวมของ scope (เกินกว่านั้นเก็บไม่ได้อยู่แล้ว) */
export async function extractRestrictionFileText(file: File): Promise<{ text: string; pages?: number }> {
  const ext = extOf(file);
  if (ext === "pdf" || file.type === "application/pdf") {
    const { text, pages } = await readPdfText(file, RESTRICTION_FILES_TOTAL_MAX_CHARS);
    return { text: normalize(text), pages };
  }
  if (ext === "doc") throw new Error("ไฟล์ .doc แบบเก่าอ่านไม่ได้ — เปิดแล้ว Save As เป็น .docx ก่อน");
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { text: normalize(r.value) };
  }
  if (ext === "xlsx" || ext === "xls") {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const text = wb.SheetNames.map((n) => `## ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })}`).join("\n\n");
    return { text: normalize(text) };
  }
  if (ext === "html" || ext === "htm") {
    const doc = new DOMParser().parseFromString(await file.text(), "text/html");
    doc.querySelectorAll("script,style,noscript").forEach((el) => el.remove());
    return { text: normalize(doc.body?.innerText || doc.body?.textContent || "") };
  }
  return { text: normalize(await file.text()) };
}

/** ตารางคำต้องห้ามเป็น CSV (ชีตแรกของ Excel) — ส่งต่อให้ bannedTermsFromTable */
export async function readBannedTermsTable(file: File): Promise<string> {
  const ext = extOf(file);
  if (ext === "xlsx" || ext === "xls") {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const first = wb.SheetNames[0];
    return first ? XLSX.utils.sheet_to_csv(wb.Sheets[first], { blankrows: false }) : "";
  }
  return file.text();
}
