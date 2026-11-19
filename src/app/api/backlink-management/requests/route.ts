import { NextRequest, NextResponse } from "next/server";
import { markSheetDirty } from "@/lib/backlink-management/sheet-sync";
import { prisma } from "@/lib/prisma";
import { findProject, isMissingTable } from "@/lib/backlink-management/projects";
import { requireStaff, isCtx, serverError, sleep, parseDateOnly } from "@/lib/backlink-management/server";
import { ensureAsanaTask, refreshFromAsana } from "@/lib/backlink-management/asana-sync";
import { getProject, resolveToken } from "@/lib/backlink-management/asana";
import { currentPeriod, isValidPeriod, round2 } from "@/lib/backlink-management/budget";
import { enrichRows, enrichOne } from "@/lib/backlink-management/requests-server";
import { isHttpUrl } from "@/lib/backlink-management/workflow";
import { LINK_TYPES } from "@/lib/backlink-management/types";
import { cleanVendorDomain, quotaNoteLine, withQuotaNote } from "@/lib/backlink-management/quota-request";
import { googleSheetsPort } from "@/lib/backlink-management/quota-sheets-port";
import {
  QuotaError, claimRequestQuota, planRequestQuota, refreshRequestQuota, requestQuotaClaimError, writeRequestQuota,
  type QuotaDeps, type RequestQuotaBooking,
} from "@/lib/backlink-management/quota-server";
import { readConfirmOverwrite } from "@/lib/backlink-management/quota-write";
import { quotaFail } from "@/lib/backlink-management/quota-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    await Promise.race([refreshFromAsana(ctx.orgId), sleep(5000)]);
    const sp = req.nextUrl.searchParams;
    const projectId = sp.get("projectId") ?? "";
    const period = sp.get("period") ?? "";
    const status = sp.get("status") ?? "";
    const q = (sp.get("q") ?? "").trim();
    const rows = await prisma.blmRequest.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(projectId ? { projectId } : {}),
        ...(isValidPeriod(period) ? { budgetPeriod: period } : {}),
        ...(status ? { status } : {}),
        ...(q
          ? {
              OR: [
                { vendorDomain: { contains: q, mode: "insensitive" } },
                { targetUrl: { contains: q, mode: "insensitive" } },
                { anchorText: { contains: q, mode: "insensitive" } },
                { keyword: { contains: q, mode: "insensitive" } },
                { liveUrl: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return NextResponse.json({ requests: await enrichRows(ctx.orgId, rows) });
  } catch (e) {
    return serverError(e);
  }
}

/** เขียนชีทไม่สำเร็จหลังสร้างคำขอ + จองช่องแล้ว: ลบทั้งหมดทิ้ง ไม่ให้เหลือคำขอที่อ้างช่องโควต้าที่ไม่มีจริง */
async function undoQuotaRequest(orgId: string, requestId: string, claimId: string): Promise<void> {
  await prisma.blmQuotaReservation.deleteMany({ where: { id: claimId, organizationId: orgId } }).catch(() => {});
  await prisma.blmRequestAsana.deleteMany({ where: { organizationId: orgId, requestId } }).catch(() => {});
  await prisma.blmRequestEvent.deleteMany({ where: { organizationId: orgId, requestId } }).catch(() => {});
  await prisma.blmRequest.deleteMany({ where: { id: requestId, organizationId: orgId } }).catch(() => {});
}

export async function POST(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const b = await req.json().catch(() => ({}));
    const project = await findProject(ctx.orgId, String(b.projectId ?? ""));
    if (!project) return NextResponse.json({ error: "ไม่พบโปรเจกต์" }, { status: 400 });
    if (!isHttpUrl(b.targetUrl)) return NextResponse.json({ error: "URL หน้าลูกค้าต้องขึ้นต้นด้วย http:// หรือ https://" }, { status: 400 });

    let vendorSiteId: string | null = null;
    let vendorDomain = "";
    let vendorPrice = 0;
    let vendorLinkType: string | null = null;
    if (b.vendorSiteId) {
      const v = await prisma.blmVendorSite.findFirst({ where: { id: String(b.vendorSiteId), organizationId: ctx.orgId } });
      if (!v) return NextResponse.json({ error: "ไม่พบเว็บในคลัง" }, { status: 400 });
      vendorSiteId = v.id; vendorDomain = v.domain; vendorPrice = v.price; vendorLinkType = v.linkType;
    } else if (b.vendorDomain) {
      // Site picked from a quota package (not from the vendor library): keep only its name.
      vendorDomain = cleanVendorDomain(b.vendorDomain);
    }
    // เลือก "ช่องว่าง" ของแพ็กเกจโควต้า = ระบบจองช่องให้ตอนส่งคำขอ (คำสั่งเจ้าของ 2026-11-17)
    // รับจาก browser แค่ packageId — ลูกค้า โปรเจกต์ ผู้จอง สถานะ และช่อง ระบบกำหนดเอง
    const quotaPackageId = b.quota && typeof b.quota === "object" && typeof b.quota.packageId === "string" ? b.quota.packageId.trim() : "";
    if (quotaPackageId && vendorSiteId) {
      return NextResponse.json({ error: "เลือกเว็บจากคลัง หรือจากโควต้า อย่างใดอย่างหนึ่ง" }, { status: 400 });
    }
    let assigneeId: string | null = null;
    if (b.assigneeId) {
      const u = await prisma.user.findFirst({ where: { id: String(b.assigneeId), organizationId: ctx.orgId }, select: { id: true } });
      if (!u) return NextResponse.json({ error: "ไม่พบผู้รับผิดชอบ" }, { status: 400 });
      assigneeId = u.id;
    }
    const period = b.budgetPeriod ? String(b.budgetPeriod) : currentPeriod();
    if (!isValidPeriod(period)) return NextResponse.json({ error: "เดือนที่ตัดงบไม่ถูกต้อง" }, { status: 400 });
    const priceGiven = !(b.quotedPrice === undefined || b.quotedPrice === null || b.quotedPrice === "");
    let quoted = priceGiven ? Number(b.quotedPrice) : vendorPrice;
    if (!Number.isFinite(quoted) || quoted < 0) return NextResponse.json({ error: "ราคาไม่ถูกต้อง" }, { status: 400 });
    const linkType = LINK_TYPES.includes(b.linkType) ? String(b.linkType) : vendorLinkType ?? "dofollow";
    const due = b.dueDate ? parseDateOnly(b.dueDate) : null;
    if (b.dueDate && !due) return NextResponse.json({ error: "วันที่กำหนดส่งไม่ถูกต้อง" }, { status: 400 });

    // โปรเจกต์ Asana เฉพาะคำขอ (ไม่ใส่/ตรงกับค่าเริ่มต้น = ใช้ค่าเริ่มต้น) — ตรวจให้ครบก่อนสร้างคำขอ
    let asanaTarget: { gid: string; name: string } | null = null;
    const wantGid = typeof b.asanaProjectGid === "string" ? b.asanaProjectGid.trim() : "";
    if (!wantGid) {
      // ตั้งค่า Asana เป็น "ทุกโปรเจกต์" (ไม่มีค่าเริ่มต้น) = คำขอต้องระบุโปรเจกต์เอง ไม่งั้นงานไม่ไปถึง Asana
      const config = await prisma.blmAsanaConfig.findUnique({ where: { organizationId: ctx.orgId } });
      if (resolveToken(config) && !config?.projectGid) {
        return NextResponse.json({ error: "เลือกโปรเจกต์ Asana ก่อน — ระบบไม่ได้ล็อกโปรเจกต์เริ่มต้น" }, { status: 400 });
      }
    } else {
      const config = await prisma.blmAsanaConfig.findUnique({ where: { organizationId: ctx.orgId } });
      if (wantGid !== (config?.projectGid ?? "")) {
        if (!/^\d{1,32}$/.test(wantGid)) return NextResponse.json({ error: "รหัสโปรเจกต์ Asana ไม่ถูกต้อง" }, { status: 400 });
        const token = resolveToken(config);
        if (!token) return NextResponse.json({ error: "ยังไม่ได้เชื่อม Asana" }, { status: 400 });
        try {
          await prisma.blmRequestAsana.findFirst({ where: { organizationId: ctx.orgId }, select: { id: true } });
        } catch (e) {
          if (isMissingTable(e)) {
            return NextResponse.json({
              error: "ยังไม่ได้สร้างตารางสำหรับเลือกโปรเจกต์ Asana — ให้ผู้ดูแลรัน scripts/sql/add-blm-quota-asana-tables.sql ใน Supabase",
              tableMissing: true,
            }, { status: 503 });
          }
          throw e;
        }
        try {
          const p = await getProject(token, wantGid);
          asanaTarget = { gid: wantGid, name: String(p?.name ?? "").slice(0, 300) };
        } catch {
          return NextResponse.json({ error: "เปิดโปรเจกต์ Asana นี้ไม่ได้ ตรวจสิทธิ์ของ token" }, { status: 400 });
        }
      }
    }

    // วางแผนจองโควต้าก่อนสร้างคำขอ (อ่านชีทอย่างเดียว) — จองไม่ได้ / ต้องยืนยันเขียนทับ = ตอบกลับเลย ยังไม่มีอะไรถูกสร้าง
    const quotaDeps: QuotaDeps | null = quotaPackageId
      ? { port: googleSheetsPort(), confirmOverwrite: readConfirmOverwrite(b.confirmOverwrite) }
      : null;
    let quotaPlan: RequestQuotaBooking | null = null;
    let notes = String(b.notes ?? "").trim().slice(0, 3000);
    let createdNote = "สร้างคำขอ";
    if (quotaDeps) {
      quotaPlan = await planRequestQuota(ctx, { packageId: quotaPackageId, project, website: vendorDomain }, quotaDeps);
      vendorDomain = cleanVendorDomain(quotaPlan.website) || vendorDomain;
      if (!priceGiven && quotaPlan.pricePerLink !== null && quotaPlan.pricePerLink >= 0) quoted = quotaPlan.pricePerLink;
      // หมายเหตุของคำขอบอกช่องจริงที่ระบบจองให้ (ทับบรรทัด [โควต้า] ที่ฟอร์มใส่มา)
      const line = quotaNoteLine({
        website: quotaPlan.website, vendorName: quotaPlan.vendorName,
        sourceTitle: quotaPlan.sourceTitle, tabTitle: quotaPlan.tabTitle, slotIndex: quotaPlan.slotIndex,
      });
      notes = withQuotaNote(notes.slice(0, 2800), line).slice(0, 3000);
      createdNote = `สร้างคำขอ · จองโควต้า ${quotaPlan.website || quotaPlan.vendorName} ช่องที่ ${quotaPlan.slotIndex + 1}`.slice(0, 500);
    }

    // สร้างคำขอ + ประวัติ + โปรเจกต์ Asana ที่เลือก (+ จองช่องโควต้า) ในธุรกรรมเดียว — ถ้าขั้นไหนพลาด จะไม่เหลือคำขอที่ไปผิดโปรเจกต์
    // ช่องโควต้าชนกับคนอื่น (unique) = ธุรกรรมถูกยกเลิกทั้งก้อน ไม่มีคำขอค้าง
    const target = asanaTarget;
    const plan = quotaPlan;
    let claimId = "";
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.blmRequest.create({
        data: {
          organizationId: ctx.orgId,
          projectId: project.id,
          vendorSiteId, vendorDomain,
          targetUrl: String(b.targetUrl).trim(),
          anchorText: String(b.anchorText ?? "").trim().slice(0, 300),
          keyword: String(b.keyword ?? "").trim().slice(0, 300),
          linkType,
          quotedPrice: round2(quoted),
          budgetPeriod: period,
          status: "REQUESTED",
          requestedById: ctx.userId,
          assigneeId,
          dueDate: due,
          notes,
        },
      });
      await tx.blmRequestEvent.create({
        data: {
          organizationId: ctx.orgId, requestId: created.id, type: "CREATED", fromStatus: "", toStatus: "REQUESTED",
          amount: created.quotedPrice, note: createdNote, source: "user", actorId: ctx.userId,
        },
      });
      if (target) {
        await tx.blmRequestAsana.create({
          data: { organizationId: ctx.orgId, requestId: created.id, projectGid: target.gid, projectName: target.name },
        });
      }
      if (plan) claimId = await claimRequestQuota(tx, ctx, plan, { id: created.id, targetUrl: created.targetUrl });
      return created;
    }).catch((e) => { throw plan ? requestQuotaClaimError(e) : e; });

    // เขียนช่องลงชีท — พัง = ลบคำขอ + แถวจองทิ้ง แล้วตอบ error (ผู้ใช้กดส่งใหม่ได้)
    let quotaWarning: string | undefined;
    if (plan && quotaDeps) {
      try {
        quotaWarning = await writeRequestQuota(plan, quotaDeps);
      } catch (e) {
        await undoQuotaRequest(ctx.orgId, row.id, claimId);
        throw e;
      }
      const stale = await refreshRequestQuota(ctx, plan, quotaDeps);
      quotaWarning = [quotaWarning, stale].filter(Boolean).join(" · ") || undefined;
    }
    await ensureAsanaTask(ctx.orgId, row.id);
    await markSheetDirty(ctx.orgId);
    return NextResponse.json({ request: await enrichOne(ctx.orgId, row.id), ...(quotaWarning ? { quotaWarning } : {}) });
  } catch (e) {
    // QuotaError (จองไม่ได้ / ต้องยืนยันเขียนทับ) ตอบแบบเดียวกับหน้า Quota ; error อื่นไป serverError ตามเดิม
    return e instanceof QuotaError ? quotaFail(e) : serverError(e);
  }
}
