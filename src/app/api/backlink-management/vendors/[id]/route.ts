import { NextRequest, NextResponse } from "next/server";
import { markSheetDirty } from "@/lib/backlink-management/sheet-sync";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError, normalizeDomain } from "@/lib/backlink-management/server";
import { vendorData } from "@/lib/backlink-management/vendor-data";
import { pickDefaultPrice, vendorDetailData } from "@/lib/backlink-management/vendor-detail";
import { DETAIL_MISSING_WARNING, deleteVendorDetail, saveVendorDetail } from "@/lib/backlink-management/vendor-detail-server";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const cur = await prisma.blmVendorSite.findFirst({ where: { id: params.id, organizationId: ctx.orgId } });
    if (!cur) return NextResponse.json({ error: "ไม่พบเว็บนี้" }, { status: 404 });
    const b = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = vendorData(b);
    if (b.domain !== undefined) {
      const domain = normalizeDomain(String(b.domain));
      if (!domain || !domain.includes(".")) return NextResponse.json({ error: "กรุณาระบุโดเมนให้ถูกต้อง" }, { status: 400 });
      if (domain !== cur.domain) {
        const dup = await prisma.blmVendorSite.findUnique({ where: { organizationId_domain: { organizationId: ctx.orgId, domain } } });
        if (dup) return NextResponse.json({ error: `มีเว็บ ${domain} ในคลังแล้ว` }, { status: 409 });
        data.domain = domain;
      }
    }
    const detail = vendorDetailData(b);
    // ราคาเริ่มต้นถูกส่งมาเป็น 0/ว่าง = ใช้ราคาแยกประเภทตัวแรกที่ส่งมาพร้อมกัน
    if (b.price !== undefined && !data.price) data.price = pickDefaultPrice(detail);
    const vendor = await prisma.blmVendorSite.update({ where: { id: cur.id }, data });
    const saved = await saveVendorDetail(ctx.orgId, cur.id, detail);
    await markSheetDirty(ctx.orgId);
    return NextResponse.json({ vendor, ...(saved ? {} : { warning: DETAIL_MISSING_WARNING }) });
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const cur = await prisma.blmVendorSite.findFirst({ where: { id: params.id, organizationId: ctx.orgId } });
    if (!cur) return NextResponse.json({ error: "ไม่พบเว็บนี้" }, { status: 404 });
    const used = await prisma.blmRequest.count({ where: { organizationId: ctx.orgId, vendorSiteId: cur.id } });
    if (used > 0) {
      await prisma.blmVendorSite.update({ where: { id: cur.id }, data: { status: "INACTIVE" } });
      await markSheetDirty(ctx.orgId);
      return NextResponse.json({ ok: true, deleted: false, message: "มีคำขอที่อ้างอิงเว็บนี้อยู่ จึงเปลี่ยนเป็น INACTIVE แทนการลบ" });
    }
    await prisma.blmVendorSite.delete({ where: { id: cur.id } });
    await deleteVendorDetail(ctx.orgId, cur.id);
    await markSheetDirty(ctx.orgId);
    return NextResponse.json({ ok: true, deleted: true, message: "ลบเว็บแล้ว" });
  } catch (e) {
    return serverError(e);
  }
}
