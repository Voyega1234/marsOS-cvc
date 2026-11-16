import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { listManualProjects } from "@/lib/backlink-management/projects";
import { buildLogoIndex, type LogoSource } from "@/lib/backlink-management/project-logos";

// โลโก้ลูกค้าสำหรับรายชื่อในหน้า Report — อ่านอย่างเดียว ไม่เรียกเว็บภายนอก
// โหลดแยกจากงบในชีท เพื่อให้รายงานขึ้นก่อนแล้วโลโก้ค่อยตามมา
export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const [system, manual, uploads] = await Promise.all([
      prisma.project.findMany({
        where: { organizationId: ctx.orgId },
        select: { id: true, name: true, clientName: true, website: true, logoUrl: true },
      }),
      listManualProjects(ctx.orgId),
      // ดึงเฉพาะโลโก้จาก pushPrefs (JSON ก้อนใหญ่) ไม่ต้องโหลดทั้งก้อนมา parse
      prisma.$queryRaw<Array<{ name: string; website: string; logo: string | null }>>`
        SELECT "name", "website",
          substring("pushPrefs" from '"clientLogo":"(data:image/[a-z]+;base64,[A-Za-z0-9+/=]+)"') AS "logo"
        FROM "plans_seo_pipeline"."UploadClient"
        WHERE "organizationId" = ${ctx.orgId}`,
    ]);
    const sources: LogoSource[] = [
      ...system.map((p) => ({ projectId: p.id, names: [p.name, p.clientName ?? ""], logo: p.logoUrl, website: p.website })),
      ...uploads.map((u) => ({ names: [u.name], logo: u.logo, website: u.website })),
      ...manual.map((p) => ({ projectId: p.id, names: [p.name, p.clientName ?? ""] })),
    ];
    return NextResponse.json(buildLogoIndex(sources), { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (e) {
    return serverError(e);
  }
}
