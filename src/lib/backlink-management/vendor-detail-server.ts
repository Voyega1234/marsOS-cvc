/**
 * ข้อมูลเสริมของคลังเว็บ (ตาราง BlmVendorDetail) ฝั่งเซิร์ฟเวอร์
 * ทุกฟังก์ชันทนได้ถ้าตารางยังไม่ถูกสร้าง (P2021): คลังเว็บเดิมต้องทำงานครบ แค่ไม่มีข้อมูลเสริม
 */
import { prisma } from "@/lib/prisma";
import { isMissingTable } from "./projects";
import { EMPTY_VENDOR_DETAIL, VENDOR_DETAIL_KEYS, type VendorDetail } from "./vendor-detail";

function pick(row: Record<string, unknown>): VendorDetail {
  const out = { ...EMPTY_VENDOR_DETAIL } as Record<string, unknown>;
  for (const k of VENDOR_DETAIL_KEYS) if (row[k] !== undefined) out[k] = row[k];
  return out as unknown as VendorDetail;
}

/** ข้อมูลเสริมของทั้งองค์กร (หรือเฉพาะ id ที่ระบุ) — available = false เมื่อยังไม่มีตาราง */
export async function loadVendorDetails(
  orgId: string,
  vendorSiteIds?: string[],
): Promise<{ available: boolean; map: Map<string, VendorDetail> }> {
  const map = new Map<string, VendorDetail>();
  try {
    const rows = await prisma.blmVendorDetail.findMany({
      where: { organizationId: orgId, ...(vendorSiteIds ? { vendorSiteId: { in: vendorSiteIds } } : {}) },
    });
    for (const r of rows) map.set(r.vendorSiteId, pick(r as unknown as Record<string, unknown>));
    return { available: true, map };
  } catch (e) {
    if (isMissingTable(e)) return { available: false, map };
    throw e;
  }
}

/** มีตารางข้อมูลเสริมแล้วหรือยัง */
export async function vendorDetailsAvailable(): Promise<boolean> {
  try {
    await prisma.blmVendorDetail.findFirst({ select: { id: true } });
    return true;
  } catch (e) {
    if (isMissingTable(e)) return false;
    throw e;
  }
}

/** บันทึกข้อมูลเสริมของ 1 เว็บ — คืน false เมื่อยังไม่มีตาราง (ข้อมูลหลักบันทึกไปแล้ว ไม่ถือว่าล้มเหลว) */
export async function saveVendorDetail(orgId: string, vendorSiteId: string, data: Partial<VendorDetail>): Promise<boolean> {
  if (Object.keys(data).length === 0) return true;
  try {
    await prisma.blmVendorDetail.upsert({
      where: { vendorSiteId },
      create: { ...EMPTY_VENDOR_DETAIL, ...data, organizationId: orgId, vendorSiteId },
      update: data,
    });
    return true;
  } catch (e) {
    if (isMissingTable(e)) return false;
    throw e;
  }
}

export async function deleteVendorDetail(orgId: string, vendorSiteId: string): Promise<void> {
  try {
    await prisma.blmVendorDetail.deleteMany({ where: { organizationId: orgId, vendorSiteId } });
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
}

/** แถวคลังเว็บ + ข้อมูลเสริม รวมเป็น object ชั้นเดียว (รูปเดียวกับ type Vendor ฝั่ง client) */
export function withDetail<T extends { id: string }>(vendor: T, map: Map<string, VendorDetail>): T & VendorDetail {
  return { ...vendor, ...(map.get(vendor.id) ?? EMPTY_VENDOR_DETAIL) };
}

export const DETAIL_MISSING_WARNING =
  'บันทึกข้อมูลหลักแล้ว แต่ข้อมูลเสริม (ราคาแยกประเภท, Rate Card ฯลฯ) ยังบันทึกไม่ได้ — ต้องรัน scripts/sql/add-blm-vendor-detail-table.sql ใน Supabase โปรเจกต์ "SEO PROJECT" ก่อน';
