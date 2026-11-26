/** จัดรูปตัวเลขต้นทุน AI — แสดงเป็นบาท (ข้อมูลจริงเก็บเป็น USD) */

/** อัตราแลกเปลี่ยนคงที่ใช้เพื่อแสดงผลเท่านั้น — ต้องการเปลี่ยนให้แก้ที่นี่ที่เดียว */
export const USD_TO_THB = 33;

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const num = (n: number | null | undefined): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

export function fmtInt(n: number | null | undefined): string {
  return int.format(num(n));
}

/** USD → THB (ตัวเลขใน DB/API เป็น USD เสมอ) */
export function usdToThb(usd: number | null | undefined): number {
  return num(usd) * USD_TO_THB;
}

export function thbToUsd(thb: number | null | undefined): number {
  return num(thb) / USD_TO_THB;
}

/** รับค่า USD คืนสตริงบาท: 0 → ฿0, <0.01 → <฿0.01, <100 → 2 ตำแหน่ง, อื่นๆ → บาทเต็มมีตัวคั่นหลักพัน */
export function fmtThb(usd: number | null | undefined): string {
  const baht = usdToThb(usd);
  if (baht === 0) return "฿0";
  if (baht < 0.01) return "<฿0.01";
  if (baht < 100) return `฿${usd2.format(baht)}`;
  return `฿${int.format(Math.round(baht))}`;
}

export function fmtPct(part: number, total: number): string {
  if (!(total > 0)) return "0%";
  const p = (part / total) * 100;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}

/** % เปลี่ยนจากช่วงก่อน — ก่อนหน้าเป็น 0 คืน null (เทียบไม่ได้) */
export function pctChange(cur: number, prev: number): number | null {
  return prev > 0 ? ((cur - prev) / prev) * 100 : null;
}
