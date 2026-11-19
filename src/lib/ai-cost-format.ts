/** จัดรูปตัวเลขของหน้า AI Cost — USD 2 ตำแหน่ง (4 ตำแหน่งเมื่อต่ำกว่า $0.01) มีตัวคั่นหลักพัน */

export const USD_TO_THB = 33;

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd4 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

const num = (n: number | null | undefined): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

export function fmtInt(n: number | null | undefined): string {
  return int.format(num(n));
}

export function fmtUsd(n: number | null | undefined): string {
  const v = num(n);
  if (v === 0) return "$0.00";
  return v < 0.01 ? `$${usd4.format(v)}` : `$${usd2.format(v)}`;
}

export function fmtThb(usd: number | null | undefined): string {
  const baht = num(usd) * USD_TO_THB;
  return `฿${baht > 0 && baht < 1 ? usd2.format(baht) : int.format(Math.round(baht))}`;
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
