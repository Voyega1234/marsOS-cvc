import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError, normalizeDomain } from "@/lib/backlink-management/server";
import { vendorData } from "@/lib/backlink-management/vendor-data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") ?? "").trim();
    const status = sp.get("status") ?? "";
    const category = (sp.get("category") ?? "").trim();
    const vendors = await prisma.blmVendorSite.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(status ? { status } : {}),
        ...(category ? { category } : {}),
        ...(q ? { OR: [{ domain: { contains: q, mode: "insensitive" } }, { notes: { contains: q, mode: "insensitive" } }] } : {}),
      },
      orderBy: { domain: "asc" },
      take: 1000,
    });
    return NextResponse.json({ vendors });
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
    const vendor = await prisma.blmVendorSite.create({
      data: { ...(vendorData(b) as object), organizationId: ctx.orgId, domain, createdById: ctx.userId },
    });
    return NextResponse.json({ vendor });
  } catch (e) {
    return serverError(e);
  }
}
