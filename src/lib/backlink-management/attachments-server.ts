/**
 * ไฟล์แนบของคำขอ Backlink ฝั่งเซิร์ฟเวอร์ — ตาราง BlmAttachment (ข้อมูลกำกับ) + BlmAttachmentBlob (ตัวไฟล์)
 * กฎ:
 * - ทุกคำสั่งกรองด้วย organizationId เสมอ
 * - ตัวไฟล์ (bytea) อ่านได้จาก readAttachment ที่เดียว การอ่านรายการไม่แตะตาราง blob
 * - ตารางยังไม่ถูกสร้างบน production ได้ (scripts/sql/add-blm-attachment-table.sql) — ทุกฟังก์ชันต้องทนกรณีนั้น
 */
import { prisma } from "@/lib/prisma";
import { AsanaError, deleteTaskAttachment, resolveToken, uploadTaskAttachment, uploadTaskLinkAttachment } from "./asana";
import {
  LINK_MIME, MAX_FILES_PER_REQUEST, ORG_QUOTA_BYTES, asanaFileState, formatBytes, isImageMime, isLinkMime,
  type AttachmentRow,
} from "./attachments";
import { isApprover } from "./types";

export const MISSING_STORAGE_MESSAGE =
  "ยังไม่เปิดใช้ไฟล์แนบ — ต้องรัน scripts/sql/add-blm-attachment-table.sql ใน Supabase โปรเจกต์ SEO PROJECT ก่อน";

/** ตาราง (P2021) หรือคอลัมน์ (P2022) ของไฟล์แนบยังไม่มีในฐานข้อมูล */
export function isMissingStorage(e: unknown): boolean {
  const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  return code === "P2021" || code === "P2022";
}

export class AttachmentError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "AttachmentError";
  }
}

export interface Viewer { userId: string; role: string }

const META_SELECT = {
  id: true, fileName: true, mimeType: true, sizeBytes: true, uploadedById: true,
  asanaAttachmentGid: true, asanaPushedTaskGid: true, asanaSyncError: true, createdAt: true,
} as const;

interface MetaRow {
  id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedById: string;
  asanaAttachmentGid: string; asanaPushedTaskGid: string; asanaSyncError: string; createdAt: Date;
}

function toRow(
  m: MetaRow, taskGid: string | null, names: Map<string, string>, viewer: Viewer, linkUrl?: string,
): AttachmentRow {
  const state = asanaFileState(m, taskGid);
  return {
    id: m.id,
    fileName: m.fileName,
    mimeType: m.mimeType,
    sizeBytes: m.sizeBytes,
    isImage: isImageMime(m.mimeType),
    uploadedById: m.uploadedById,
    uploadedByName: names.get(m.uploadedById) ?? "",
    createdAt: m.createdAt.toISOString(),
    asana: state,
    asanaError: state === "error" ? m.asanaSyncError : "",
    canDelete: m.uploadedById === viewer.userId || isApprover(viewer.role),
    ...(isLinkMime(m.mimeType) ? { linkUrl: linkUrl ?? "" } : {}),
  };
}

/** URL ของแถวลิงก์ (อ่านตาราง blob เฉพาะแถวลิงก์) */
async function linkUrls(orgId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const blobs = await prisma.blmAttachmentBlob.findMany({
    where: { organizationId: orgId, id: { in: ids } },
    select: { id: true, data: true },
  });
  return new Map(blobs.map((b) => [b.id, Buffer.from(b.data).toString("utf8")]));
}

async function userNames(orgId: string, ids: string[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (uniq.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { organizationId: orgId, id: { in: uniq } },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u.name ?? u.email ?? ""]));
}

/** คำขอของ org นี้ (null = ไม่มี) */
export async function findRequestRef(orgId: string, requestId: string) {
  return prisma.blmRequest.findFirst({
    where: { id: requestId, organizationId: orgId },
    select: { id: true, asanaTaskGid: true },
  });
}

export async function listAttachments(
  orgId: string, requestId: string, taskGid: string | null, viewer: Viewer,
): Promise<{ available: boolean; rows: AttachmentRow[] }> {
  try {
    const metas = await prisma.blmAttachment.findMany({
      where: { organizationId: orgId, requestId },
      orderBy: { createdAt: "asc" },
      select: META_SELECT,
    });
    const names = await userNames(orgId, metas.map((m) => m.uploadedById));
    const urls = await linkUrls(orgId, metas.filter((m) => isLinkMime(m.mimeType)).map((m) => m.id));
    return { available: true, rows: metas.map((m) => toRow(m, taskGid, names, viewer, urls.get(m.id))) };
  } catch (e) {
    if (isMissingStorage(e)) return { available: false, rows: [] };
    throw e;
  }
}

