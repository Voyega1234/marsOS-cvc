import { prisma } from "@/lib/prisma";
import type { LeadStatus } from "@/lib/line-tracking/enums";
import { enqueueForLead } from "./conversionQueueService";
import type { Lead } from "@prisma/client";
import { createdAtFilter, type ResolvedRange } from "@/lib/line-tracking/date-range";
import { activeChannelKey, ALL_CHANNELS, channelGroupLabel } from "./channelService";
import { isAutoPaidProject } from "./autoPaidProjects";
import type { ChatFilter } from "./leadFilters";

const PURCHASE_STATUSES = new Set<LeadStatus>(["WON", "PAID"]);

/**
 * Change a lead's status: write history, set purchase fields if applicable,
 * then run the conversion-rule processor (queues events).
 */
export async function changeLeadStatus(
  leadId: string,
  newStatus: LeadStatus,
  opts: { changedBy?: string; note?: string } = {}
): Promise<Lead> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { project: { select: { name: true } } } });
  // KOWA has no WON: every closed deal is PAID (one purchase conversion, not two).
  if (newStatus === "WON" && isAutoPaidProject(lead.project)) newStatus = "PAID";
  if (lead.status === newStatus) return lead;

  const data: Record<string, unknown> = { status: newStatus };
  if (PURCHASE_STATUSES.has(newStatus) && !lead.purchasedAt) {
    data.purchasedAt = new Date();
    data.purchaseId = lead.purchaseId || `ord_${lead.id.slice(-8)}`;
  }

  const updated = await prisma.lead.update({ where: { id: leadId }, data });

  await prisma.leadStatusHistory.create({
    data: {
      leadId,
      oldStatus: lead.status,
      newStatus,
      changedBy: opts.changedBy ?? "Agency Admin",
      note: opts.note,
    },
  });

  await enqueueForLead(updated);
  return updated;
}

