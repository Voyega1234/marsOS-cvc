import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError, normalizeDomain } from "@/lib/backlink-management/server";

export const dynamic = "force-dynamic";

const MAX_LINES = 500;

export async function POST(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const b = await req.json().catch(() => ({}));
    const lines = String(b.text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return NextResponse.json({ error: "ไม่มีข้อมูล" }, { status: 400 });
    if (lines.length > MAX_LINES) return NextResponse.json({ error: `วางได้ไม่เกิน ${MAX_LINES} บรรทัดต่อครั้ง` }, { status: 400 });

    let created = 0;
    let updated = 0;
    const skipped: { line: string; reason: string }[] = [];
    const seen = new Set<string>();
    const numOrNull = (s: string | undefined) => {
      if (!s) return null;
      const n = Number(s.replace(/[,\s฿]/g, ""));
      return Number.isFinite(n) ? n : null;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // วางจาก Sheets = คั่นด้วย tab — ห้ามตัดที่ , เพราะราคาแบบ "1,500" จะแตกเป็น 2 ช่อง
      const cols = line.split(line.includes("\t") ? /\t/ : /,/).map((c) => c.trim());
      const domain = normalizeDomain(cols[0] ?? "");
      if (i === 0 && /^(domain|เว็บ|โดเมน|site)/i.test(cols[0] ?? "") ) { continue; }
      if (!domain || !domain.includes(".")) { skipped.push({ line, reason: "โดเมนไม่ถูกต้อง" }); continue; }
      if (seen.has(domain)) { skipped.push({ line, reason: "โดเมนซ้ำในรายการที่วาง" }); continue; }
      seen.add(domain);
      const price = numOrNull(cols[1]);
      const dr = numOrNull(cols[2]);
      const traffic = numOrNull(cols[3]);
      const category = (cols[4] ?? "").slice(0, 100);
      try {
        const cur = await prisma.blmVendorSite.findUnique({ where: { organizationId_domain: { organizationId: ctx.orgId, domain } } });
        if (cur) {
          await prisma.blmVendorSite.update({
            where: { id: cur.id },
            data: {
              ...(price !== null ? { price: Math.max(0, price) } : {}),
              ...(dr !== null ? { domainRating: Math.round(dr) } : {}),
              ...(traffic !== null ? { traffic: Math.round(traffic) } : {}),
              ...(category ? { category } : {}),
            },
          });
          updated++;
        } else {
          await prisma.blmVendorSite.create({
            data: {
              organizationId: ctx.orgId, domain, createdById: ctx.userId,
              price: Math.max(0, price ?? 0),
              domainRating: dr === null ? null : Math.round(dr),
              traffic: traffic === null ? null : Math.round(traffic),
              category,
            },
          });
          created++;
        }
      } catch (e) {
        skipped.push({ line, reason: e instanceof Error ? e.message.slice(0, 120) : "บันทึกไม่สำเร็จ" });
      }
    }
    return NextResponse.json({ created, updated, skipped });
  } catch (e) {
    return serverError(e);
  }
}
