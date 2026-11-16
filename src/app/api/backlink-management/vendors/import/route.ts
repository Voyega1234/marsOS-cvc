import { NextRequest, NextResponse } from "next/server";
import { looksLikeDomain, normalizeDomain, safeHttpUrl } from "@/lib/backlink-management/domain";
import { markSheetDirty } from "@/lib/backlink-management/sheet-sync";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { vendorData } from "@/lib/backlink-management/vendor-data";
import { EMPTY_VENDOR_DETAIL, hasDetailValue, pickDefaultPrice, vendorDetailData, type VendorDetail } from "@/lib/backlink-management/vendor-detail";
import { loadVendorDetails, saveVendorDetail, vendorDetailsAvailable } from "@/lib/backlink-management/vendor-detail-server";
import { MAX_IMPORT_ROWS } from "@/lib/backlink-management/vendor-import";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface CleanRow {
  domain: string;
  base: Record<string, unknown>;
  detail: Partial<VendorDetail>;
  /** หมวดเดาจากชื่อชีต / ราคาเริ่มต้นคำนวณจากราคาแยกประเภท — โหมดอัปเดตไม่ใช้ทับค่าที่ตั้งเอง */
  categoryInferred: boolean;
  priceInferred: boolean;
}

/** ตัดช่องว่างออก: โหมดอัปเดตเขียนทับเฉพาะช่องที่ไฟล์มีค่า ช่องที่ไฟล์ว่างคงค่าเดิม */
function nonEmpty<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== "" && v !== null && v !== undefined && v !== 0) out[k] = v;
  return out as Partial<T>;
}

async function inChunks<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