/** Create a lead from a LINE add / click, or return the existing one. */
export async function upsertLeadFromClick(params: {
  projectId: string;
  lineUserId?: string | null;
  clickId?: string | null;
  displayName?: string | null;
  defaultValue: number;
  currency: string;
}): Promise<{ lead: Lead; created: boolean }> {
  // De-dupe by lineUser within the project.
  if (params.lineUserId) {
    const existing = await prisma.lead.findFirst({
      where: { projectId: params.projectId, lineUserId: params.lineUserId },
    });
    if (existing) return { lead: existing, created: false };
  }

  let click = params.clickId
    ? await prisma.adClick.findUnique({ where: { clickId: params.clickId } })
    : null;

  // LIFF / LINE-Login entry points stamp the user's click on the LineUser row
  // BEFORE the follow event arrives — prefer that exact click (1:1 per person)
  // over the time-window guess below. Purely additive: only fills a click that
  // would otherwise fall back to window matching or Direct.
  if (!click && params.lineUserId) {
    const lu = await prisma.lineUser.findUnique({ where: { id: params.lineUserId } });
    const rememberedId = lu?.latestClickId ?? lu?.firstClickId;
    if (rememberedId) {
      const used = await prisma.lead.findFirst({
        where: { projectId: params.projectId, clickId: rememberedId },
      });
      if (!used) {
        click = await prisma.adClick.findUnique({ where: { clickId: rememberedId } });
      }
    }
  }

  // No explicit click (e.g. webhook follow) → attribute to the most recent
  // Add-LINE click for this project so the lead gets a real channel (not Direct).
  // Prefer someone who actually clicked the Add-LINE button, within 3h; else the
  // most recent click within 30m. Skip clicks already used by another lead.
  if (!click) {
    const pools = [
      // 1) คนที่ "กดปุ่มไปต่อ LINE" จริง ๆ ภายใน 3 ชม. — ตัวเลือกที่ดีที่สุด
      () =>
        prisma.adClick.findMany({
          where: {
            projectId: params.projectId,
            lineClickedAt: { not: null },
            createdAt: { gte: new Date(Date.now() - 3 * 3600 * 1000) },
          },
          orderBy: { lineClickedAt: "desc" },
          take: 20,
        }),
      // 2) ถอยไปคลิกใดก็ได้ใน 30 นาที — หยาบกว่า แต่ดีกว่าตกไปเป็น Direct
      () =>
        prisma.adClick.findMany({
          where: {
            projectId: params.projectId,
            createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
    ];

    // ของเดิมถอยไปกลุ่ม 2 เฉพาะตอนกลุ่ม 1 "ว่างเปล่า" เท่านั้น ถ้ากลุ่ม 1 มีคน
    // แต่ถูก lead อื่นจองไปหมดแล้ว จะเลิกหาทันทีแล้วกลายเป็น Direct ทั้งที่ยังมี
    // ตัวเลือกใน 30 นาที — เดิมแทบไม่เจอเพราะกลุ่ม 1 ว่างตลอด (ไม่มีใครประทับ
    // lineClickedAt ให้) พอ /line/start เริ่มประทับแล้วเคสนี้จะเกิดจริง จึงต้อง
    // ไล่ต่อจนกว่าจะเจอคลิกที่ยังไม่มีใครจอง
    for (const loadPool of pools) {
      const pool = await loadPool();
      if (pool.length === 0) continue;
      // One lookup for the whole pool (was one per click): which of these clicks already
      // belong to a lead. The first click in pool order that is still free wins, as before.
      const taken = await prisma.lead.findMany({
        where: { projectId: params.projectId, clickId: { in: pool.map((c) => c.clickId) } },
        select: { clickId: true },
      });
      const used = new Set(taken.map((l) => l.clickId));
      click = pool.find((c) => !used.has(c.clickId)) ?? null;
      if (click) break;
    }
  }

  // Lead inherits the click's channel; a LINE add with no click = Direct.
  const channelGroup = click?.channelGroup ?? "Direct";
  const channel = click?.channel ?? "line / add-friend";

  // Webhook events for one person often arrive together (follow + first message, or LINE
  // Login + follow) and each ran the check above before either had created the lead, so
  // the person got two leads and two generate_lead conversions. Serialize the
  // check-and-create per LINE user with a transaction-scoped advisory lock: the second
  // caller waits, re-checks and returns the lead the first one created.
  const result = await prisma.$transaction(async (tx) => {
    if (params.lineUserId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lead:${params.projectId}:${params.lineUserId}`}))`;
      const existing = await tx.lead.findFirst({
        where: { projectId: params.projectId, lineUserId: params.lineUserId },
      });
      if (existing) return { lead: existing, created: false };
    }
    const lead = await tx.lead.create({
      data: {
        projectId: params.projectId,
        lineUserId: params.lineUserId ?? undefined,
        clickId: params.clickId ?? click?.clickId ?? undefined,
        displayName: params.displayName ?? undefined,
        source: click?.source,
        campaign: click?.campaign,
        adset: click?.adset,
        content: click?.content,
        keyword: click?.keyword,
        gclid: click?.gclid,
        fbclid: click?.fbclid,
        ttclid: click?.ttclid,
        msclkid: click?.msclkid,
        twclid: click?.twclid,
        scclid: click?.scclid,
        gaClientId: click?.gaClientId,
        channel,
        channelGroup,
        value: params.defaultValue,
        currency: params.currency,
        status: "NEW",
      },
    });
    return { lead, created: true };
  // Room to wait for a pooled connection and for a concurrent event holding the lock.
  }, { maxWait: 10000, timeout: 15000 });
  if (!result.created) return result;
  const lead = result.lead;

  await prisma.leadStatusHistory.create({
    data: { leadId: lead.id, newStatus: "NEW", changedBy: "System", note: "Lead created from LINE add" },
  });

  // Run NEW-status rule (GA4 generate_lead enabled by default).
  await enqueueForLead(lead);

  return { lead, created: true };
}

export interface LeadFilter {
  q?: string;
  range?: ResolvedRange;
  /** channel group เดียว เช่น "Paid Search" — ไม่ส่ง / "all" = ไม่กรอง */
  channel?: string;
  /** สถานะ lead เดียว เช่น "QUALIFIED" — ไม่ส่ง = ทุกสถานะ */
  status?: string;
  /** กรองตามการทัก — ดู CHAT_FILTERS */
  chat?: ChatFilter;
}

/**
 * where ของตาราง lead ที่ทุกหน้า/ทุก export ใช้ร่วมกัน — สร้างที่เดียวเพื่อให้ตัวเลข
 * บนหน้าจอ กับไฟล์ที่ export ออกไป มาจากเงื่อนไขเดียวกันเสมอ
 *
 * `skipChannel` ใช้ตอนนับจำนวนต่อ channel: ชิปแต่ละอันต้องนับจากผลลัพธ์ที่ผ่าน
 * ตัวกรองอื่นแล้ว แต่ยังไม่โดนตัวกรอง channel ตัดทิ้ง ไม่งั้นชิปที่ไม่ได้เลือกจะเป็น 0 หมด
 */
export function leadWhere(projectId: string, opts: LeadFilter = {}, skipChannel = false) {
  const q = opts.q?.trim();
  const dateFilter = createdAtFilter(opts.range);
  const byMessage = opts.chat === "recent";
  const createdAt = byMessage ? undefined : dateFilter;
  const channel = activeChannelKey({ channel: opts.channel });
  const chatAnd =
    opts.chat === "added"
      ? [{ OR: [{ lineUserId: null }, { lineUser: { is: { lastMessageAt: null } } }] }]
      : opts.chat === "messaged" || byMessage
        ? [{ lineUser: { is: { lastMessageAt: byMessage && dateFilter ? dateFilter : { not: null } } } }]
        : [];
  const channelAnd =
    skipChannel || channel === ALL_CHANNELS || channel !== "Direct"
      ? []
      : [{ OR: [{ channelGroup: "Direct" }, { channelGroup: null }] }];
  const and = [...chatAnd, ...channelAnd];
  return {
    projectId,
    ...(createdAt ? { createdAt } : {}),
    ...(opts.status ? { status: opts.status } : {}),
    // ค้นหาชื่อไลน์ — เซลส์มักจำได้แค่ชื่อที่โชว์ในแชต ไม่ใช่ชื่อจริงที่กรอกไว้
    ...(q
      ? {
          OR: [
            { displayName: { contains: q, mode: "insensitive" as const } },
            { fullName: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q } },
            { lineUser: { is: { displayName: { contains: q, mode: "insensitive" as const } } } },
            { lineUser: { is: { lineUserId: { contains: q } } } },
          ],
        }
      : {}),
    // ใช้ AND ห่อไว้ ไม่ใช้ OR ตรง ๆ เพราะช่อง OR ด้านบนถูกจองโดยคำค้นแล้ว
    // lead เก่าที่ channelGroup ยังเป็น null ตารางแสดงเป็น "Direct" → กรอง Direct ต้องรวม null ด้วย
    ...(skipChannel || channel === ALL_CHANNELS || channel === "Direct" ? {} : { channelGroup: channel }),
    ...(and.length ? { AND: and } : {}),
  };
}

export function listLeads(projectId: string, opts: LeadFilter = {}) {
  return prisma.lead.findMany({
    where: leadWhere(projectId, opts),
    orderBy: { createdAt: "desc" },
    include: {
      // Only the fields the Leads page reads; the page shows the latest event only.
      lineUser: { select: { displayName: true, friendStatus: true, lastMessageAt: true, blockedAt: true } },
      conversionEvents: { orderBy: { createdAt: "desc" }, take: 1, select: { eventName: true, platform: true } },
    },
  });
}

/** จำนวน lead ต่อสถานะ (ผ่านตัวกรองอื่นแล้ว แต่ไม่โดนตัวกรองสถานะ) — ทำชิปตัวกรองสถานะ */
export async function listLeadStatuses(projectId: string, opts: LeadFilter = {}) {
  const rows = await prisma.lead.groupBy({
    by: ["status"],
    where: leadWhere(projectId, { ...opts, status: undefined }),
    _count: true,
  });
  return new Map(rows.map((r) => [r.status, r._count]));
}

export interface ChannelOption {
  key: string;
  label: string;
  count: number;
}

/**
 * รายการ channel ที่ "มีอยู่จริง" ของโปรเจกต์นี้ พร้อมจำนวน lead — เอาไว้ทำชิปตัวกรอง
 * ไม่ hardcode รายชื่อ เพราะแต่ละลูกค้ายิงคนละช่องทาง จะได้เห็นเฉพาะอันที่ตัวเองมี
 */
export async function listLeadChannels(
  projectId: string,
  opts: LeadFilter = {},
): Promise<{ options: ChannelOption[]; total: number }> {
  const rows = await prisma.lead.groupBy({
    by: ["channelGroup"],
    where: leadWhere(projectId, opts, true),
    _count: true,
  });
  const counts = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const key = r.channelGroup ?? "Direct";
    counts.set(key, (counts.get(key) ?? 0) + r._count);
    total += r._count;
  }
  const options = Array.from(counts.entries())
    .map(([key, count]) => ({ key, label: channelGroupLabel(key), count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return { options, total };
}
