/** ไฟล์แนบของคำขอ Backlink — GET รายการ, POST อัปโหลดทีละไฟล์ (multipart ช่อง "file") */
import { NextRequest, NextResponse } from "next/server";
import { requireStaff, isCtx, serverError, addEvent } from "@/lib/backlink-management/server";
import {
  MAX_FILE_BYTES, MAX_FILES_PER_REQUEST, formatBytes, isSameOriginRequest, validateUpload,
} from "@/lib/backlink-management/attachments";
import {
  AttachmentError, createAttachment, findRequestRef, getAttachmentRow, listAttachments, pushPendingAttachments,
} from "@/lib/backlink-management/attachments-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// เผื่อส่วนหัว multipart นอกเหนือจากตัวไฟล์
const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const ref = await findRequestRef(ctx.orgId, params.id);
    if (!ref) return NextResponse.json({ error: "ไม่พบคำขอ" }, { status: 404 });
    const { available, rows } = await listAttachments(ctx.orgId, ref.id, ref.asanaTaskGid, ctx);
    return NextResponse.json({
      available,
      attachments: rows,
      asanaTaskGid: ref.asanaTaskGid ?? null,
      limits: { maxBytes: MAX_FILE_BYTES, maxFiles: MAX_FILES_PER_REQUEST },
    });
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    if (!isSameOriginRequest({
      secFetchSite: req.headers.get("sec-fetch-site"),
      origin: req.headers.get("origin"),
      host: req.headers.get("host"),
    })) {
      return NextResponse.json({ error: "คำขอไม่ได้มาจากหน้า MarsOS" }, { status: 403 });
    }
    const tooBig = NextResponse.json({ error: `ไฟล์ใหญ่เกิน ${formatBytes(MAX_FILE_BYTES)}` }, { status: 413 });
    const declared = Number(req.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooBig;

    const ref = await findRequestRef(ctx.orgId, params.id);
    if (!ref) return NextResponse.json({ error: "ไม่พบคำขอ" }, { status: 404 });

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "อ่านไฟล์ที่ส่งมาไม่ได้" }, { status: 400 });
    }
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "ไม่พบไฟล์ในคำขอ" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) return tooBig;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = validateUpload({ name: file.name, bytes });
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    const created = await createAttachment({
      orgId: ctx.orgId, requestId: ref.id, userId: ctx.userId,
      fileName: check.fileName, mimeType: check.mimeType, bytes,
    });
    await addEvent({
      organizationId: ctx.orgId, requestId: ref.id, type: "NOTE",
      note: `แนบไฟล์: ${check.fileName}`, actorId: ctx.userId,
    }).catch(() => {});

    // ส่งเข้างาน Asana ทันทีถ้าคำขอมีงานอยู่แล้ว — ล้มเหลวไม่ทำให้การอัปโหลดล้ม
    let warning: string | undefined;
    if (ref.asanaTaskGid) {
      const sent = await pushPendingAttachments(ctx.orgId, ref.id, 25_000, created.id);
      if (sent.failed > 0) warning = `บันทึกไฟล์ ${check.fileName} แล้ว แต่ส่งไป Asana ไม่สำเร็จ — กด "ส่งไป Asana อีกครั้ง" ได้`;
      else if (sent.reason === "no_token") warning = `บันทึกไฟล์ ${check.fileName} แล้ว แต่ยังไม่ได้ส่งไป Asana — ยังไม่ได้ตั้ง Asana token`;
    }
    // อ่านรหัสงานอีกครั้ง: งานอาจถูกสร้าง/ล้างระหว่างที่อัปโหลด
    const fresh = await findRequestRef(ctx.orgId, ref.id);
    const attachment = await getAttachmentRow(ctx.orgId, ref.id, created.id, fresh?.asanaTaskGid ?? null, ctx);
    if (!attachment) return NextResponse.json({ error: "ไฟล์ถูกลบไปแล้ว" }, { status: 409 });
    return NextResponse.json({ attachment, ...(warning ? { warning } : {}) });
  } catch (e) {
    if (e instanceof AttachmentError) return NextResponse.json({ error: e.message }, { status: e.status });
    return serverError(e);
  }
}