/** บันทึกรายการจากหน้าตรวจไฟล์ — ทุกแถวถูกตรวจและตัดความยาวใหม่ที่นี่ ไม่เชื่อค่าที่ client ส่งมา */
export async function POST(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const b = await req.json().catch(() => ({}));
    const onExisting: "skip" | "update" = b.onExisting === "update" ? "update" : "skip";
    const input: unknown[] = Array.isArray(b.rows) ? b.rows : [];
    if (input.length === 0) return NextResponse.json({ error: "ไม่มีรายการให้นำเข้า" }, { status: 400 });
    if (input.length > MAX_IMPORT_ROWS) return NextResponse.json({ error: `นำเข้าได้ไม่เกิน ${MAX_IMPORT_ROWS.toLocaleString()} เว็บต่อครั้ง` }, { status: 400 });

    const clean = new Map<string, CleanRow>();
    let invalid = 0;
    for (const raw of input) {
      if (typeof raw !== "object" || raw === null) { invalid++; continue; }
      const r = raw as Record<string, unknown>;
      const domain = normalizeDomain(String(r.domain ?? ""));
      if (!looksLikeDomain(domain) || domain.length > 253) { invalid++; continue; }
      if (clean.has(domain)) continue;
      const detail = vendorDetailData(r);
      const hasPrice = Number(r.price) > 0;
      // linkType / status: vendorData รับเฉพาะค่าที่อยู่ในรายการที่อนุญาต นอกนั้นทิ้ง (ใช้ค่าเริ่มต้นของตาราง)
      const base = vendorData({
        siteUrl: safeHttpUrl(r.siteUrl, 500), category: r.category, domainRating: r.domainRating, traffic: r.traffic,
        contactName: r.contactName, contactChannel: r.contactChannel, notes: r.notes,
        price: hasPrice ? r.price : pickDefaultPrice(detail),
        linkType: r.linkType, status: r.status,
      });
      if (typeof base.domainRating === "number" && (base.domainRating < 0 || base.domainRating > 100)) base.domainRating = null;
      if (typeof base.traffic === "number" && (base.traffic < 0 || base.traffic > 2_000_000_000)) base.traffic = null;
      clean.set(domain, { domain, base, detail, categoryInferred: r.categoryInferred === true, priceInferred: r.priceInferred === true || !hasPrice });
    }
    const rows = Array.from(clean.values());
    if (rows.length === 0) return NextResponse.json({ error: "ไม่มีโดเมนที่ถูกต้องในรายการ" }, { status: 400 });

    const existing = await prisma.blmVendorSite.findMany({
      where: { organizationId: ctx.orgId, domain: { in: rows.map((r) => r.domain) } },
      select: { id: true, domain: true, category: true, price: true },
    });
    const existingOf = new Map(existing.map((e) => [e.domain, e]));
    const fresh = rows.filter((r) => !existingOf.has(r.domain));
    const dupes = rows.filter((r) => existingOf.has(r.domain));
    const updating = onExisting === "update" && dupes.length > 0;

    // เช็คตารางข้อมูลเสริมก่อนเขียนอะไร: ถ้ายังไม่มี บันทึกเฉพาะข้อมูลหลักและแจ้งกลับ
    const freshWithDetail = fresh.filter((r) => hasDetailValue(r.detail));
    const detailsOk = freshWithDetail.length || updating ? await vendorDetailsAvailable() : true;
    let detailsMissing = false;

    // 1) เว็บใหม่: ข้อมูลหลัก + ข้อมูลเสริมใน transaction เดียว — พลาดกลางทางต้องไม่เหลือเว็บที่ไม่มีข้อมูลเสริม
    //    (ถ้าเหลือ การนำเข้าซ้ำแบบ "ข้ามเว็บที่มีแล้ว" จะไม่มีวันเติมให้)
    let created = 0;
    if (fresh.length) {
      const siteRows = fresh.map((r) => ({ ...(r.base as object), organizationId: ctx.orgId, domain: r.domain, createdById: ctx.userId }));
      if (!detailsOk) {
        created = (await prisma.blmVendorSite.createMany({ data: siteRows, skipDuplicates: true })).count;
        if (freshWithDetail.length) detailsMissing = true;
      } else {
        created = await prisma.$transaction(async (tx) => {
          const res = await tx.blmVendorSite.createMany({ data: siteRows, skipDuplicates: true });
          if (freshWithDetail.length) {
            const made = await tx.blmVendorSite.findMany({
              where: { organizationId: ctx.orgId, domain: { in: freshWithDetail.map((r) => r.domain) } },
              select: { id: true, domain: true },
            });
            const idOf = new Map(made.map((m) => [m.domain, m.id]));
            const details = freshWithDetail
              .filter((r) => idOf.has(r.domain))
              .map((r) => ({ ...EMPTY_VENDOR_DETAIL, ...r.detail, organizationId: ctx.orgId, vendorSiteId: idOf.get(r.domain)! }));
            if (details.length) await tx.blmVendorDetail.createMany({ data: details, skipDuplicates: true });
          }
          return res.count;
        }, { maxWait: 10_000, timeout: 30_000 });
      }
    }

    // 2) เว็บที่มีอยู่แล้ว: ข้าม (ค่าเริ่มต้น) หรืออัปเดตเฉพาะช่องที่ไฟล์มีค่า (ทำซ้ำได้ ผลเท่าเดิม)
    let updated = 0;
    if (updating) {
      const oldDetails = detailsOk
        ? (await loadVendorDetails(ctx.orgId, dupes.map((r) => existingOf.get(r.domain)!.id))).map
        : new Map<string, VendorDetail>();
      if (!detailsOk && dupes.some((r) => hasDetailValue(r.detail))) detailsMissing = true;
      await inChunks(dupes, 10, async (r) => {
        const cur = existingOf.get(r.domain)!;
        const base = nonEmpty(r.base);
        // หมวดที่เดาจากชื่อชีต ไม่ทับหมวดที่เว็บมีอยู่แล้ว
        if (r.categoryInferred && cur.category) delete base.category;
        // ราคาเริ่มต้นที่คำนวณมา ทับได้เฉพาะเมื่อราคาเดิมก็เป็นค่าที่คำนวณมา (เท่ากับราคาแยกประเภทตัวแรกของข้อมูลเดิม)
        // ราคาที่คนตั้งเองคงไว้
        if (r.priceInferred && (cur.price ?? 0) > 0) {
          const old = oldDetails.get(cur.id);
          if (!old || pickDefaultPrice(old) !== cur.price) delete base.price;
        }
        if (Object.keys(base).length) await prisma.blmVendorSite.update({ where: { id: cur.id }, data: base });
        if (detailsOk) await saveVendorDetail(ctx.orgId, cur.id, nonEmpty(r.detail as Record<string, unknown>) as Partial<VendorDetail>);
        updated++;
      });
    }

    if (created || updated) await markSheetDirty(ctx.orgId);
    return NextResponse.json({
      created,
      updated,
      skipped: (onExisting === "skip" ? dupes.length : 0) + (fresh.length - created) + invalid,
      detailsMissing,
    });
  } catch (e) {
    return serverError(e);
  }
}
