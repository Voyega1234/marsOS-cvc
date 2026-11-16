/**
 * ข้อมูลเสริมของเว็บในคลัง (ตาราง BlmVendorDetail) — ไฟล์บริสุทธิ์ ใช้ได้ทั้ง client และ server
 * แยกจาก BlmVendorSite เพื่อไม่ต้องแก้ตารางเดิม: ถ้าตารางเสริมยังไม่ถูกสร้าง คลังเว็บเดิมยังทำงานครบ
 */
import { safeHttpUrl } from "./domain";

export interface VendorDetail {
  language: string;
  urlRating: number | null;
  priceBacklink: number | null;
  pricePublisherWeb: number | null;
  pricePublisherWebFb: number | null;
  priceCvcWeb: number | null;
  priceCvcWebFb: number | null;
  pricePr: number | null;
  priceNote: string;
  expiration: string;
  rateCardUrl: string;
  dataStatus: string; // "" | UPDATED | OUTDATED
  refId: string;
}

export type PriceKey = "priceBacklink" | "pricePublisherWeb" | "pricePublisherWebFb" | "priceCvcWeb" | "priceCvcWebFb" | "pricePr";

/** ลำดับการแสดงผล = ลำดับคอลัมน์ในชีตต้นทางของทีม (ใช้ชื่อเดิมของทีม) */
export const PRICE_TYPES: { key: PriceKey; label: string }[] = [
  { key: "priceBacklink", label: "Only Backlink" },
  { key: "pricePublisherWeb", label: "Publisher write WEB" },
  { key: "pricePublisherWebFb", label: "Publisher write WEB+FB" },
  { key: "priceCvcWeb", label: "CVC write WEB" },
  { key: "priceCvcWebFb", label: "CVC write WEB+FB" },
  { key: "pricePr", label: "PR" },
];

/** ราคาเริ่มต้นของเว็บ (ช่อง price ที่ฟอร์มคำขอดึงไปใช้) = ราคาแรกที่มีค่าตามลำดับนี้ */
export const DEFAULT_PRICE_ORDER: PriceKey[] = [
  "priceBacklink", "priceCvcWeb", "pricePublisherWeb", "priceCvcWebFb", "pricePublisherWebFb", "pricePr",
];

export const DATA_STATUSES = ["", "UPDATED", "OUTDATED"] as const;
export const DATA_STATUS_LABEL: Record<string, string> = { "": "ไม่ระบุ", UPDATED: "ข้อมูลล่าสุด", OUTDATED: "ข้อมูลเก่า" };

export const EMPTY_VENDOR_DETAIL: VendorDetail = {
  language: "", urlRating: null,
  priceBacklink: null, pricePublisherWeb: null, pricePublisherWebFb: null, priceCvcWeb: null, priceCvcWebFb: null, pricePr: null,
  priceNote: "", expiration: "", rateCardUrl: "", dataStatus: "", refId: "",
};

export const VENDOR_DETAIL_KEYS = Object.keys(EMPTY_VENDOR_DETAIL) as (keyof VendorDetail)[];

export function pickDefaultPrice(d: Partial<VendorDetail>): number {
  for (const k of DEFAULT_PRICE_ORDER) {
    const v = d[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

/** แปลง body เป็นฟิลด์ของตารางเสริม — คืนเฉพาะ key ที่ส่งมา (PATCH บางช่องจะไม่ล้างช่องอื่น) */
export function vendorDetailData(b: Record<string, unknown>): Partial<VendorDetail> {
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const d: Partial<VendorDetail> = {};
  if (b.language !== undefined) d.language = str(b.language, 20);
  if (b.urlRating !== undefined) { const n = num(b.urlRating); d.urlRating = n === null ? null : Math.min(100, n); }
  for (const { key } of PRICE_TYPES) if (b[key] !== undefined) d[key] = num(b[key]);
  if (b.priceNote !== undefined) d.priceNote = str(b.priceNote, 500);
  if (b.expiration !== undefined) d.expiration = str(b.expiration, 300);
  if (b.rateCardUrl !== undefined) d.rateCardUrl = safeHttpUrl(b.rateCardUrl);
  if (b.dataStatus !== undefined) d.dataStatus = (DATA_STATUSES as readonly string[]).includes(String(b.dataStatus)) ? String(b.dataStatus) : "";
  if (b.refId !== undefined) d.refId = str(typeof b.refId === "number" ? String(b.refId) : b.refId, 50);
  return d;
}

/** มีข้อมูลเสริมจริงอย่างน้อย 1 ช่อง (ใช้ตัดสินว่าต้องสร้างแถวเสริมไหม) */
export function hasDetailValue(d: Partial<VendorDetail>): boolean {
  return VENDOR_DETAIL_KEYS.some((k) => { const v = d[k]; return v !== undefined && v !== null && v !== ""; });
}
