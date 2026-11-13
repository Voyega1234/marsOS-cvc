import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError, normalizeDomain } from "@/lib/backlink-management/server";
import { vendorData } from "@/lib/backlink-management/vendor-data";

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
    const vendor = await prisma.blmVendorSite.update({ where: { id: cur.id }, data });
    return NextResponse.json({ vendor });
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
      return NextResponse.json({ ok: true, deleted: false, message: "มีคำขอที่อ้างอิงเว็บนี้อยู่ จึงเปลี่ยนเป็น INACTIVE แทนการลบ" });
    }
    await prisma.blmVendorSite.delete({ where: { id: cur.id } });
    return NextResponse.json({ ok: true, deleted: true, message: "ลบเว็บแล้ว" });
  } catch (e) {
    return serverError(e);
  }
}
