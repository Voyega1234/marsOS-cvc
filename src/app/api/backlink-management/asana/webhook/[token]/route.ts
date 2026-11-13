import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { decrypt, encrypt } from "@/lib/crypto";
import { getTask, resolveToken } from "@/lib/backlink-management/asana";
import { applyAsanaTask } from "@/lib/backlink-management/asana-sync";

// ถูกเรียกโดย Asana — ไม่ใช้ session; ยืนยันด้วย token ใน URL + ลายเซ็น HMAC
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token;
  if (!TOKEN_RE.test(token)) return new NextResponse(null, { status: 404 });

  // ── handshake ──
  const secret = req.headers.get("x-hook-secret");
  if (secret !== null) {
    if (secret.length < 16 || secret.length > 256) return new NextResponse(null, { status: 410 });
    let enc: string;
    try { enc = encrypt(secret); } catch { return new NextResponse(null, { status: 500 }); }
    const r = await prisma.blmAsanaConfig.updateMany({
      where: { hookToken: token, webhookState: "PENDING", pendingUntil: { gt: new Date() }, webhookSecretEnc: "" },
      data: { webhookSecretEnc: enc, webhookState: "ACTIVE", pendingUntil: null },
    });
    if (r.count !== 1) return new NextResponse(null, { status: 410 });
    return new NextResponse(null, { status: 200, headers: { "X-Hook-Secret": secret } });
  }

  // ── event ──
  const config = await prisma.blmAsanaConfig.findFirst({
    where: { hookToken: token, webhookState: "ACTIVE", webhookSecretEnc: { not: "" } },
  });
  if (!config) return new NextResponse(null, { status: 410 });

  const raw = Buffer.from(await req.arrayBuffer());
  const sig = req.headers.get("x-hook-signature") ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(sig)) return new NextResponse(null, { status: 401 });
  let hookSecret: string;
  try { hookSecret = decrypt(config.webhookSecretEnc); } catch { return new NextResponse(null, { status: 500 }); }
  const expected = crypto.createHmac("sha256", hookSecret).update(raw).digest();
  const given = Buffer.from(sig, "hex");
  if (given.length !== 32 || !crypto.timingSafeEqual(expected, given)) return new NextResponse(null, { status: 401 });

  let body: any = null;
  try { body = JSON.parse(raw.toString("utf8")); } catch { /* ว่าง = heartbeat */ }
  const events: any[] = Array.isArray(body?.events) ? body.events : [];
  if (events.length === 0) return new NextResponse(null, { status: 200 });

  const orgId = config.organizationId;
  let lastError = "";
  try {
    const actions = new Map<string, "deleted" | "changed">();
    for (const ev of events) {
      if (ev?.resource?.resource_type !== "task" || typeof ev.resource.gid !== "string") continue;
      const gid = ev.resource.gid;
      // "removed" เกิดได้ตอนย้ายงานข้าม section ด้วย — ถือเป็น "changed" แล้วให้ getTask ตัดสิน (404 = ถูกลบจริง)
      const isDel = ev.action === "deleted";
      if (!actions.has(gid) || !isDel) actions.set(gid, isDel ? "deleted" : "changed");
      if (actions.size >= 25) break;
    }
    const gids = Array.from(actions.keys());
    if (gids.length) {
      const tracked = await prisma.blmRequest.findMany({
        where: { organizationId: orgId, asanaTaskGid: { in: gids } },
        select: { asanaTaskGid: true },
      });
      const set = new Set(tracked.map((r) => r.asanaTaskGid));
      const apiToken = resolveToken(config);
      for (const gid of gids) {
        if (!set.has(gid)) continue;
        try {
          if (actions.get(gid) === "deleted") {
            await applyAsanaTask(orgId, { gid, deleted: true });
          } else if (apiToken) {
            const t = await getTask(apiToken, gid);
            await applyAsanaTask(orgId, t ?? { gid, deleted: true });
          }
        } catch (e) {
          lastError = (e instanceof Error ? e.message : "ประมวลผลเหตุการณ์ Asana ไม่สำเร็จ").slice(0, 200);
        }
      }
    }
  } catch (e) {
    lastError = (e instanceof Error ? e.message : "ประมวลผลเหตุการณ์ Asana ไม่สำเร็จ").slice(0, 200);
  }
  await prisma.blmAsanaConfig
    .update({ where: { organizationId: orgId }, data: { lastEventAt: new Date(), ...(lastError ? { lastError } : {}) } })
    .catch(() => {});
  return new NextResponse(null, { status: 200 });
}
