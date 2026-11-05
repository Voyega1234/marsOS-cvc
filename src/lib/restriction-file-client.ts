// ─────────────────────────────────────────────────────────────────────────────
//  อ่านไฟล์ข้อจำกัด (Content Engine) ในเบราว์เซอร์ — ส่งขึ้นเซิร์ฟเวอร์เฉพาะข้อความ
//  ไฟล์ดิบ (PDF คู่มือ/ข้อกฎหมาย หลายสิบ MB) เกินเพดาน body 4.5MB ของ Vercel แต่ข้อความจริงเล็กกว่ามาก
//  ข้อความที่ยาวเกินแถวเดียวถูกแบ่งเป็นหลายส่วน (chunkText + RESTRICTION_FILE_MAX_CHARS) ที่หน้า settings
//  รูปและหน้าที่เป็นรูป ต้องให้ AI อ่าน มีค่าใช้จ่าย จึงให้ผู้ใช้ยืนยันก่อนทุกครั้ง (restriction-files.tsx)
// ─────────────────────────────────────────────────────────────────────────────

import { isImagePage, readPdfPages, readPdfTextItems, renderPdfPagesJpeg, type PdfPageInfo } from "@/lib/pdf-text-client";
import { RESTRICTION_FILES_TOTAL_MAX_CHARS } from "@/lib/ce-restrictions";
import {
  csvToText,
  decodeTextBytes,
  docxHtmlToText,
  htmlTablesToRows,
  linesToCandidates,
  officeXmlToText,
  parseCsv,
  parseGenericTermRows,
  parseLegalRows,
  pdfItemsToRows,
  rtfToText,
  tableToRecords,
  type TermCandidate,
} from "@/lib/restriction-table";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];
const SHEET_EXTS = ["xlsx", "xls", "xlsm", "xlsb", "ods"];
export const RESTRICTION_FILE_ACCEPT = [
  ".pdf,.docx,.pptx,.odt,.rtf,.csv,.tsv,.txt,.md,.json,.xml,.yaml,.yml,.log,.html,.htm",
  ...SHEET_EXTS.map((e) => `.${e}`),
  ...IMAGE_EXTS.map((e) => `.${e}`),
].join(",");
/** กันค่าใช้จ่ายบาน: PDF สแกนทั้งเล่มให้ AI อ่านครั้งละไม่เกินเท่านี้ */
export const IMAGE_PAGES_MAX = 40;
const IMAGE_MAX_SIDE = 1600;

function extOf(file: File): string {
  return file.name.toLowerCase().split(".").pop() ?? "";
}

export function isImageFile(file: File): boolean {
  return IMAGE_EXTS.includes(extOf(file));
}

/** ตัดอักขระควบคุมที่ฐานข้อมูลรับไม่ได้ และรวมสระอำที่ PDF แยกเป็น 2 ตัว */
export function normalizeFileText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f﻿]/g, "")
    .replace(/ํา/g, "ำ")
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function joinPdfPages(pages: Array<Pick<PdfPageInfo, "text">>): string {
  return pages.map((p) => p.text).filter(Boolean).join("\n\n").slice(0, RESTRICTION_FILES_TOTAL_MAX_CHARS);
}

async function readText(file: File): Promise<string> {
  return decodeTextBytes(new Uint8Array(await file.arrayBuffer()));
}

/** pptx/odt เป็น zip ของ XML — ใช้ jszip ตัวเดียวกับที่ mammoth ใช้อ่าน docx */
async function readZippedOfficeText(file: File): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  if (extOf(file) === "odt") {
    const content = zip.file("content.xml");
    return content ? officeXmlToText(await content.async("string")) : "";
  }
  const slideNo = (name: string) => Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNo(a) - slideNo(b));
  const texts: string[] = [];
  for (const name of slides) {
    const body = officeXmlToText(await zip.files[name].async("string")).trim();
    if (body) texts.push(`## สไลด์ ${slideNo(name)}\n${body}`);
  }
  return texts.join("\n\n");
}

export interface ExtractedFile {
  text: string;
  pages?: number;
  /** หน้าที่เนื้อหาอยู่ในรูป เฉพาะ PDF — ข้อความใน text ยังไม่รวมส่วนในรูป */
  imagePages?: number[];
  pdfPages?: PdfPageInfo[];
}

