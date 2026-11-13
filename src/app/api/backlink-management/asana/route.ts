import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { createWebhook, deleteWebhook, getMe, getProject, resolveToken, AsanaError } from "@/lib/backlink-management/asana";
import { refreshFromAsana } from "@/lib/backlink-management/asana-sync";
import { webhookBaseUrl } from "@/lib/backlink-management/public-url";
import { isApprover } from "@/lib/backlink-management/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function view(orgId: string) {
  const c = await prisma.blmAsanaConfig.findUnique({ where: { organizationId: orgId } });
  const tokenSource = c?.tokenEnc ? "db" : (process.env.ASANA_ACCESS_TOKEN ?? "").trim() ? "env" : "none";
  return {
    tokenSource,
    projectGid: c?.projectGid ?? "",
    projectName: c?.projectName ?? "",
    webhookState: c?.webhookState ?? "NONE",
    webhookAvailable: webhookBaseUrl() !== null,
    lastSyncAt: c?.lastSyncAt ?? null,
    lastEventAt: c?.lastEventAt ?? null,
    lastError: c?.lastError ?? "",
  };
}

export async function GET() {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    return NextResponse.json(await view(ctx.orgId));
  } catch (e) {
    return serverError(e);
  }
}

function asanaMsg(e: unknown): string {
  return e instanceof AsanaError ? `Asana: ${e.message}` : e instanceof Error ? e.message : "เกิดข้อผิดพลาด";
}

export async function PUT(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  if (!isApprover(ctx.role)) return NextResponse.json({ error: "เฉพาะ ADMIN หรือ SEO Manager เท่านั้นที่ตั้งค่า Asana ได้" }, { status: 403 });
  try {
    const b = await req.json().catch(() => ({}));
    const newToken = typeof b.token === "string" ? b.token.trim() : "";
    const newProject = typeof b.projectGid === "string" ? b.projectGid.trim() : "";
    const orgId = ctx.orgId;

    let config = await prisma.blmAsanaConfig.findUnique({ where: { organizationId: orgId } });
    const patch: Record<string, unknown> = { updatedById: ctx.userId };

    if (newToken) {
      try { await getMe(newToken); } catch (e) { return NextResponse.json({ error: `Token ใช้ไม่ได้ — ${asanaMsg(e)}` }, { status: 400 }); }
      try { patch.tokenEnc = encrypt(newToken); } catch { return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า WP_ENCRYPTION_KEY บนเซิร์ฟเวอร์" }, { status: 400 }); }
    }
    const token = newToken || resolveToken(config);
    if (!token) return NextResponse.json({ error: "ยังไม่มี Asana token — กรอก token หรือให้ผู้ดูแลตั้ง ASANA_ACCESS_TOKEN บนเซิร์ฟเวอร์" }, { status: 400 });

    if (newProject) {
      try {
        const p = await getProject(token, newProject);
        patch.projectGid = p.gid;
        patch.projectName = p.name;
      } catch (e) { return NextResponse.json({ error: `เปิดโปรเจกต์ Asana ไม่ได้ — ${asanaMsg(e)}` }, { status: 400 }); }
    }

    config = await prisma.blmAsanaConfig.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, ...(patch as object) },
      update: patch,
    });

    // ลงทะเบียน webhook ใหม่ (ถ้ามี URL สาธารณะ)
    const base = webhookBaseUrl();
    if (base && config.projectGid) {
      try {
        if (config.webhookGid) {
          await deleteWebhook(token, config.webhookGid).catch(() => {});
        }
        // เช็คว่า encrypt ใช้งานได้ก่อน (handshake ต้องเก็บ secret แบบเข้ารหัส)
        try { encrypt("probe"); } catch { throw new Error("ยังไม่ได้ตั้งค่า WP_ENCRYPTION_KEY บนเซิร์ฟเวอร์ จึงเปิด webhook ไม่ได้"); }
        const hookToken = crypto.randomBytes(32).toString("base64url");
        // ต้องบันทึกลง DB ก่อนเรียก Asana เพราะ Asana ยิง handshake กลับมาระหว่างที่สร้าง webhook
        await prisma.blmAsanaConfig.update({
          where: { organizationId: orgId },
          data: { hookToken, webhookSecretEnc: "", webhookGid: "", webhookState: "PENDING", pendingUntil: new Date(Date.now() + 2 * 60_000) },
        });
        try {
          const w = await createWebhook(token, config.projectGid, `${base}/api/backlink-management/asana/webhook/${hookToken}`);
          await prisma.blmAsanaConfig.update({ where: { organizationId: orgId }, data: { webhookGid: w.gid, lastError: "" } });
        } catch (e) {
          await prisma.blmAsanaConfig.update({
            where: { organizationId: orgId },
            data: { webhookState: "NONE", hookToken: null, webhookGid: "", pendingUntil: null, lastError: `เปิด webhook ไม่สำเร็จ: ${asanaMsg(e)}`.slice(0, 300) },
          });
        }
      } catch (e) {
        await prisma.blmAsanaConfig.update({
          where: { organizationId: orgId },
          data: { webhookState: "NONE", hookToken: null, pendingUntil: null, lastError: asanaMsg(e).slice(0, 300) },
        }).catch(() => {});
      }
    }

    await refreshFromAsana(orgId, { minIntervalMs: 0 });
    return NextResponse.json(await view(orgId));
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE() {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  if (!isApprover(ctx.role)) return NextResponse.json({ error: "เฉพาะ ADMIN หรือ SEO Manager เท่านั้น" }, { status: 403 });
  try {
    const config = await prisma.blmAsanaConfig.findUnique({ where: { organizationId: ctx.orgId } });
    if (config) {
      const token = resolveToken(config);
      if (token && config.webhookGid) await deleteWebhook(token, config.webhookGid).catch(() => {});
      await prisma.blmAsanaConfig.update({
        where: { organizationId: ctx.orgId },
        data: {
          tokenEnc: "", projectGid: "", projectName: "", hookToken: null, webhookGid: "", webhookSecretEnc: "",
          webhookState: "NONE", pendingUntil: null, lastSyncAt: null, lastEventAt: null, lastError: "", updatedById: ctx.userId,
        },
      });
    }
    return NextResponse.json(await view(ctx.orgId));
  } catch (e) {
    return serverError(e);
  }
}
