import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { listManualProjects } from "@/lib/backlink-management/projects";
import { listStoredLogos, saveProjectLogo } from "@/lib/backlink-management/project-logos-server";
import { validateClientLogoInput } from "@/lib/upload-article/client-logo";
import { buildLogoIndex, type LogoSource } from "@/lib/backlink-management/project-logos";

// โลโก้ลูกค้าสำหรับรายชื่อในหน้า Report — อ่านอย่างเดียว ไม่เรียกเว็บภายนอก
// โหลดแยกจากงบในชีท เพื่อให้รายงานขึ้นก่อนแล้วโลโก้ค่อยตามมา
export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const [system, manual, stored, uploads] = await Promise.all([
      prisma.project.findMany({
        where: { organizationId: ctx.orgId },
        select: { id: true, name: true, clientName: true, website: true, logoUrl: true },
      }),
      listManualProjects(ctx.orgId),
      listStoredLogos(ctx.orgId),
      // ดึงเฉพาะโลโก้จาก pushPrefs (JSON ก้อนใหญ่) ไม่ต้องโหลดทั้งก้อนมา parse
      prisma.$queryRaw<Array<{ name: string; website: string; logo: string | null }>>`
        SELECT "name", "website",
          substring("pushPrefs" from '"clientLogo":"(data:image/[a-z]+;base64,[A-Za-z0-9+/=]+)"') AS "logo"
        FROM "plans_seo_pipeline"."UploadClient"
        WHERE "organizationId" = ${ctx.orgId}`,
    ]);
    const sources: LogoSource[] = [
      ...system.map((p) => ({ projectId: p.id, names: [p.name, p.clientName ?? ""], logo: p.logoUrl, website: p.website })),
      ...stored.map((r) => ({ projectId: r.projectId ?? undefined, names: [r.name], logo: r.logo })),
      ...uploads.map((u) => ({ names: [u.name], logo: u.logo, website: u.website })),
      ...manual.map((p) => ({ projectId: p.id, names: [p.name, p.clientName ?? ""] })),
    ];
    return NextResponse.json(buildLogoIndex(sources), { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  const bad = () => NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad();
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || !("logo" in body)) return bad();
  const b = body as { logo?: unknown; projectId?: unknown; name?: unknown };
  const v = validateClientLogoInput(b.logo);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  if (b.projectId != null && typeof b.projectId !== "string") return bad();
  if (b.name !== undefined && typeof b.name !== "string") return bad();
  try {
    const r = await saveProjectLogo(ctx.orgId, ctx.userId, {
      projectId: (b.projectId as string | null | undefined) ?? null,
      name: b.name as string | undefined,
      logo: v.value,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, target: r.target });
  } catch (e) {
    return serverError(e);
  }
}
