/** ซิงก์ Asana อัตโนมัติ (เซิร์ฟเวอร์เท่านั้น) — ทุกฟังก์ชันไม่ throw ออกไปหาผู้เรียก */
import { prisma } from "@/lib/prisma";
import {
  addComment, createTask, getTask, listProjectTasks, resolveToken, updateTask, type AsanaTask,
} from "./asana";
import { addEvent } from "./server";
import { statusLabel } from "./types";

const COMPLETED_STATUSES = ["PUBLISHED", "VERIFIED", "CANCELLED", "REJECTED"];

function shortErr(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.slice(0, 200);
}

function fmtDue(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function buildTaskPayload(
  request: {
    id: string; targetUrl: string; anchorText: string; keyword: string; linkType: string;
    quotedPrice: number; budgetPeriod: string; status: string;
  },
  project: { name: string },
  vendorDomain: string,
  appUrl: string,
): { name: string; notes: string } {
  const name = `[Backlink] ${project.name} → ${vendorDomain || "ยังไม่เลือกเว็บ"}`;
  const notes = [
    `หน้าลูกค้าที่ต้องการลิงก์: ${request.targetUrl}`,
    `Anchor: ${request.anchorText || "-"}`,
    `Keyword: ${request.keyword || "-"}`,
    `ประเภทลิงก์: ${request.linkType}`,
    `ราคาที่ขอ: ${request.quotedPrice.toLocaleString("th-TH")} บาท`,
    `ตัดงบเดือน: ${request.budgetPeriod}`,
    `สถานะ: ${statusLabel(request.status)}`,
    `MarsOS id: ${request.id}`,
    appUrl ? `เปิดใน MarsOS: ${appUrl}` : "",
  ].filter(Boolean).join("\n");
  return { name, notes };
}

async function getConfig(orgId: string) {
  return prisma.blmAsanaConfig.findUnique({ where: { organizationId: orgId } });
}

export async function ensureAsanaTask(orgId: string, requestId: string): Promise<void> {
  try {
    const config = await getConfig(orgId);
    const token = resolveToken(config);
    if (!config || !token || !config.projectGid) return;
    const req = await prisma.blmRequest.findFirst({ where: { id: requestId, organizationId: orgId } });
    if (!req || req.asanaTaskGid) return;
    try {
      const project = await prisma.project.findFirst({ where: { id: req.projectId, organizationId: orgId }, select: { name: true } });
      let assigneeEmail: string | null = null;
      if (req.assigneeId) {
        const u = await prisma.user.findFirst({ where: { id: req.assigneeId, organizationId: orgId }, select: { email: true } });
        assigneeEmail = u?.email ?? null;
      }
      const { name, notes } = buildTaskPayload(req, { name: project?.name ?? "-" }, req.vendorDomain, "");
      const t = await createTask(token, {
        projectGid: config.projectGid, name, notes, assigneeEmail, dueOn: fmtDue(req.dueDate),
      });
      await prisma.blmRequest.update({
        where: { id: req.id },
        data: { asanaTaskGid: t.gid, asanaTaskUrl: t.permalink_url, asanaSyncedAt: new Date(), asanaSyncError: "" },
      });
      await addEvent({
        organizationId: orgId, requestId: req.id, type: "ASANA", source: "system",
        note: t.assigneeDropped ? "สร้างงานใน Asana แล้ว (ไม่สามารถกำหนดผู้รับผิดชอบใน Asana ได้)" : "สร้างงานใน Asana แล้ว",
      });
    } catch (e) {
      await prisma.blmRequest.update({ where: { id: req.id }, data: { asanaSyncError: shortErr(e) } }).catch(() => {});
    }
  } catch {
    /* ไม่ throw */
  }
}

export async function pushRequestChange(orgId: string, requestId: string, note: string): Promise<void> {
  try {
    const config = await getConfig(orgId);
    const token = resolveToken(config);
    if (!config || !token) return;
    const req = await prisma.blmRequest.findFirst({ where: { id: requestId, organizationId: orgId } });
    if (!req || !req.asanaTaskGid) return;
    try {
      const remote = await getTask(token, req.asanaTaskGid);
      if (!remote) {
        await prisma.blmRequest.update({
          where: { id: req.id },
          data: { asanaTaskGid: null, asanaTaskUrl: "", asanaSyncError: "งานถูกลบใน Asana" },
        });
        return;
      }
      const fields: Record<string, unknown> = {};
      const due = fmtDue(req.dueDate);
      if ((remote.due_on ?? null) !== due) fields.due_on = due;
      if (req.assigneeId) {
        const u = await prisma.user.findFirst({ where: { id: req.assigneeId, organizationId: orgId }, select: { email: true } });
        if (u?.email && (remote.assignee?.email ?? "").toLowerCase() !== u.email.toLowerCase()) fields.assignee = u.email;
      }
      const shouldComplete = COMPLETED_STATUSES.includes(req.status);
      if (!!remote.completed !== shouldComplete) fields.completed = shouldComplete;
      if (Object.keys(fields).length > 0) {
        try {
          await updateTask(token, req.asanaTaskGid, fields);
        } catch (e) {
          if (fields.assignee) { // ผู้รับผิดชอบไม่อยู่ใน workspace — ลองใหม่โดยไม่ใส่
            delete fields.assignee;
            if (Object.keys(fields).length > 0) await updateTask(token, req.asanaTaskGid, fields);
          } else throw e;
        }
      }
      if (note) await addComment(token, req.asanaTaskGid, note);
      await prisma.blmRequest.update({
        where: { id: req.id },
        data: {
          asanaSyncedAt: new Date(), asanaSyncError: "",
          ...("completed" in fields ? { asanaCompleted: shouldComplete } : {}),
        },
      });
    } catch (e) {
      await prisma.blmRequest.update({ where: { id: req.id }, data: { asanaSyncError: shortErr(e) } }).catch(() => {});
    }
  } catch {
    /* ไม่ throw */
  }
}

export async function applyAsanaTask(
  orgId: string,
  task: AsanaTask | { gid: string; deleted: true },
): Promise<void> {
  const req = await prisma.blmRequest.findFirst({ where: { organizationId: orgId, asanaTaskGid: task.gid } });
  if (!req) return;

  if ("deleted" in task) {
    await prisma.blmRequest.update({
      where: { id: req.id },
      data: { asanaTaskGid: null, asanaTaskUrl: "", asanaSyncError: "งานถูกลบใน Asana" },
    });
    await addEvent({ organizationId: orgId, requestId: req.id, type: "ASANA", source: "asana", note: "งานถูกลบใน Asana" });
    return;
  }

  const data: Record<string, unknown> = {};
  const notes: string[] = [];

  const completed = !!task.completed;
  if (completed !== req.asanaCompleted) {
    data.asanaCompleted = completed;
    notes.push(completed ? "งานใน Asana เสร็จแล้ว" : "งานใน Asana ถูกเปิดใหม่");
  }

  if (task.due_on !== undefined) {
    const newDue = task.due_on ? new Date(`${task.due_on}T12:00:00.000Z`) : null;
    if (fmtDue(newDue) !== fmtDue(req.dueDate)) {
      data.dueDate = newDue;
      notes.push(`กำหนดส่งเปลี่ยนเป็น ${task.due_on ?? "ไม่มี"}`);
    }
  }

  const email = task.assignee?.email?.toLowerCase();
  if (email) {
    const u = await prisma.user.findFirst({
      where: { organizationId: orgId, email: { equals: email, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (u && u.id !== req.assigneeId) {
      data.assigneeId = u.id;
      notes.push(`ผู้รับผิดชอบเปลี่ยนเป็น ${u.name ?? email}`);
    }
  }

  let statusChange: { from: string; to: string } | null = null;
  if (completed && (req.status === "APPROVED" || req.status === "IN_PROGRESS") && req.liveUrl) {
    data.status = "PUBLISHED";
    data.publishedAt = new Date();
    statusChange = { from: req.status, to: "PUBLISHED" };
  }
  if (task.permalink_url && task.permalink_url !== req.asanaTaskUrl) data.asanaTaskUrl = task.permalink_url;
  if (req.asanaSyncError) data.asanaSyncError = "";

  if (Object.keys(data).length === 0) return;
  data.asanaSyncedAt = new Date();
  await prisma.blmRequest.update({ where: { id: req.id }, data });

  if (statusChange) {
    await addEvent({
      organizationId: orgId, requestId: req.id, type: "STATUS", source: "asana",
      fromStatus: statusChange.from, toStatus: statusChange.to,
      note: "Asana ทำเครื่องหมายว่าเสร็จ และมี URL ที่ลิงก์อยู่แล้ว",
    });
  }
  const other = notes.filter((n) => !(statusChange && n === "งานใน Asana เสร็จแล้ว"));
  if (other.length) {
    await addEvent({ organizationId: orgId, requestId: req.id, type: "ASANA", source: "asana", note: other.join(" · ") });
  }
}

export async function refreshFromAsana(orgId: string, opts: { minIntervalMs?: number; budgetMs?: number } = {}): Promise<void> {
  const minIntervalMs = opts.minIntervalMs ?? 60_000;
  try {
    const config = await getConfig(orgId);
    const token = resolveToken(config);
    if (!config || !token || !config.projectGid) return;
    const now = new Date();
    const claim = await prisma.blmAsanaConfig.updateMany({
      where: {
        organizationId: orgId,
        OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: new Date(now.getTime() - minIntervalMs) } }],
      },
      data: { lastSyncAt: now },
    });
    if (claim.count === 0) return;

    let lastError = "";
    // หยุดเริ่มงานใหม่เมื่อใกล้ครบเวลา (ผู้เรียกรอแค่ ~5 วินาที แล้ว serverless อาจถูกพักกลางคัน)
    const stopAt = Date.now() + (opts.budgetMs ?? 4000);
    try {
      const since = config.lastSyncAt
        ? new Date(config.lastSyncAt.getTime() - 10 * 60_000)
        : new Date(now.getTime() - 30 * 86_400_000);
      const tasks = await listProjectTasks(token, config.projectGid, since.toISOString());
      if (tasks.length) {
        const tracked = await prisma.blmRequest.findMany({
          where: { organizationId: orgId, asanaTaskGid: { in: tasks.map((t) => t.gid) } },
          select: { asanaTaskGid: true },
        });
        const set = new Set(tracked.map((r) => r.asanaTaskGid));
        for (const t of tasks) {
          if (set.has(t.gid)) await applyAsanaTask(orgId, t).catch((e) => { lastError = shortErr(e); });
        }
      }
      // เฉพาะคำขอที่สร้างเกิน 2 นาที — คำขอใหม่กำลังสร้างงานอยู่ใน POST เอง (กันงานซ้ำใน Asana)
      const missing = await prisma.blmRequest.findMany({
        where: {
          organizationId: orgId, asanaTaskGid: null, status: { in: ["REQUESTED", "APPROVED", "IN_PROGRESS"] },
          createdAt: { lt: new Date(now.getTime() - 120_000) },
        },
        orderBy: { createdAt: "asc" },
        take: 10,
        select: { id: true },
      });
      for (const m of missing) {
        if (Date.now() >= stopAt) break;
        await ensureAsanaTask(orgId, m.id);
      }
    } catch (e) {
      lastError = shortErr(e);
      // ดึงรายการงานไม่สำเร็จ — คืนเวลาซิงก์เดิม เพื่อให้รอบถัดไปดึงช่วงเวลาเดิมซ้ำ ไม่ข้ามการเปลี่ยนแปลง
      await prisma.blmAsanaConfig
        .updateMany({ where: { organizationId: orgId, lastSyncAt: now }, data: { lastSyncAt: config.lastSyncAt } })
        .catch(() => {});
    }
    await prisma.blmAsanaConfig.update({ where: { organizationId: orgId }, data: { lastError } }).catch(() => {});
  } catch {
    /* ไม่ throw */
  }
}