/** แถวเดียว หลังอัปโหลดหรือส่ง Asana */
export async function getAttachmentRow(
  orgId: string, requestId: string, id: string, taskGid: string | null, viewer: Viewer,
): Promise<AttachmentRow | null> {
  const m = await prisma.blmAttachment.findFirst({ where: { id, organizationId: orgId, requestId }, select: META_SELECT });
  if (!m) return null;
  const urls = isLinkMime(m.mimeType) ? await linkUrls(orgId, [m.id]) : new Map<string, string>();
  return toRow(m, taskGid, await userNames(orgId, [m.uploadedById]), viewer, urls.get(m.id));
}

/** บันทึกลิงก์ (ผ่าน normalizeAttachmentLink แล้วเท่านั้น) — ขนาด 0 ไม่กินโควตาไบต์ แต่นับรวมในเพดานจำนวนต่อคำขอ */
export async function createLinkAttachment(input: {
  orgId: string; requestId: string; userId: string; fileName: string; url: string;
}): Promise<{ id: string }> {
  const { orgId, requestId } = input;
  try {
    return await prisma.$transaction(async (tx) => {
      const lockKey = `blm-attachment:${orgId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const req = await tx.blmRequest.findFirst({ where: { id: requestId, organizationId: orgId }, select: { id: true } });
      if (!req) throw new AttachmentError(404, "ไม่พบคำขอ");
      const count = await tx.blmAttachment.count({ where: { organizationId: orgId, requestId } });
      if (count >= MAX_FILES_PER_REQUEST) {
        throw new AttachmentError(409, `แนบได้ไม่เกิน ${MAX_FILES_PER_REQUEST} รายการต่อคำขอ — ลบรายการเดิมก่อน`);
      }
      const meta = await tx.blmAttachment.create({
        data: {
          organizationId: orgId, requestId, fileName: input.fileName, mimeType: LINK_MIME,
          sizeBytes: 0, uploadedById: input.userId,
        },
        select: { id: true },
      });
      await tx.blmAttachmentBlob.create({
        data: { id: meta.id, organizationId: orgId, data: Buffer.from(input.url, "utf8") },
        select: { id: true },
      });
      return { id: meta.id };
    }, { timeout: 20_000, maxWait: 5_000 });
  } catch (e) {
    if (isMissingStorage(e)) throw new AttachmentError(503, MISSING_STORAGE_MESSAGE);
    throw e;
  }
}

/**
 * บันทึกไฟล์ (ผ่าน validateUpload แล้วเท่านั้น) — ตรวจจำนวนต่อคำขอและโควตารวมของ org ใน transaction เดียว
 * ล็อกระดับ org กันอัปโหลดพร้อมกันทะลุเพดาน
 */
export async function createAttachment(input: {
  orgId: string; requestId: string; userId: string; fileName: string; mimeType: string; bytes: Uint8Array;
}): Promise<{ id: string }> {
  const { orgId, requestId } = input;
  const size = input.bytes.length;
  try {
    return await prisma.$transaction(async (tx) => {
      const lockKey = `blm-attachment:${orgId}`;
      // $executeRaw: ฟังก์ชันคืน void ซึ่ง $queryRaw แปลงค่าไม่ได้
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const req = await tx.blmRequest.findFirst({ where: { id: requestId, organizationId: orgId }, select: { id: true } });
      if (!req) throw new AttachmentError(404, "ไม่พบคำขอ");
      const count = await tx.blmAttachment.count({ where: { organizationId: orgId, requestId } });
      if (count >= MAX_FILES_PER_REQUEST) {
        throw new AttachmentError(409, `แนบได้ไม่เกิน ${MAX_FILES_PER_REQUEST} ไฟล์ต่อคำขอ — ลบไฟล์เดิมก่อน`);
      }
      const used = await tx.blmAttachment.aggregate({ where: { organizationId: orgId }, _sum: { sizeBytes: true } });
      if ((used._sum.sizeBytes ?? 0) + size > ORG_QUOTA_BYTES) {
        throw new AttachmentError(409, `พื้นที่ไฟล์แนบเต็ม (${formatBytes(ORG_QUOTA_BYTES)}) — ลบไฟล์เก่าก่อน`);
      }
      const meta = await tx.blmAttachment.create({
        data: {
          organizationId: orgId, requestId, fileName: input.fileName, mimeType: input.mimeType,
          sizeBytes: size, uploadedById: input.userId,
        },
        select: { id: true },
      });
      await tx.blmAttachmentBlob.create({
        data: { id: meta.id, organizationId: orgId, data: Buffer.from(input.bytes) },
        select: { id: true },
      });
      return { id: meta.id };
    }, { timeout: 20_000, maxWait: 5_000 });
  } catch (e) {
    if (isMissingStorage(e)) throw new AttachmentError(503, MISSING_STORAGE_MESSAGE);
    throw e;
  }
}

/** ตัวไฟล์สำหรับดาวน์โหลด — จุดเดียวที่อ่านตาราง blob */
export async function readAttachment(orgId: string, requestId: string, id: string): Promise<{
  fileName: string; mimeType: string; data: Buffer;
} | null> {
  try {
    const meta = await prisma.blmAttachment.findFirst({
      where: { id, organizationId: orgId, requestId },
      select: { id: true, fileName: true, mimeType: true },
    });
    if (!meta) return null;
    const blob = await prisma.blmAttachmentBlob.findFirst({ where: { id: meta.id, organizationId: orgId }, select: { data: true } });
    if (!blob) return null;
    return { fileName: meta.fileName, mimeType: meta.mimeType, data: Buffer.from(blob.data) };
  } catch (e) {
    if (isMissingStorage(e)) return null;
    throw e;
  }
}

async function orgToken(orgId: string): Promise<string | null> {
  const config = await prisma.blmAsanaConfig.findUnique({ where: { organizationId: orgId } });
  return resolveToken(config);
}

/** ลบไฟล์เดียว (ผู้แนบหรือผู้อนุมัติ) — ลบใน Asana ด้วยถ้าเคยส่ง โดยใช้รหัสจากแถวของเราเองเท่านั้น */
export async function deleteAttachment(
  orgId: string, requestId: string, id: string, viewer: Viewer,
): Promise<{ fileName: string; asanaWarning?: string }> {
  let meta: { id: string; fileName: string; uploadedById: string; asanaAttachmentGid: string } | null;
  try {
    meta = await prisma.blmAttachment.findFirst({
      where: { id, organizationId: orgId, requestId },
      select: { id: true, fileName: true, uploadedById: true, asanaAttachmentGid: true },
    });
  } catch (e) {
    if (isMissingStorage(e)) throw new AttachmentError(503, MISSING_STORAGE_MESSAGE);
    throw e;
  }
  if (!meta) throw new AttachmentError(404, "ไม่พบไฟล์แนบ");
  if (meta.uploadedById !== viewer.userId && !isApprover(viewer.role)) {
    throw new AttachmentError(403, "ลบได้เฉพาะผู้แนบไฟล์หรือผู้อนุมัติ");
  }
  await prisma.$transaction([
    prisma.blmAttachmentBlob.deleteMany({ where: { id: meta.id, organizationId: orgId } }),
    prisma.blmAttachment.deleteMany({ where: { id: meta.id, organizationId: orgId } }),
  ]);
  // ลบใน Asana ไม่ได้ ไม่ถือว่าล้มเหลว (ไฟล์ในระบบเราถูกลบแล้ว) — แต่ต้องบอกผู้ใช้ว่าไฟล์ยังค้างอยู่ในงาน Asana
  let asanaWarning: string | undefined;
  if (meta.asanaAttachmentGid) {
    const stillInAsana = `ลบไฟล์ ${meta.fileName} ออกจาก MarsOS แล้ว แต่ลบในงาน Asana ไม่สำเร็จ — ต้องลบในงาน Asana เอง`;
    try {
      const token = await orgToken(orgId);
      if (token) await deleteTaskAttachment(token, meta.asanaAttachmentGid);
      else asanaWarning = stillInAsana;
    } catch {
      asanaWarning = stillInAsana; // deleteTaskAttachment ถือว่า 404 (ไม่อยู่ใน Asana แล้ว) คือสำเร็จ
    }
  }
  return { fileName: meta.fileName, ...(asanaWarning ? { asanaWarning } : {}) };
}

/** ลบไฟล์แนบทั้งหมดของคำขอ (เรียกหลังลบคำขอ) — ไม่ throw */
export async function deleteRequestAttachments(orgId: string, requestId: string): Promise<void> {
  try {
    const metas = await prisma.blmAttachment.findMany({ where: { organizationId: orgId, requestId }, select: { id: true } });
    if (metas.length === 0) return;
    const ids = metas.map((m) => m.id);
    await prisma.$transaction([
      prisma.blmAttachmentBlob.deleteMany({ where: { organizationId: orgId, id: { in: ids } } }),
      prisma.blmAttachment.deleteMany({ where: { organizationId: orgId, id: { in: ids } } }),
    ]);
  } catch {
    /* ตารางยังไม่มี หรือฐานข้อมูลมีปัญหา — การลบคำขอสำเร็จไปแล้ว ไม่ย้อน */
  }
}

const CLAIM_STALE_MS = 3 * 60_000;
const MIN_BUDGET_MS = 5_000;

function shortErr(e: unknown): string {
  if (e instanceof AsanaError && e.status === 403) {
    return "Asana ไม่อนุญาตให้แนบไฟล์ — ตรวจว่า token มีสิทธิ์ attachments:write และเข้าถึงงานนี้ได้";
  }
  const m = e instanceof Error ? e.message : String(e);
  return m.slice(0, 200);
}

/** เหตุที่ไม่ได้ลองส่งเลย: คำขอยังไม่มีงาน Asana หรือยังไม่ได้ตั้ง Asana token */
export type PushSkipReason = "no_task" | "no_token";
export interface PushResult { pushed: number; failed: number; reason?: PushSkipReason }

/**
 * ส่งไฟล์ที่ยังไม่อยู่ในงาน Asana ปัจจุบันของคำขอ — ไม่ throw
 * จองแถวก่อนส่ง (asanaPushStartedAt) กันสองคำสั่งส่งไฟล์เดียวกันซ้ำ การจองหมดอายุเองใน 3 นาที
 */
export async function pushPendingAttachments(
  orgId: string, requestId: string, budgetMs: number, firstId?: string,
): Promise<PushResult> {
  const out: PushResult = { pushed: 0, failed: 0 };
  const deadline = Date.now() + budgetMs;
  try {
    const req = await findRequestRef(orgId, requestId);
    const taskGid = req?.asanaTaskGid;
    if (!taskGid) { out.reason = "no_task"; return out; }
    const token = await orgToken(orgId);
    if (!token) { out.reason = "no_token"; return out; }
    const pending = await prisma.blmAttachment.findMany({
      where: { organizationId: orgId, requestId, NOT: { asanaPushedTaskGid: taskGid } },
      orderBy: { createdAt: "asc" },
      select: { id: true, fileName: true, mimeType: true },
    });
    if (firstId) pending.sort((a, b) => Number(b.id === firstId) - Number(a.id === firstId));

    for (const file of pending) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_BUDGET_MS) break;
      const now = new Date();
      const claim = await prisma.blmAttachment.updateMany({
        where: {
          id: file.id, organizationId: orgId,
          NOT: { asanaPushedTaskGid: taskGid },
          OR: [{ asanaPushStartedAt: null }, { asanaPushStartedAt: { lt: new Date(now.getTime() - CLAIM_STALE_MS) } }],
        },
        data: { asanaPushStartedAt: now },
      });
      if (claim.count !== 1) continue; // อีกคำสั่งกำลังส่งอยู่ หรือส่งไปแล้ว

      // ไฟล์ที่ขึ้น Asana แล้วแต่ยังจดลงฐานข้อมูลไม่สำเร็จ — ถ้าจดไม่ได้ต้องลบออกจาก Asana กันไฟล์ซ้ำตอนส่งรอบถัดไป
      let unrecordedGid = "";
      try {
        const blob = await prisma.blmAttachmentBlob.findFirst({ where: { id: file.id, organizationId: orgId }, select: { data: true } });
        if (!blob) throw new Error("ไม่พบตัวไฟล์ในฐานข้อมูล");
        const timeoutMs = Math.min(20_000, deadline - Date.now());
        const sent = isLinkMime(file.mimeType)
          ? await uploadTaskLinkAttachment(token, {
              taskGid, url: Buffer.from(blob.data).toString("utf8"), name: file.fileName, timeoutMs,
            })
          : await uploadTaskAttachment(token, {
              taskGid, fileName: file.fileName, mimeType: file.mimeType, data: blob.data, timeoutMs,
            });
        unrecordedGid = sent.gid;
        const record = () => prisma.blmAttachment.updateMany({
          where: { id: file.id, organizationId: orgId },
          data: { asanaAttachmentGid: sent.gid, asanaPushedTaskGid: taskGid, asanaPushStartedAt: null, asanaSyncError: "" },
        });
        let saved: { count: number };
        try {
          saved = await record();
        } catch {
          await new Promise((r) => setTimeout(r, 500));
          saved = await record(); // ลองจดอีกครั้งเดียว
        }
        if (saved.count === 0) {
          // ไฟล์ถูกลบระหว่างส่ง — เก็บกวาดฝั่ง Asana
          await deleteTaskAttachment(token, sent.gid).catch(() => {});
          unrecordedGid = "";
          continue;
        }
        unrecordedGid = "";
        out.pushed++;
      } catch (e) {
        out.failed++;
        if (unrecordedGid) await deleteTaskAttachment(token, unrecordedGid).catch(() => {});
        await prisma.blmAttachment.updateMany({
          where: { id: file.id, organizationId: orgId },
          data: { asanaPushStartedAt: null, asanaSyncError: shortErr(e) },
        }).catch(() => {});
      }
    }
  } catch {
    /* ไม่ throw — ไฟล์ยังอยู่ในระบบเรา ส่งใหม่ได้จากปุ่มในหน้าคำขอ */
  }
  return out;
}
