/**
 * กฎของไฟล์แนบคำขอ Backlink (ไฟล์บริสุทธิ์ ใช้ได้ทั้งเบราว์เซอร์และเซิร์ฟเวอร์ — ห้าม import prisma ที่นี่)
 * หลัก: เชื่อเฉพาะสิ่งที่เซิร์ฟเวอร์ตรวจเอง — ชนิดไฟล์มาจากนามสกุลที่อนุญาต + ไบต์ต้นไฟล์ ไม่เชื่อ Content-Type ที่เบราว์เซอร์ส่งมา
 */

export const MAX_FILE_BYTES = 4 * 1024 * 1024; // Vercel จำกัด body ที่ 4.5MB
export const MAX_FILES_PER_REQUEST = 10;
export const ORG_QUOTA_BYTES = 300 * 1024 * 1024;
export const MAX_NAME_CHARS = 120;

type Kind = "image" | "pdf" | "text" | "ooxml" | "ole";

const OOXML = "application/vnd.openxmlformats-officedocument";

/** นามสกุลที่อนุญาต → mime ที่เราเก็บและส่งกลับ (ไม่มี svg / html โดยตั้งใจ: รันสคริปต์ได้) */
export const ATTACHMENT_TYPES: Record<string, { mime: string; kind: Kind }> = {
  png: { mime: "image/png", kind: "image" },
  jpg: { mime: "image/jpeg", kind: "image" },
  jpeg: { mime: "image/jpeg", kind: "image" },
  gif: { mime: "image/gif", kind: "image" },
  webp: { mime: "image/webp", kind: "image" },
  pdf: { mime: "application/pdf", kind: "pdf" },
  txt: { mime: "text/plain; charset=utf-8", kind: "text" },
  csv: { mime: "text/plain; charset=utf-8", kind: "text" },
  md: { mime: "text/plain; charset=utf-8", kind: "text" },
  docx: { mime: `${OOXML}.wordprocessingml.document`, kind: "ooxml" },
  xlsx: { mime: `${OOXML}.spreadsheetml.sheet`, kind: "ooxml" },
  pptx: { mime: `${OOXML}.presentationml.presentation`, kind: "ooxml" },
  doc: { mime: "application/msword", kind: "ole" },
  xls: { mime: "application/vnd.ms-excel", kind: "ole" },
  ppt: { mime: "application/vnd.ms-powerpoint", kind: "ole" },
};

