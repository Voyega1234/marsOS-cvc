/**
 * seo-task-detail — parser สำหรับ field `detail` ของ SeoTask ที่มาจาก
 * POST /api/projects/[id]/seo-tasks/from-scan (ดู seo-task-spec.md §4)
 *
 * รูปแบบที่ server เขียน (เว้นบรรทัดว่างคั่นแต่ละหมวด):
 *   หน้า: https://example.com/blog/x
 *   ปัจจุบัน: "ข้อความปัจจุบัน"
 *   ปัญหา: อธิบายปัญหาสั้น ๆ
 *
 *   วิธีแก้:
 *   - ขั้นตอนที่ 1
 *   - ขั้นตอนที่ 2
 *
 *   ทางเลือก:
 *   1. ตัวเลือกที่ 1
 *   2. ตัวเลือกที่ 2
 *   3. ตัวเลือกที่ 3
 *
 *   เลือกใช้: 2
 *
 * ฟังก์ชันในไฟล์นี้เป็น pure function ล้วน ไม่มี React import
 * เพื่อให้ทั้งฝั่ง UI (TaskDrawer) และงานอื่นในอนาคตเรียกใช้ร่วมกันได้
 */

export interface ParsedTaskDetail {
  /** หัวข้อ "หน้า:" — URL ของหน้าที่งานนี้เกี่ยวข้อง */
  page?: string;
  /** หัวข้อ "ปัจจุบัน:" — ค่าที่อ่านได้จากหน้าตอนสแกน (ตัด quote ครอบออกแล้ว) */
  current?: string;
  /** หัวข้อ "ปัญหา:" */
  issue?: string;
  /** รายการบูลเล็ตใต้หัวข้อ "วิธีแก้:" (ไม่รวมเครื่องหมาย "- ") */
  fix: string[];
  /** รายการตัวเลือกใต้หัวข้อ "ทางเลือก:" (ไม่รวมเลขนำหน้า) */
  options: string[];
  /** เลขตัวเลือกที่เลือกใช้แล้ว จากบรรทัด "เลือกใช้: N" (ถ้ามี) */
  chosen?: number;
  /** ข้อความที่เหลือซึ่งไม่ตรงกับหัวข้อใด ๆ ข้างต้น — ไว้แสดงงานที่เขียนมือแบบเดิม */
  rest: string;
}

const HEADER_PAGE = /^หน้า:\s*(.*)$/;
const HEADER_CURRENT = /^ปัจจุบัน:\s*(.*)$/;
const HEADER_ISSUE = /^ปัญหา:\s*(.*)$/;
const HEADER_FIX = /^วิธีแก้:\s*$/;
const HEADER_OPTIONS = /^ทางเลือก:\s*$/;
const FIX_ITEM = /^-\s+(.*)$/;
const OPTION_ITEM = /^\d+\.\s+(.*)$/;
const CHOSEN_LINE = /^เลือกใช้:\s*(\d+)\s*$/;

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

/** parse detail ตาม format §4 — เผื่อ whitespace เกิน ทนต่อ detail เขียนมือ (ทั้งหมดตกไปที่ rest) */
export function parseTaskDetail(detail: string): ParsedTaskDetail {
  const result: ParsedTaskDetail = { fix: [], options: [], rest: "" };
  const lines = (detail ?? "").split(/\r?\n/);
  const restLines: string[] = [];
  let mode: "none" | "fix" | "options" = "none";

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      // บรรทัดว่างที่คั่นท้ายรายการ วิธีแก้/ทางเลือก ถือเป็นตัวคั่นรูปแบบ ไม่ใช่ข้อความส่วนเกิน
      if (mode !== "none") {
        mode = "none";
      } else {
        restLines.push(rawLine);
      }
      continue;
    }

    const pageMatch = line.match(HEADER_PAGE);
    if (pageMatch) {
      result.page = pageMatch[1].trim();
      mode = "none";
      continue;
    }

    const currentMatch = line.match(HEADER_CURRENT);
    if (currentMatch) {
      result.current = stripQuotes(currentMatch[1].trim());
      mode = "none";
      continue;
    }

    const issueMatch = line.match(HEADER_ISSUE);
    if (issueMatch) {
      result.issue = issueMatch[1].trim();
      mode = "none";
      continue;
    }

    if (HEADER_FIX.test(line)) {
      mode = "fix";
      continue;
    }

    if (HEADER_OPTIONS.test(line)) {
      mode = "options";
      continue;
    }

    const chosenMatch = line.match(CHOSEN_LINE);
    if (chosenMatch) {
      result.chosen = Number(chosenMatch[1]);
      mode = "none";
      continue;
    }

    if (mode === "fix") {
      const fixMatch = line.match(FIX_ITEM);
      if (fixMatch) {
        result.fix.push(fixMatch[1].trim());
        continue;
      }
      mode = "none";
    }

    if (mode === "options") {
      const optionMatch = line.match(OPTION_ITEM);
      if (optionMatch) {
        result.options.push(optionMatch[1].trim());
        continue;
      }
      mode = "none";
    }

    restLines.push(rawLine);
  }

  result.rest = restLines.join("\n").trim();
  return result;
}

/** เขียน/แทนที่บรรทัด "เลือกใช้: N" เป็นบรรทัดสุดท้ายของ detail */
export function setChosenOption(detail: string, n: number): string {
  const base = detail ?? "";
  const lines = base.split(/\r?\n/);
  const chosenLine = `เลือกใช้: ${n}`;
  const idx = lines.findIndex((l) => CHOSEN_LINE.test(l.trim()));
  if (idx >= 0) {
    lines[idx] = chosenLine;
    return lines.join("\n");
  }
  const trimmed = base.replace(/\s+$/, "");
  if (!trimmed) return chosenLine;
  return `${trimmed}\n${chosenLine}`;
}
