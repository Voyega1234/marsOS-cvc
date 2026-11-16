import { NextRequest, NextResponse } from "next/server";
import { markSheetDirty } from "@/lib/backlink-management/sheet-sync";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError, normalizeDomain } from "@/lib/backlink-management/server";
import { vendorData } from "@/lib/backlink-management/vendor-data";
import { pickDefaultPrice, vendorDetailData } from "@/lib/backlink-management/vendor-detail";
import { DETAIL_MISSING_WARNING, loadVendorDetails, saveVendorDetail, withDetail } from "@/lib/backlink-management/vendor-detail-server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") ?? "").trim();
    const status = sp.get("status") ?? "";
    const category = (sp.get("category") ?? "").trim();
    const contains = { contains: q, mode: "insensitive" as const };
    const [vendors, details] = await Promise.all([
      prisma.blmVendorSite.findMany({
        where: {
          organizationId: ctx.orgId,
          ...(status ? { status } : {}),
          ...(category ? { category } : {}),
          ...(q ? { OR: [{ domain: contains }, { notes: contains }, { category: contains }, { contactName: contains }, { contactChannel: contains }] } : {}),
        },
        orderBy: { domain: "asc" },
        take: 2000,
      }),
      loadVendorDetails(ctx.orgId),
    ]);
    return NextResponse.json({
      vendors: vendors.map((v) => withDetail(v, details.map)),
      detailsAvailable: details.available,
    });
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const b = await req.json().catch(() => ({}));
    const domain = normalizeDomain(String(b.domain ?? ""));
    if (!domain || !domain.includes(".")) return NextResponse.json({ error: "กรุณาระบุโดเมนให้ถูกต้อง" }, { status: 400 });
    const exists = await prisma.blmVendorSite.findUnique({ where: { organizationId_domain: { organizationId: ctx.orgId, domain } } });
    if (exists) return NextResponse.json({ error: `มีเว็บ ${domain} ในคลังแล้ว` }, { status: 409 });
    const detail = vendorDetailData(b);
    const base = vendorData(b);
    // ราคาเริ่มต้นเว้นว่าง = ใช้ราคาแยกประเภทตัวแรกที่มี (ฟอร์มคำขอดึงช่อง price ไปใช้)
    if (!base.price) base.price = pickDefaultPrice(detail);
    const vendor = await prisma.blmVendorSite.create({
      data: { ...(base as object), organizationId: ctx.orgId, domain, createdById: ctx.userId },
    });
    const saved = await saveVendorDetail(ctx.orgId, vendor.id, detail);
    await markSheetDirty(ctx.orgId);
    return NextResponse.json({ vendor, ...(saved ? {} : { warning: DETAIL_MISSING_WARNING }) });
  } catch (e) {
    return serverError(e);
  }
}