export const ALLOWED_EXTENSIONS = Object.keys(ATTACHMENT_TYPES);
/** ค่า accept ของ <input type="file"> */
export const ACCEPT_ATTR = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");
export const ALLOWED_LABEL = "รูป (png, jpg, gif, webp), PDF, ข้อความ (txt, csv, md), Word, Excel, PowerPoint";

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// อักขระควบคุม (C0, DEL, C1) + ตัวกลับทิศข้อความ (ใช้ปลอมนามสกุล เช่น "invoice\u202Egnp.exe")
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
// อักขระที่ระบบไฟล์ไม่รับ
const RESERVED_CHARS = /[<>:"|?*]/g;

/**
 * ชื่อไฟล์ที่ปลอดภัยสำหรับเก็บและแสดง — คืน null เมื่อนามสกุลไม่อยู่ในรายการที่อนุญาต
 * เก็บอักษรไทยไว้ ตัดเส้นทางโฟลเดอร์ อักขระควบคุม และตัวกลับทิศ ความยาวไม่เกิน MAX_NAME_CHARS โดยไม่ตัดกลาง surrogate pair
 */
export function sanitizeFileName(raw: unknown): { fileName: string; ext: string } | null {
  if (typeof raw !== "string") return null;
  const base = raw.split(/[\\/]/).pop() ?? "";
  const clean = base
    .normalize("NFC")
    .replace(UNSAFE_CHARS, "")
    .replace(RESERVED_CHARS, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  const dot = clean.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = clean.slice(dot + 1).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(ATTACHMENT_TYPES, ext)) return null;
  const stemChars = Array.from(clean.slice(0, dot).replace(/[. ]+$/, "").trim());
  const room = MAX_NAME_CHARS - ext.length - 1;
  const stem = stemChars.slice(0, room).join("").trim() || "file";
  return { fileName: `${stem}.${ext}`, ext };
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** ไบต์ต้นไฟล์ตรงกับนามสกุลที่อ้างหรือไม่ */
export function matchesSignature(ext: string, bytes: Uint8Array): boolean {
  const t = ATTACHMENT_TYPES[ext];
  if (!t) return false;
  switch (ext) {
    case "png": return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg":
    case "jpeg": return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "gif": return startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"));
    case "webp": return startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8);
    case "pdf": return startsWith(bytes, ascii("%PDF-"));
  }
  if (t.kind === "ooxml") return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
  if (t.kind === "ole") return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  // ข้อความ: ห้ามมี NUL (ยกเว้นไฟล์ UTF-16 ที่มี BOM นำหน้า เช่น "Unicode Text" จาก Excel)
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return true;
  return !bytes.includes(0);
}

export type UploadCheck =
  | { ok: true; fileName: string; ext: string; mimeType: string }
  | { ok: false; status: 400 | 413 | 415; error: string };

/** ตรวจไฟล์ที่อัปโหลด: ชื่อ ขนาด และไบต์ต้นไฟล์ */
export function validateUpload(input: { name: unknown; bytes: Uint8Array }): UploadCheck {
  const named = sanitizeFileName(input.name);
  if (!named) {
    return { ok: false, status: 415, error: `ไม่รองรับไฟล์ชนิดนี้ — แนบได้เฉพาะ ${ALLOWED_LABEL}` };
  }
  const size = input.bytes.length;
  if (size === 0) return { ok: false, status: 400, error: "ไฟล์ว่างเปล่า" };
  if (size > MAX_FILE_BYTES) {
    return { ok: false, status: 413, error: `ไฟล์ใหญ่เกิน ${formatBytes(MAX_FILE_BYTES)} (ไฟล์นี้ ${formatBytes(size)})` };
  }
  if (!matchesSignature(named.ext, input.bytes)) {
    return { ok: false, status: 415, error: `เนื้อไฟล์ไม่ตรงกับนามสกุล .${named.ext} — ตรวจว่าไฟล์ไม่เสียและไม่ได้เปลี่ยนนามสกุลเอง` };
  }
  return { ok: true, fileName: named.fileName, ext: named.ext, mimeType: ATTACHMENT_TYPES[named.ext].mime };
}

/** ค่า Content-Disposition สำหรับดาวน์โหลด: ชื่อ ASCII สำรอง + ชื่อจริงแบบ RFC 5987 */
export function contentDisposition(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot + 1).replace(/[^A-Za-z0-9]/g, "") : "";
  const stem = (dot >= 0 ? fileName.slice(0, dot) : fileName)
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\;%]/g, "_")
    .trim();
  const safeStem = /[A-Za-z0-9]/.test(stem) ? stem : "file";
  const fallback = ext ? `${safeStem}.${ext}` : safeStem;
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export type AsanaFileState = "sent" | "pending" | "error" | "none";

/** สถานะการส่งไฟล์ไป Asana เทียบกับงาน Asana ปัจจุบันของคำขอ (งานถูกลบแล้วสร้างใหม่ = ต้องส่งอีกครั้ง) */
export function asanaFileState(
  row: { asanaPushedTaskGid: string; asanaSyncError: string },
  currentTaskGid: string | null | undefined,
): AsanaFileState {
  if (!currentTaskGid) return "none";
  if (row.asanaPushedTaskGid === currentTaskGid) return "sent";
  return row.asanaSyncError ? "error" : "pending";
}

/**
 * คำขอมาจากหน้าเว็บของเราเองหรือไม่ (กันเว็บอื่นสั่งอัปโหลด/ลบผ่าน cookie ของผู้ใช้)
 * เบราว์เซอร์ปัจจุบันส่ง Sec-Fetch-Site เสมอ; ถ้าไม่มีให้เทียบ Origin กับ Host; ไม่มีทั้งคู่ = ไม่ใช่เบราว์เซอร์
 */
export function isSameOriginRequest(h: { secFetchSite?: string | null; origin?: string | null; host?: string | null }): boolean {
  const site = (h.secFetchSite ?? "").trim().toLowerCase();
  if (site) return site === "same-origin";
  const origin = (h.origin ?? "").trim();
  if (!origin) return true;
  try {
    return !!h.host && new URL(origin).host.toLowerCase() === h.host.trim().toLowerCase();
  } catch {
    return false;
  }
}

/** แถวไฟล์แนบที่ API ส่งให้หน้าจอ */
export interface AttachmentRow {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
  uploadedById: string;
  uploadedByName: string;
  createdAt: string;
  asana: AsanaFileState;
  asanaError: string;
  canDelete: boolean;
}
