/**
 * ช่วงเวลาของหน้า AI Cost / AI Jobs — อ่านจาก query string (?range=7d หรือ ?from=YYYY-MM-DD&to=YYYY-MM-DD)
 * ทุกวันคิดตามเวลาไทย (Asia/Bangkok, UTC+7 ไม่มี DST) ไม่ว่าเซิร์ฟเวอร์จะอยู่โซนไหน
 * ไฟล์นี้ไม่แตะฐานข้อมูล ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์
 */

export const AI_COST_PRESETS = ["today", "7d", "30d", "this_month", "last_month", "all"] as const;
export type AiCostPreset = (typeof AI_COST_PRESETS)[number];
export const AI_COST_DEFAULT_PRESET: AiCostPreset = "this_month";

export const AI_COST_PRESET_LABEL: Record<AiCostPreset, string> = {
  today: "วันนี้",
  "7d": "7 วัน",
  "30d": "30 วัน",
  this_month: "เดือนนี้",
  last_month: "เดือนที่แล้ว",
  all: "ทั้งหมด",
};

/** วันที่เก่าสุดที่รับจาก URL */
export const AI_COST_MIN_DATE = "2020-01-01";

export interface AiCostRange {
  /** preset ที่เลือก — "custom" = กำหนดวันเอง */
  preset: AiCostPreset | "custom";
  /** วันเริ่ม YYYY-MM-DD (เวลาไทย) — null = ไม่จำกัด */
  from: string | null;
  /** วันสิ้นสุด YYYY-MM-DD (เวลาไทย, รวมทั้งวัน) — null = ไม่จำกัด */
  to: string | null;
  /** ข้อความสั้น ๆ ไว้ต่อท้ายหัวข้อ เช่น "เดือนนี้" หรือ "01/11/2026 – 16/11/2026" */
  label: string;
}

type ParamValue = string | string[] | undefined;
const first = (v: ParamValue): string => (Array.isArray(v) ? v[0] : v) ?? "";

/** วันนี้ตามเวลาไทย รูปแบบ YYYY-MM-DD */
export function bangkokDateKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/** YYYY-MM-DD ที่เป็นวันจริงในปฏิทิน (ตัด 2026-02-31 ทิ้ง) */
export function isDateKey(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** วันแรกของเดือนที่ห่างจากเดือนของ key ไป offset เดือน */
function monthStart(key: string, offset: number): string {
  const d = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1 + offset, 1));
  return d.toISOString().slice(0, 10);
}

const dmy = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;

function presetRange(preset: AiCostPreset, today: string): AiCostRange {
  const label = preset === "7d" || preset === "30d" ? `${AI_COST_PRESET_LABEL[preset]}ล่าสุด` : AI_COST_PRESET_LABEL[preset];
  switch (preset) {
    case "today":      return { preset, from: today, to: today, label };
    case "7d":         return { preset, from: addDays(today, -6), to: today, label };
    case "30d":        return { preset, from: addDays(today, -29), to: today, label };
    case "this_month": return { preset, from: monthStart(today, 0), to: today, label };
    case "last_month": return { preset, from: monthStart(today, -1), to: addDays(monthStart(today, 0), -1), label };
    case "all":        return { preset, from: null, to: null, label };
  }
}

/**
 * แปลง query string เป็นช่วงเวลา — from/to ที่ถูกต้องชนะ range, ค่าที่อ่านไม่ออกถอยไปใช้ "เดือนนี้"
 * ใส่วันกลับด้าน (from หลัง to) จะสลับให้
 */
export function resolveAiCostRange(
  params: { range?: ParamValue; from?: ParamValue; to?: ParamValue } | undefined,
  now: Date = new Date(),
): AiCostRange {
  const today = bangkokDateKey(now);
  let from = first(params?.from);
  let to = first(params?.to);
  if (!isDateKey(from)) from = "";
  if (!isDateKey(to)) to = "";
  // ก่อน 2020 = ไม่รับ, หลังวันนี้ = ตัดเหลือวันนี้
  if (from && from < AI_COST_MIN_DATE) from = "";
  if (to && to < AI_COST_MIN_DATE) to = "";
  if (from && from > today) from = today;
  if (to && to > today) to = today;

  if (from || to) {
    if (from && to && from > to) [from, to] = [to, from];
    const label = from && to ? (from === to ? dmy(from) : `${dmy(from)} – ${dmy(to)}`) : from ? `ตั้งแต่ ${dmy(from)}` : `ถึง ${dmy(to)}`;
    return { preset: "custom", from: from || null, to: to || null, label };
  }

  const raw = first(params?.range);
  const preset = (AI_COST_PRESETS as readonly string[]).includes(raw) ? (raw as AiCostPreset) : AI_COST_DEFAULT_PRESET;
  return presetRange(preset, today);
}

/** ขอบเขต createdAt สำหรับ Prisma — undefined = ไม่กรองเวลา */
export function aiCostCreatedAtFilter(range: Pick<AiCostRange, "from" | "to">): { gte?: Date; lte?: Date } | undefined {
  if (!range.from && !range.to) return undefined;
  return {
    ...(range.from ? { gte: new Date(`${range.from}T00:00:00.000+07:00`) } : {}),
    ...(range.to ? { lte: new Date(`${range.to}T23:59:59.999+07:00`) } : {}),
  };
}

/** query string ของช่วงเวลา — ค่าเริ่มต้นคืนสตริงว่างเพื่อให้ URL สะอาด */
export function aiCostRangeQuery(sel: { preset: AiCostPreset } | { from: string; to: string }): string {
  if ("preset" in sel) return sel.preset === AI_COST_DEFAULT_PRESET ? "" : `?range=${sel.preset}`;
  const q = new URLSearchParams();
  if (sel.from) q.set("from", sel.from);
  if (sel.to) q.set("to", sel.to);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** จำนวนวัน (รวมวันแรกและวันสุดท้าย) ของช่วงที่มีทั้ง from และ to — ไม่ครบ = null */
export function aiCostRangeDays(range: Pick<AiCostRange, "from" | "to">): number | null {
  if (!range.from || !range.to) return null;
  const ms = Date.parse(`${range.to}T00:00:00.000Z`) - Date.parse(`${range.from}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/** ช่วงก่อนหน้าที่ยาวเท่ากัน (ติดกับ from) ไว้เทียบ — ช่วงที่ไม่มีวันครบสองฝั่ง = null */
export function previousAiCostRange(range: Pick<AiCostRange, "from" | "to">): { from: string; to: string } | null {
  const days = aiCostRangeDays(range);
  if (!days || !range.from) return null;
  const from = addDays(range.from, -days);
  const to = addDays(range.from, -1);
  if (!isDateKey(from) || !isDateKey(to)) return null;
  return { from, to };
}

/** ทุกวัน YYYY-MM-DD จาก from ถึง to (รวมสองฝั่ง) — ยาวเกิน max คืนอาเรย์ว่าง */
export function eachDateKey(from: string, to: string, max = 400): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > max) return [];
  }
  return out;
}