function unsupportedMessage(ext: string): string | null {
  if (ext === "doc") return "ไฟล์ .doc แบบเก่าอ่านในเบราว์เซอร์ไม่ได้ — เปิดแล้ว Save As เป็น .docx ก่อน";
  if (ext === "ppt") return "ไฟล์ .ppt แบบเก่าอ่านในเบราว์เซอร์ไม่ได้ — เปิดแล้ว Save As เป็น .pptx ก่อน";
  if (["pages", "key", "numbers"].includes(ext)) return `ไฟล์ .${ext} อ่านไม่ได้ — Export เป็น PDF หรือ Word/Excel ก่อน`;
  if (ext === "heic" || ext === "heif") return "รูป HEIC อ่านในเบราว์เซอร์ไม่ได้ — แปลงเป็น JPG หรือ PNG ก่อน";
  return null;
}

/** ข้อความทั้งไฟล์ — อ่านได้ไม่เกินเพดานรวมของ scope (เกินกว่านั้นเก็บไม่ได้อยู่แล้ว) · รูปล้วนคืนข้อความว่าง */
export async function extractRestrictionFileText(file: File): Promise<ExtractedFile> {
  const ext = extOf(file);
  const unsupported = unsupportedMessage(ext);
  if (unsupported) throw new Error(unsupported);
  if (ext === "pdf" || file.type === "application/pdf") {
    const { pages, pageCount } = await readPdfPages(file, RESTRICTION_FILES_TOTAL_MAX_CHARS);
    return {
      text: normalizeFileText(joinPdfPages(pages)),
      pages: pageCount,
      imagePages: pages.filter(isImagePage).map((p) => p.page),
      pdfPages: pages,
    };
  }
  if (isImageFile(file)) return { text: "" };
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const r = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    return { text: normalizeFileText(docxHtmlToText(r.value)) };
  }
  if (ext === "pptx" || ext === "odt") return { text: normalizeFileText(await readZippedOfficeText(file)) };
  if (SHEET_EXTS.includes(ext)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const text = wb.SheetNames.map((n) => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false });
      return `## ${n}\n${tableToRecords(parseCsv(csv)) ?? csv}`;
    }).join("\n\n");
    return { text: normalizeFileText(text) };
  }
  if (ext === "csv" || ext === "tsv") return { text: normalizeFileText(csvToText(await readText(file))) };
  if (ext === "rtf") return { text: normalizeFileText(rtfToText(await readText(file))) };
  if (ext === "html" || ext === "htm") {
    const doc = new DOMParser().parseFromString(await readText(file), "text/html");
    doc.querySelectorAll("script,style,noscript").forEach((el) => el.remove());
    // innerText ของเอกสารที่ไม่ได้แสดงผลไม่มีการขึ้นบรรทัด จึงแปลงจาก HTML เอง
    return { text: normalizeFileText(docxHtmlToText(doc.body?.innerHTML || "")) };
  }
  return { text: normalizeFileText(await readText(file)) };
}

/** ส่งรูป 1 หน้าให้ AI ถอดข้อความ */
async function transcribeImage(image: string, projectId: string | null, fileName: string, page: number): Promise<string> {
  const res = await fetch("/api/prompts/read-page-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, image, fileName, page }),
  });
  const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? String(res.status));
  return body.text?.trim() ?? "";
}

/** อ่านไฟล์รูปด้วย AI — ย่อเป็น JPEG ก่อนส่ง */
export async function readImageFileWithAI(file: File, projectId: string | null): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("เบราว์เซอร์สร้าง canvas ไม่ได้");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return normalizeFileText(await transcribeImage(canvas.toDataURL("image/jpeg", 0.82), projectId, file.name, 1));
}

/**
 * ให้ AI อ่านเฉพาะหน้าที่เป็นรูป แล้วแทรกไว้ท้ายข้อความของหน้านั้น
 * หน้าที่อ่านไม่สำเร็จข้ามไป ข้อความเดิมยังอยู่ครบ และรายงานเลขหน้ากลับไปให้ผู้ใช้เห็น
 */
