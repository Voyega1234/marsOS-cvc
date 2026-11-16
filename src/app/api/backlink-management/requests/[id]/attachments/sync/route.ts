/** ส่งไฟล์แนบที่ยังไม่อยู่ในงาน Asana ของคำขอ (ปุ่ม "ส่งไป Asana อีกครั้ง" และตอนเปิดหน้าคำขอ) */
import { NextRequest, NextResponse } from "next/server";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { isSameOriginRequest } from "@/lib/backlink-management/attachments";
import { findRequestRef, listAttachments, pushPendingAttachments } from "@/lib/backlink-management/attachments-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    const ref = await findRequestRef(ctx.orgId, params.id);
    if (!ref) return NextResponse.json({ error: "ไม่พบคำขอ" }, { status: 404 });
    const sent = await pushPendingAttachments(ctx.orgId, ref.id, 45_000);
    const fresh = await findRequestRef(ctx.orgId, ref.id);
    const { rows } = await listAttachments(ctx.orgId, ref.id, fresh?.asanaTaskGid ?? null, ctx);
    return NextResponse.json({
      attachments: rows, pushed: sent.pushed, failed: sent.failed, ...(sent.reason ? { reason: sent.reason } : {}),
    });
  } catch (e) {
    return serverError(e);
  }
}
