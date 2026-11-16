/** ไฟล์แนบหนึ่งไฟล์ — GET ดาวน์โหลด, DELETE ลบ (ผู้แนบหรือผู้อนุมัติ) */
import { NextRequest, NextResponse } from "next/server";
import { requireStaff, isCtx, serverError, addEvent } from "@/lib/backlink-management/server";
import { contentDisposition, isSameOriginRequest } from "@/lib/backlink-management/attachments";
import { AttachmentError, deleteAttachment, readAttachment } from "@/lib/backlink-management/attachments-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: { id: string; attachmentId: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const file = await readAttachment(ctx.orgId, params.id, params.attachmentId);
    if (!file) return NextResponse.json({ error: "ไม่พบไฟล์แนบ" }, { status: 404 });
    // ชนิดไฟล์มาจากรายการที่อนุญาตตอนอัปโหลด (ไม่มี html/svg) + ห้ามเบราว์เซอร์เดาชนิดเอง + sandbox กันรันสคริปต์
    return new NextResponse(new Uint8Array(file.data), {
      status: 200,
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.data.length),
        "Content-Disposition": contentDisposition(file.fileName),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
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
    const gone = await deleteAttachment(ctx.orgId, params.id, params.attachmentId, ctx);
    await addEvent({
      organizationId: ctx.orgId, requestId: params.id, type: "NOTE",
      note: `ลบไฟล์แนบ: ${gone.fileName}`, actorId: ctx.userId,
    }).catch(() => {});
    return NextResponse.json({ ok: true, ...(gone.asanaWarning ? { warning: gone.asanaWarning } : {}) });
  } catch (e) {
    if (e instanceof AttachmentError) return NextResponse.json({ error: e.message }, { status: e.status });
    return serverError(e);
  }
}
