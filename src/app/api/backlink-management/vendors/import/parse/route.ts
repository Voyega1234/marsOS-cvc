import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { vendorDetailsAvailable } from "@/lib/backlink-management/vendor-detail-server";
import { csvToSheet, decodeCsvBytes, parseImportSheets, type ImportSheet } from "@/lib/backlink-management/vendor-import";
import { readXlsxSheets, XlsxTooLargeError } from "@/lib/backlink-management/vendor-import-xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FILE_BYTES = 4 * 1024 * 1024; // Vercel ตัด body ที่ 4.5 MB

/** อ่านไฟล์ .xlsx / .csv แล้วคืนรายการที่จะนำเข้า (ยังไม่บันทึกอะไร) */
export async function POST(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "กรุณาเลือกไฟล์" }, { status: 400 });
    if (file.size === 0) return NextResponse.json({ error: "ไฟล์ว่าง" }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 4 MB" }, { status: 413 });
    const name = file.name.toLowerCase();

    let sheets: ImportSheet[];
    let hidden: string[] = [];
    if (name.endsWith(".xlsx")) {
      try {
        const res = await readXlsxSheets(await file.arrayBuffer());
        sheets = res.sheets;
        hidden = res.hiddenSheets;
      } catch (e) {
        if (e instanceof XlsxTooLargeError) {
          return NextResponse.json({ error: "ไฟล์ .xlsx มีข้อมูลข้างในใหญ่เกินไป (เกิน 40 MB หลังแตกไฟล์) — ลบชีตที่ไม่ใช้หรือแบ่งไฟล์แล้วลองใหม่" }, { status: 413 });
        }
        return NextResponse.json({ error: "อ่านไฟล์ .xlsx ไม่ได้ — ไฟล์อาจเสียหรือไม่ใช่ Excel จริง" }, { status: 400 });
      }
    } else if (name.endsWith(".csv")) {
      sheets = [csvToSheet(decodeCsvBytes(await file.arrayBuffer()), "")];
    } else {
      return NextResponse.json({ error: "รองรับเฉพาะไฟล์ .xlsx และ .csv" }, { status: 400 });
    }

    const parsed = parseImportSheets(sheets);
    if (parsed.rows.length === 0) {
      return NextResponse.json({ error: "ไม่พบรายการเว็บในไฟล์ — ต้องมีหัวคอลัมน์ Domain (หรือ โดเมน) ในแถวบน ๆ ของชีต" }, { status: 400 });
    }
    const [existing, detailsAvailable] = await Promise.all([
      prisma.blmVendorSite.findMany({
        where: { organizationId: ctx.orgId, domain: { in: parsed.rows.map((r) => r.domain) } },
        select: { domain: true },
      }),
      vendorDetailsAvailable(),
    ]);
    return NextResponse.json({
      ...parsed,
      ignoredSheets: [...parsed.ignoredSheets, ...hidden.map((h) => `${h} (ชีตที่ซ่อนไว้)`)],
      existing: existing.map((e) => e.domain),
      detailsAvailable,
    });
  } catch (e) {
    return serverError(e);
  }
}