export async function readImagePagesWithAI(params: {
  file: File;
  extracted: ExtractedFile;
  pagesToRead: number[];
  projectId: string | null;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ text: string; failedPages: number[] }> {
  const { file, extracted, pagesToRead, projectId, onProgress } = params;
  const fromImage = new Map<number, string>();
  const failedPages: number[] = [];
  let done = 0;
  await renderPdfPagesJpeg(file, pagesToRead, async (page, image) => {
    try {
      const text = await transcribeImage(image, projectId, file.name, page);
      if (text) fromImage.set(page, text);
    } catch {
      failedPages.push(page);
    }
    done += 1;
    onProgress?.(done, pagesToRead.length);
  });
  const merged = (extracted.pdfPages ?? []).map((p) => {
    const extra = fromImage.get(p.page);
    return { text: extra ? [p.text, `[ข้อความจากรูปในหน้า ${p.page}]\n${extra}`].filter(Boolean).join("\n") : p.text };
  });
  return { text: normalizeFileText(joinPdfPages(merged)), failedPages };
}

// ── นำเข้ารายการคำ ────────────────────────────────────────────────────────────

export type TermImport =
  /** ตาราง 1-2 คอลัมน์หรือรายการข้อความ — ทำงานแบบเดิม */
  | { kind: "legacy"; text: string }
  /** ต้องให้ทีมเลือกก่อน */
  | { kind: "candidates"; candidates: TermCandidate[] }
  /** ไม่มีข้อความเลย ต้องอ่านผ่าน extractRestrictionFileText + AI */
  | { kind: "needs-ocr" };

function fromRows(rows: string[][], opts: { fromPdf?: boolean } = {}): TermCandidate[] | null {
  return parseLegalRows(rows, opts) ?? parseGenericTermRows(rows);
}

/** หาว่าคำอยู่ส่วนไหนของไฟล์ — ตารางอ่านตามชื่อคอลัมน์ ไฟล์อื่นถือว่าเป็นรายการบรรทัดละคำ */
export async function readTermImport(file: File): Promise<TermImport> {
  const ext = extOf(file);
  const unsupported = unsupportedMessage(ext);
  if (unsupported) throw new Error(unsupported);
  if (isImageFile(file)) return { kind: "needs-ocr" };

  if (SHEET_EXTS.includes(ext)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const csvs = wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false }));
    for (const csv of csvs) {
      const legal = parseLegalRows(parseCsv(csv));
      if (legal) return { kind: "candidates", candidates: legal };
    }
    const first = csvs[0] ?? "";
    const generic = parseGenericTermRows(parseCsv(first));
    return generic ? { kind: "candidates", candidates: generic } : { kind: "legacy", text: first };
  }
  if (["csv", "tsv", "txt"].includes(ext)) {
    const text = await readText(file);
    // .txt ที่มีลูกน้ำในประโยคไม่ใช่ตาราง — นับเป็นตารางเฉพาะที่มีช่องถูก/ผิดชัดเจน
    const rows = parseCsv(text);
    const candidates = ext === "txt" ? parseLegalRows(rows) : fromRows(rows);
    return candidates ? { kind: "candidates", candidates } : { kind: "legacy", text };
  }
  if (ext === "pdf" || file.type === "application/pdf") {
    const rows = pdfItemsToRows(await readPdfTextItems(file));
    const normalized = rows?.map((r) => r.map(normalizeFileText));
    const legal = normalized ? parseLegalRows(normalized, { fromPdf: true }) : null;
    if (legal) return { kind: "candidates", candidates: legal };
  }
  if (ext === "docx" || ext === "html" || ext === "htm") {
    const html = ext === "docx"
      ? (await (await import("mammoth")).convertToHtml({ arrayBuffer: await file.arrayBuffer() })).value
      : await readText(file);
    const rows = htmlTablesToRows(html);
    const candidates = rows ? fromRows(rows) : null;
    if (candidates) return { kind: "candidates", candidates };
  }
  const { text } = await extractRestrictionFileText(file);
  return text ? { kind: "candidates", candidates: linesToCandidates(text) } : { kind: "needs-ocr" };
}
