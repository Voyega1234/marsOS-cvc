// ─────────────────────────────────────────────────────────────────────────────
//  แปลงไฟล์ตาราง/Word เป็นข้อความที่ตัวเขียนอ่านรู้เรื่อง — ไม่แตะเบราว์เซอร์และ DB (เทสได้ตรง ๆ)
//  ตาราง: การเลือกส่วนที่ตรงหัวข้อตัดตามบรรทัด จึงแปลงแต่ละแถวเป็น 1 บรรทัดที่มีชื่อคอลัมน์ติดไปด้วย
//  ตารางกฎหมาย: แปลงเป็นรายการคำให้ทีมติ๊กเลือกเอง ไม่นำเข้าเองเด็ดขาด คำบางคำอาจเป็นชื่อสินค้าของลูกค้า
// ─────────────────────────────────────────────────────────────────────────────

/** อ่าน CSV/TSV ตามมาตรฐาน — ช่องในเครื่องหมายคำพูดมีขึ้นบรรทัดใหม่ได้ */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLine = src.split("\n", 1)[0] ?? "";
  const sep = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur === "") quoted = true;
    else if (ch === sep) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function flatten(cell: string): string {
  return cell.replace(/\s*\n\s*/g, " ").replace(/[ \t]{2,}/g, " ").trim();
}

function filled(row: string[]): string[] {
  return row.map(flatten).filter(Boolean);
}

const HEADER_SCAN_ROWS = 10;
const HEADER_CELL_MAX = 80;

/** หัวตาราง = แถวแรก ๆ ที่มีอย่างน้อย 3 ช่องสั้น ๆ ไม่ใช่ตัวเลข และแถวถัดไปมีข้อมูล · ไม่เจอ = -1 */
function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length - 1, HEADER_SCAN_ROWS);
  for (let i = 0; i < limit; i++) {
    const cells = filled(rows[i]);
    if (cells.length < 3 || cells.some((c) => c.length > HEADER_CELL_MAX)) continue;
    if (cells.filter((c) => /^[\d.,%\s-]+$/.test(c)).length > 0) continue;
    const next = rows.slice(i + 1).find((r) => filled(r).length > 0);
    if (next && filled(next).length >= 2) return i;
  }
  return -1;
}

/**
 * แถวละ 1 บรรทัด "หัวคอลัมน์: ค่า | ..." · ช่องแรกว่างใช้ค่าจากแถวก่อน (หมวดที่กินหลายแถว)
 * ข้อความเหนือหัวตาราง (ชื่อเอกสาร) เก็บเป็นบรรทัดธรรมดา · หาหัวตารางไม่เจอ = null
 */
export function tableToRecords(rows: string[][]): string | null {
  const headerAt = findHeaderRow(rows);
  if (headerAt < 0) return null;
  const header = rows[headerAt].map(flatten);
  const out: string[] = rows.slice(0, headerAt).map((r) => filled(r).join(" ")).filter(Boolean);
  let lastFirst = "";
  for (const raw of rows.slice(headerAt + 1)) {
    const cells = raw.map(flatten);
    if (!cells.some(Boolean)) continue;
    if (cells[0]) lastFirst = cells[0];
    else if (lastFirst) cells[0] = lastFirst;
    const parts: string[] = [];
    for (let c = 0; c < cells.length; c++) {
      if (!cells[c]) continue;
      parts.push(header[c] ? `${header[c]}: ${cells[c]}` : cells[c]);
    }
    out.push(parts.join(" | "));
  }
  return out.join("\n");
}

/** CSV เป็นข้อความสำหรับเก็บ — ไม่เจอหัวตารางคืนข้อความเดิม */
export function csvToText(text: string): string {
  return tableToRecords(parseCsv(text)) ?? text;
}

const HTML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== "#") return HTML_ENTITIES[code.toLowerCase()] ?? whole;
    const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  });
}

/** HTML จาก mammoth เป็นข้อความ — คงการขึ้นบรรทัด หัวข้อรายการ และช่องตารางที่ extractRawText ทำหาย */
export function docxHtmlToText(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/(td|th)>\s*(?=<(td|th)[\s>])/gi, " | ")
    .replace(/<\/(p|li|h[1-6]|tr|table|ul|ol|div)>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text);
}

// ── อ่านไบต์เป็นข้อความ / รูปแบบอื่น ─────────────────────────────────────────────

/** UTF-8 ก่อน ไม่ผ่านค่อย Windows-874 (CSV ที่ Excel ไทย save) · ไฟล์ binary โยน error แทนการเก็บขยะ */
export function decodeTextBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  const sample = bytes.subarray(0, 4096);
  const isZip = sample[0] === 0x50 && sample[1] === 0x4b && sample[2] === 0x03;
  if (isZip || sample.filter((b) => b === 0).length > sample.length * 0.01) throw new Error("ไฟล์นี้ไม่ใช่ข้อความ อ่านไม่ได้");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-874").decode(bytes);
  }
}

/** RTF เป็นข้อความ — รองรับ \uN และ \'xx (Windows-874) ตัดกลุ่มที่ไม่ใช่เนื้อหา */
export function rtfToText(rtf: string): string {
  const bytes = (hex: string) => {
    const pairs = hex.match(/.{2}/g) ?? [];
    return new TextDecoder("windows-874").decode(new Uint8Array(pairs.map((h) => parseInt(h, 16))));
  };
  return rtf
    .replace(/\{\\(?:\*|fonttbl|colortbl|stylesheet|info|pict)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, "")
    .replace(/\\u(-?\d+)\s?(?:\\'[0-9a-f]{2}|\?)?/gi, (_m, n: string) => String.fromCharCode((Number(n) + 65536) % 65536))
    .replace(/((?:\\'[0-9a-f]{2})+)/gi, (m) => bytes(m.replace(/\\'/g, "")))
    .replace(/\\(?:par|line|row|sect|page)\b ?/g, "\n")
    .replace(/\\cell\b ?/g, " | ")
    .replace(/\\tab\b ?/g, "\t")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/\\([{}\\])/g, "$1")
    .replace(/[{}]/g, "");
}

/** สไลด์ .pptx / เนื้อหา .odt เป็นข้อความ — ย่อหน้าละบรรทัด */
export function officeXmlToText(xml: string): string {
  const text = xml
    .replace(/<\/(a:p|text:p|text:h)>/g, "\n")
    .replace(/<(a:br|text:line-break)\s*\/>/g, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text);
}

/** ตารางที่ใหญ่สุดในเอกสาร Word/HTML — ไม่มีตารางคืน null */
export function htmlTablesToRows(html: string): string[][] | null {
  let best: string[][] | null = null;
  for (const table of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const rows = (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((tr) =>
      (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map((td) =>
        decodeEntities(td.replace(/<br\s*\/?>|<\/p>/gi, " ").replace(/<[^>]*>/g, "")).trim(),
      ),
    );
    if (!best || rows.length > best.length) best = rows;
  }
  return best;
}

// ── ตารางจาก PDF: ใช้ตำแหน่งข้อความ เพราะข้อความเรียงต่อกันแยกคอลัมน์ไม่ได้ ───────

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

const TICK_RE = /^[✓✔☑√]$/;
const CROSS_RE = /^[xX×✗✘]$/;
/** น้อยกว่านี้ถือว่าไม่ใช่ตารางถูก/ผิด */
const PDF_MIN_MARKS = 5;
const PDF_COLUMN_TOLERANCE = 12;
/** ข้อความห่างเครื่องหมายเกินนี้ไม่ใช่ของแถวนั้น (หัวหมวด/หัวตารางที่ไม่มีเครื่องหมาย) */
const PDF_ROW_REACH = 48;
/** หัวตารางที่ซ้ำทุกหน้าของ PDF ตัวอักษรเพี้ยนเป็นแบบนี้ ไม่ใช่เนื้อหา */
const PDF_HEADER_WORD_RE = /^(ข้อคว[าำ]ม|แนวท[าำ]ง|ที่ใช้ในก[าำ]รโฆษณ[าำ])$/;
const PDF_HEADER_REACH = 14;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function joinWrapped(lines: string[]): string {
  return lines.reduce((acc, line) => {
    if (!acc) return line;
    const thaiJoin = /[฀-๿]$/.test(acc) && /^[฀-๿]/.test(line);
    return acc + (thaiJoin ? "" : " ") + line;
  }, "");
}

/** ประกอบแถวจากตำแหน่ง: เครื่องหมาย ✓/X คือจุดยึดแถว ข้อความซ้ายของคอลัมน์เครื่องหมายคือคำ · ไม่ใช่ตารางคืน null */
export function pdfItemsToRows(pages: PdfTextItem[][]): string[][] | null {
  const all = pages.flat();
  const ticks = all.filter((i) => TICK_RE.test(i.str.trim()));
  const crosses = all.filter((i) => CROSS_RE.test(i.str.trim()));
  if (crosses.length + ticks.length < PDF_MIN_MARKS || !crosses.length) return null;
  const tickX = ticks.length ? median(ticks.map((i) => i.x)) : null;
  const crossX = median(crosses.map((i) => i.x));
  const markLeft = Math.min(tickX ?? crossX, crossX);

  const rows: string[][] = [["ข้อความ", "สามารถโฆษณาได้", "ไม่สามารถโฆษณาได้"]];
  for (const items of pages) {
    const anchors = items
      .filter((i) => {
        const t = i.str.trim();
        return (
          (TICK_RE.test(t) && tickX !== null && Math.abs(i.x - tickX) <= PDF_COLUMN_TOLERANCE) ||
          (CROSS_RE.test(t) && Math.abs(i.x - crossX) <= PDF_COLUMN_TOLERANCE)
        );
      })
      .sort((a, b) => b.y - a.y);
    if (!anchors.length) continue;
    // คอลัมน์ลำดับ: ตัวเลขล้วนซ้ายสุดที่อยู่ระดับเดียวกับเครื่องหมาย
    const seqRights = items
      .filter((i) => /^\d+$/.test(i.str.trim()) && i.x < markLeft && anchors.some((a) => Math.abs(a.y - i.y) <= 12))
      .map((i) => i.x + i.width);
    const seqRight = seqRights.length ? median(seqRights) : 0;
    // หัวตารางอาจอยู่กลางหน้า · ต้องเจอคำหัวตาราง 2 คำใกล้กันจึงนับ คำเดียวอาจเป็นเนื้อหา
    const headerWords = items.filter((i) => PDF_HEADER_WORD_RE.test(i.str.trim()));
    const headerYs = headerWords
      .filter((i) => headerWords.some((o) => o !== i && Math.abs(o.y - i.y) <= PDF_HEADER_REACH * 2))
      .map((i) => i.y);
    const inHeader = (y: number) => headerYs.some((h) => Math.abs(h - y) <= PDF_HEADER_REACH);
    const buckets = new Map<number, PdfTextItem[]>();
    for (const item of items) {
      if (!item.str.trim() || item.x + item.width > markLeft - 2 || item.x <= seqRight || inHeader(item.y)) continue;
      let nearest = 0;
      for (let a = 1; a < anchors.length; a++) {
        if (Math.abs(anchors[a].y - item.y) < Math.abs(anchors[nearest].y - item.y)) nearest = a;
      }
      if (Math.abs(anchors[nearest].y - item.y) > PDF_ROW_REACH) continue;
      if (!buckets.has(nearest)) buckets.set(nearest, []);
      buckets.get(nearest)!.push(item);
    }
    anchors.forEach((anchor, a) => {
      const cell = buckets.get(a) ?? [];
      const lines = new Map<number, PdfTextItem[]>();
      for (const it of cell) {
        const key = Array.from(lines.keys()).find((y) => Math.abs(y - it.y) <= 3) ?? it.y;
        if (!lines.has(key)) lines.set(key, []);
        lines.get(key)!.push(it);
      }
      const text = Array.from(lines.entries())
        .sort((p, q) => q[0] - p[0])
        .map(([, line]) => {
          let out = "";
          let right: number | null = null;
          for (const it of [...line].sort((p, q) => p.x - q.x)) {
            if (right !== null && it.x - right > 2 && !/^[)\]]/.test(it.str)) out += " ";
            out += it.str;
            right = it.x + it.width;
          }
          return out.trim();
        });
      const isTick = TICK_RE.test(anchor.str.trim());
      rows.push([joinWrapped(text), isTick ? "✓" : "", isTick ? "" : "X"]);
    });
  }
  return rows.length > 1 ? rows : null;
}

// ── รายการคำจากไฟล์ (ตารางกฎหมาย / ตารางทั่วไป / รายการบรรทัด) ───────────────────

export interface TermCandidate {
  term: string;
  kind: "banned" | "approved";
  replacement: string | null;
  /** เหตุผลหรือข้อกำหนดจากตาราง */
  note: string;
  /** เหตุที่ไม่ติ๊กให้ก่อน */
  warnings: string[];
  ticked: boolean;
}

const TERM_MAX_CHARS = 30;
const SHORT_TERM_MAX = 3;
const CONDITIONAL_RE = /เงื่อนไข|ยกเว้น|กรณี/;
const NON_VARIANT_RE = /เงื่อนไข|เช่น|ยกเว้น|กรณี|หรือ/;
const THAI_GAP_RE = /([฀-๿])\s+(?=[฀-๿])/g;

export const TERM_WARN = {
  short: "คำสั้นมาก อาจไปโดนคำอื่น",
  long: "เป็นข้อความยาว ไม่ใช่คำเดี่ยว",
  both: "อยู่ทั้งรายการใช้ได้และห้ามใช้",
  conditional: "ใช้ได้ตามเงื่อนไข",
  pdfApproved: "มาจาก PDF ตรวจเงื่อนไขไม่ได้",
  used: "พบในข้อมูลสินค้าหรือ Comment ของลูกค้า",
  product: "ตรงกับคำหลักของสินค้า",
} as const;

function isMark(cell: string): boolean {
  return /^[✓✔☑√xX×✗✘/]$/.test(cell.trim());
}

/** "โกรทแฟคเตอร์ (Growth Factor) (PRP)" และ "แห่งแรก/แห่งเดียว" แยกเป็นคำย่อย · ส่วนที่ยาวเกินไปคืนใน long */
export function splitTermVariants(cell: string): { terms: string[]; long: boolean } {
  const inParens: string[] = [];
  const base = cell.replace(/\(([^()]*)\)/g, (_m, inner: string) => {
    if (!NON_VARIANT_RE.test(inner)) inParens.push(inner);
    return " ";
  });
  const seen = new Set<string>();
  const terms: string[] = [];
  let long = false;
  for (const piece of [base, ...inParens].flatMap((p) => p.split(/[,，/]/))) {
    const t = piece.replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (t.length > TERM_MAX_CHARS) {
      long = true;
      continue;
    }
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(t);
  }
  return { terms, long };
}

/** ใช้คำแทนเฉพาะ "ให้ใช้คำว่า" ที่มีคำเดียวชัด ๆ — "อาจใช้คำว่า" เป็นแค่ทางเลือก ไม่แทนอัตโนมัติ */
export function replacementFromNote(note: string, term: string): string | null {
  const at = note.indexOf("ให้ใช้คำว่า");
  if (at < 0) return null;
  const quoted = note.slice(at).match(/["“”]([^"“”]+)["“”]/g) ?? [];
  if (quoted.length !== 1) return null;
  const value = quoted[0].slice(1, -1).trim();
  if (!value || value.includes("/")) return null;
  const clean = value.replace(THAI_GAP_RE, "$1");
  return clean.toLowerCase().includes(term.toLowerCase()) ? null : clean;
}

function normalizedKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

/** ติ๊กล่วงหน้าเฉพาะคำที่ไม่มีข้อสงสัย และตัดซ้ำในแต่ละฝั่ง */
function finishCandidates(list: TermCandidate[]): TermCandidate[] {
  const seen = new Set<string>();
  const unique = list.filter((c) => {
    const k = `${c.kind}:${normalizedKey(c.term)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const keysOf = (kind: TermCandidate["kind"]) => new Set(unique.filter((c) => c.kind === kind).map((c) => normalizedKey(c.term)));
  const banned = keysOf("banned");
  const approved = keysOf("approved");
  return unique.map((c) => {
    const key = normalizedKey(c.term);
    const warnings = [...c.warnings];
    if (c.term.length <= SHORT_TERM_MAX) warnings.push(TERM_WARN.short);
    if (banned.has(key) && approved.has(key)) warnings.push(TERM_WARN.both);
    return { ...c, warnings, ticked: warnings.length === 0 };
  });
}

function candidatesFromCell(cell: string, kind: TermCandidate["kind"], note: string, noteCells: string[], extra: string[]): TermCandidate[] {
  const { terms, long } = splitTermVariants(cell);
  const base = { kind, note, warnings: extra, ticked: true };
  const out: TermCandidate[] = terms.map((term) => ({
    ...base,
    term,
    replacement: kind === "banned" ? (noteCells.map((n) => replacementFromNote(n, term)).find(Boolean) ?? null) : null,
  }));
  // ข้อความที่แยกเป็นคำไม่ได้ ยังแสดงให้เห็นครบ แต่ไม่ติ๊กให้
  if (long || !terms.length) out.push({ ...base, term: cell, replacement: null, warnings: [...extra, TERM_WARN.long] });
  return out;
}

/** ตารางคอลัมน์ ข้อความ / ใช้ได้ / ห้ามใช้ — หาหัวคอลัมน์ไม่ครบคืน null */
export function parseLegalRows(rows: string[][], opts: { fromPdf?: boolean } = {}): TermCandidate[] | null {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
  let headerAt = -1;
  let termCol = -1;
  let allowedCol = -1;
  let bannedCol = -1;
  for (let i = 0; i < limit && headerAt < 0; i++) {
    const cells = rows[i].map(flatten);
    bannedCol = cells.findIndex((c) => /ไม่สามารถ|ห้ามใช้|ห้ามโฆษณา|not allowed|prohibited|banned/i.test(c));
    allowedCol = cells.findIndex((c, idx) => idx !== bannedCol && /สามารถ|ใช้ได้|^allowed|^permitted/i.test(c));
    termCol = cells.findIndex((c, idx) => idx !== bannedCol && idx !== allowedCol && /ข้อความ|คำ|term|word/i.test(c));
    if (bannedCol >= 0 && termCol >= 0) headerAt = i;
  }
  if (headerAt < 0) return null;

  const out: TermCandidate[] = [];
  for (const raw of rows.slice(headerAt + 1)) {
    const cells = raw.map(flatten);
    const cell = cells[termCol] ?? "";
    if (!cell) continue;
    const noteCells = cells.filter((c, i) => c && i > termCol && i !== bannedCol && i !== allowedCol);
    const note = noteCells.join(" · ");
    if (isMark(cells[bannedCol] ?? "")) out.push(...candidatesFromCell(cell, "banned", note, noteCells, []));
    if (allowedCol >= 0 && isMark(cells[allowedCol] ?? "")) {
      const extra: string[] = [];
      if (CONDITIONAL_RE.test(cell) || CONDITIONAL_RE.test(note)) extra.push(TERM_WARN.conditional);
      else if (opts.fromPdf) extra.push(TERM_WARN.pdfApproved);
      out.push(...candidatesFromCell(cell, "approved", note, [], extra));
    }
  }
  return out.length ? finishCandidates(out) : null;
}

/** ตาราง 3 คอลัมน์ขึ้นไปที่ไม่มีช่องถูก/ผิด: เลือกคอลัมน์คำจากหัวตาราง ไม่เจอใช้คอลัมน์ที่ค่าไม่ซ้ำมากสุด */
export function parseGenericTermRows(rows: string[][]): TermCandidate[] | null {
  const width = Math.max(0, ...rows.slice(0, 30).map((r) => filled(r).length));
  if (width < 3) return null;
  const headerAt = findHeaderRow(rows);
  const header = headerAt >= 0 ? rows[headerAt].map(flatten) : [];
  const body = rows.slice(headerAt + 1).map((r) => r.map(flatten));
  const repCol = header.findIndex((h) => /แทน|replacement|instead/i.test(h));
  // คำว่า "คำแทน" ก็มี "คำ" ต้องกันคอลัมน์คำแทนออกก่อน
  let termCol = header.findIndex((h, idx) => idx !== repCol && /คำต้องห้าม|คำที่ห้าม|ข้อความ|คำ|term|word|keyword|phrase/i.test(h));
  if (termCol < 0) {
    const colCount = Math.max(...body.map((r) => r.length));
    let best = -1;
    for (let c = 0; c < colCount; c++) {
      const values = body.map((r) => r[c] ?? "").filter(Boolean);
      const distinct = new Set(values).size;
      const shortEnough = values.filter((v) => v.length <= TERM_MAX_CHARS).length >= values.length / 2;
      if (shortEnough && distinct > best && !values.every((v) => /^[\d.]+$/.test(v))) {
        best = distinct;
        termCol = c;
      }
    }
  }
  if (termCol < 0) return null;
  const out: TermCandidate[] = [];
  for (const cells of body) {
    const cell = cells[termCol] ?? "";
    if (!cell) continue;
    const list = candidatesFromCell(cell, "banned", "", [], []);
    const rep = repCol >= 0 ? (cells[repCol] ?? "") : "";
    out.push(...list.map((c) => ({ ...c, replacement: rep || null })));
  }
  return out.length ? finishCandidates(out) : null;
}

/** ข้อความเป็นรายการคำ: บรรทัดละคำ รองรับ "คำ => คำแทน" และเลขข้อ/จุดนำหน้า */
export function linesToCandidates(text: string): TermCandidate[] {
  const out: TermCandidate[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const [term, rep] = line.split("=>").map((p) => p.trim());
    if (!term) continue;
    const warnings = term.length > TERM_MAX_CHARS ? [TERM_WARN.long] : [];
    out.push({ term, kind: "banned", replacement: rep || null, note: "", warnings, ticked: true });
  }
  return finishCandidates(out);
}

/** ใส่คำเตือนจากข้อมูลของลูกค้า — คำห้ามที่ชนสินค้าเอาติ๊กออก เพราะถ้าห้ามจริงระบบจะลบชื่อสินค้าออกจากบทความ */
export function applyClientConflicts(
  candidates: TermCandidate[],
  conflicts: { usedTerms: string[]; productKeywords: string },
): TermCandidate[] {
  const used = new Set(conflicts.usedTerms.map(normalizedKey));
  const keywords = conflicts.productKeywords
    .split(/[,\n]/)
    .map(normalizedKey)
    .filter(Boolean);
  return candidates.map((c) => {
    if (c.kind !== "banned") return c;
    const key = normalizedKey(c.term);
    const clashes: string[] = [];
    if (used.has(key)) clashes.push(TERM_WARN.used);
    if (keywords.some((k) => key.includes(k) || k.includes(key))) clashes.push(TERM_WARN.product);
    return clashes.length ? { ...c, warnings: [...c.warnings, ...clashes], ticked: false } : c;
  });
}

/** รายการเดิมมาจากการนำเข้าแบบเก่าที่อ่านผิดคอลัมน์ ("ก. => 1") */
export function looksLikeBadTermImport(existing: string): boolean {
  const lines = existing.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 5) return false;
  return lines.filter((l) => /=>\s*[\d.]+$/.test(l)).length >= lines.length / 2;
}

/** บรรทัดสำหรับช่องคำต้องห้าม — ข้ามคำที่มีอยู่แล้ว */
export function bannedLinesFrom(candidates: TermCandidate[], existing: string): string[] {
  const have = new Set(
    existing
      .split("\n")
      .map((l) => normalizedKey(l.split("=>")[0] ?? ""))
      .filter(Boolean),
  );
  return candidates
    .filter((c) => c.ticked && c.kind === "banned" && !have.has(normalizedKey(c.term)))
    .map((c) => (c.replacement ? `${c.term} => ${c.replacement}` : c.term));
}

/** บรรทัดสำหรับช่องคำที่ใช้ได้ — ข้ามคำที่มีอยู่แล้ว */
export function approvedLinesFrom(candidates: TermCandidate[], existing: string): string[] {
  const have = new Set(existing.split("\n").map(normalizedKey).filter(Boolean));
  return candidates.filter((c) => c.ticked && c.kind === "approved" && !have.has(normalizedKey(c.term))).map((c) => c.term);
}
