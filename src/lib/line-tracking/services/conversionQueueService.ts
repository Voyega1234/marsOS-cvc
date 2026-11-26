import { prisma } from "@/lib/prisma";
import { parseJson, stringifyJson } from "@/lib/line-tracking/json";
import { MAX_RETRY } from "@/lib/line-tracking/enums";
import type { LeadStatus } from "@/lib/line-tracking/enums";
import { getEffectiveConfig, isConnectorReal } from "./connectionStore";
import { claimOnce } from "./claim";
import { getRuleForStatus, seedDefaultRules, syncRulePlatforms } from "./conversionRuleService";
import { getPlatform, PLATFORMS } from "@/lib/line-tracking/platforms";
import { isStatusImportProject } from "./statusImportProjects";
import { isConvertCakeProject } from "./convertCakeSheetPlan";
import { ccPlatformsForStatus } from "./convertCakeConversions";
import type { ConnectionType } from "@/lib/line-tracking/enums";
import type { PlatformsConfig } from "@/lib/line-tracking/platforms";
import type { ClickSignals, SendContext, SendResult } from "./senderTypes";
import { loadClickSignals } from "./clickSignalService";
import type { ConversionEvent, Lead } from "@prisma/client";

/**
 * Evaluate a lead against its status rule and queue ConversionEvents for every
 * enabled platform in the rule's platformsJson. Registry-driven — adding a
 * platform in src/lib/platforms.ts makes it flow through automatically.
 */
export async function enqueueForLead(lead: Lead): Promise<number> {
  let rule = await getRuleForStatus(lead.projectId, lead.status as LeadStatus);

  // ตาข่ายชั้นสุดท้าย: จุดนี้คือทางเดียวที่ conversion จะถูกสร้าง ถ้ารูลหาย (โปรเจกต์
  // ที่สร้างตอน seed ยังไม่มี / seed ล้มกลางทาง / สถานะที่เพิ่งเพิ่มเข้าระบบ) ของเดิม
  // จะเงียบแล้วไม่ส่งอะไรเลยตลอดไปโดยไม่มีใครรู้ ตรงนี้ seed แล้วลองใหม่ทันที
  // ลูกค้าใหม่จึงส่ง conversion ได้ตั้งแต่ lead คนแรกเสมอ ไม่ต้องมีใครไปเปิดหน้าไหนก่อน
  if (!rule) {
    const project = await prisma.ltProject.findUnique({
      where: { id: lead.projectId },
      select: { defaultConversionValue: true },
    });
    await seedDefaultRules(lead.projectId, project?.defaultConversionValue ?? 0);
    await syncRulePlatforms(lead.projectId);
    rule = await getRuleForStatus(lead.projectId, lead.status as LeadStatus);
  }

  const projectName =
    (await prisma.ltProject.findUnique({ where: { id: lead.projectId }, select: { name: true } }))?.name ?? "";
  // Convert Cake only: every status (LOST included) goes to every connected platform.
  const ccAll = isConvertCakeProject({ name: projectName });

  if (!ccAll && (!rule || !rule.enabled)) {
    // No active rule for this status (e.g. LOST) — nothing to send.
    if (lead.status === "LOST") {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { conversionState: "SKIPPED" },
      });
    }
    return 0;
  }

  // เงินจริงติดไปเฉพาะ event ที่ปิดการขายแล้วเท่านั้น
  // lead.value มาจากการอ่านสลิป/ทีมกรอกเอง ของเดิมใช้ `lead.value || defaultValue`
  // ทุกสถานะ พอสลิปเข้า ยอดเต็มจะติดไปกับ event ทุกตัวของ lead คนนั้นย้อนหลัง
  // (ทัก/qualified ก็ถือยอดซื้อ) ทำให้ ROAS ในแดชบอร์ดแพลตฟอร์มพองเกินจริง
  // สถานะอื่นยังใช้ rule.defaultValue ตามที่ทีมตั้งไว้ต่อสถานะได้เหมือนเดิม
  // BOOKED (KOWA) ถือยอดมัดจำจากสลิปจริง จึงส่งยอดไปด้วยเหมือนขั้นปิดการขาย
  const isPurchase = lead.status === "WON" || lead.status === "PAID" || lead.status === "BOOKED";
  // MFactors: QUALIFIED carries the quoted price imported from the customer list file.
  const quoteValue =
    lead.status === "QUALIFIED" && lead.value > 0 &&
    isStatusImportProject({ name: projectName });
  const value = (isPurchase || quoteValue ? lead.value : 0) || rule?.defaultValue || 0;
  const rulePlatforms = parseJson<PlatformsConfig>(rule?.platformsJson ?? "{}", {});
  const platforms = ccAll ? ccPlatformsForStatus(lead.status as LeadStatus, rulePlatforms) : rulePlatforms;

  // Only queue platforms that are actually CONNECTED (real creds). Skip mock /
  // not-yet-connected platforms entirely. Cache the check per connector type.
  const realCache = new Map<ConnectionType, boolean>();
  const isReal = async (type: ConnectionType) => {
    if (!realCache.has(type)) realCache.set(type, await isConnectorReal(lead.projectId, type));
    return realCache.get(type)!;
  };

  let created = 0;
  for (const [platformId, cfg] of Object.entries(platforms)) {
    if (!cfg.enabled || !cfg.eventName) continue;
    const def = getPlatform(platformId);
    if (!def) continue; // unknown platform id — skip
    if (!(await isReal(def.connectionType))) continue; // skip mock / not connected

    // Avoid duplicate pending/sent events for the same lead+platform+event.
    const existing = await prisma.conversionEvent.findFirst({
      where: {
        leadId: lead.id,
        platform: platformId,
        eventName: cfg.eventName,
        status: { in: ["PENDING", "SENT"] },
      },
    });
    if (existing) continue;

    await prisma.conversionEvent.create({
      data: {
        projectId: lead.projectId,
        leadId: lead.id,
        platform: platformId,
        eventName: cfg.eventName,
        eventValue: value,
        currency: lead.currency,
        status: "PENDING",
      },
    });
    created++;
  }

  if (created > 0) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { conversionState: "QUEUED" },
    });
  }
  return created;
}

// Enqueue a "LINE OA block" (unfollow) conversion to every CONNECTED platform that
// defines a blockEvent. Lets media buyers measure which campaign/channel drives OA
// blocks (a negative-quality signal). Fired from the LINE webhook on unfollow.
export async function enqueueBlockConversion(lead: Lead): Promise<number> {
  const realCache = new Map<ConnectionType, boolean>();
  const isReal = async (type: ConnectionType) => {
    if (!realCache.has(type)) realCache.set(type, await isConnectorReal(lead.projectId, type));
    return realCache.get(type)!;
  };

  let created = 0;
  for (const def of PLATFORMS) {
    if (!def.blockEvent) continue;
    if (!(await isReal(def.connectionType))) continue;
    const existing = await prisma.conversionEvent.findFirst({
      where: { leadId: lead.id, platform: def.id, eventName: def.blockEvent, status: { in: ["PENDING", "SENT"] } },
    });
    if (existing) continue;
    await prisma.conversionEvent.create({
      data: {
        projectId: lead.projectId,
        leadId: lead.id,
        platform: def.id,
        eventName: def.blockEvent,
        eventValue: 0,
        currency: lead.currency,
        status: "PENDING",
      },
    });
    created++;
  }
  if (created > 0) {
    await prisma.lead.update({ where: { id: lead.id }, data: { conversionState: "QUEUED" } });
  }
  return created;
}

/** Connection configs read during one queue run, keyed by project + connection type. */
type ConfigCache = Map<string, Promise<unknown>>;

/**
 * How long one send attempt keeps its claim. Longer than any send takes; short enough that
 * an attempt cut off half way is picked up again by the next scheduled run.
 */
const SEND_CLAIM_SECONDS = 300;

async function dispatch(
  event: ConversionEvent & { lead: Lead },
  projectName: string,
  configs: ConfigCache,
  clicks: Map<string, ClickSignals>
): Promise<SendResult> {
  const ctx: SendContext = {
    lead: event.lead,
    eventName: event.eventName,
    value: event.eventValue,
    currency: event.currency,
    projectId: event.projectId,
    projectName,
    click: event.lead.clickId ? clicks.get(event.lead.clickId) : undefined,
  };

  const def = getPlatform(event.platform);
  if (!def) {
    return { ok: false, mock: true, request: null, response: null, error: `Unknown platform: ${event.platform}` };
  }
  // Many events of one run share a project and a platform: read that config once.
  const cacheKey = `${event.projectId}:${def.connectionType}`;
  let pending = configs.get(cacheKey);
  if (!pending) {
    pending = getEffectiveConfig(event.projectId, def.connectionType);
    configs.set(cacheKey, pending);
  }
  const config = await pending;
  return def.send(config as Record<string, unknown>, ctx);
}

export interface ProcessSummary {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Process pending conversion events (optionally scoped to a project, or a single
 * event id for manual retry). Retries failed events up to MAX_RETRY.
 */
export async function processQueue(opts: {
  projectId?: string;
  eventId?: string;
  limit?: number;
} = {}): Promise<ProcessSummary> {
  const events = await prisma.conversionEvent.findMany({
    where: {
      ...(opts.eventId ? { id: opts.eventId } : {}),
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      status: opts.eventId ? undefined : "PENDING",
      retryCount: { lt: MAX_RETRY },
    },
    include: { lead: true, project: { select: { name: true } } },
    take: opts.limit ?? 100,
    orderBy: { createdAt: "asc" },
  });

  const summary: ProcessSummary = { processed: 0, sent: 0, failed: 0, skipped: 0 };
  const configs: ConfigCache = new Map();
  // What the platforms match on beyond the click id (GA session, browser ids, user agent)
  // lives with the click, not the lead. One read for the whole run; never throws.
  const clicks = await loadClickSignals(events.map((e) => e.lead.clickId));

  for (const event of events) {
    // The queue runs from the LINE webhook, the LINE Login callback, the staff buttons and
    // the scheduled job. Two runs that overlap both read the same PENDING row; without a
    // claim both would send it and the ad platform would count the conversion twice.
    // The retry count is part of the key, so a retry after a failed attempt is a new claim.
    // A run for one named event is a staff member pressing "send again": that is always
    // carried out, as before, so it takes no claim.
    if (
      !opts.eventId &&
      !(await claimOnce(`${event.projectId}:send:${event.id}:${event.retryCount}`, SEND_CLAIM_SECONDS))
    ) {
      summary.skipped++;
      continue;
    }
    summary.processed++;
    let result: SendResult;
    try {
      result = await dispatch(event, event.project.name, configs, clicks);
    } catch (err) {
      result = {
        ok: false,
        mock: false,
        request: null,
        response: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const status = result.ok ? "SENT" : "FAILED";
    if (result.ok) summary.sent++;
    else summary.failed++;

    await prisma.conversionEvent.update({
      where: { id: event.id },
      data: {
        status,
        requestPayload: stringifyJson(result.request),
        responsePayload: stringifyJson(result.response),
        retryCount: result.ok ? event.retryCount : event.retryCount + 1,
        lastError: result.error ?? null,
        sentAt: result.ok ? new Date() : event.sentAt,
      },
    });
  }

  // Roll up per-lead conversion state for the leads we touched.
  const leadIds = Array.from(new Set(events.map((e) => e.leadId)));
  for (const leadId of leadIds) {
    await rollupLeadConversionState(leadId);
  }

  return summary;
}

/** Recompute a lead's conversionState from its events. */
export async function rollupLeadConversionState(leadId: string) {
  const events = await prisma.conversionEvent.findMany({ where: { leadId }, select: { status: true } });
  if (events.length === 0) return;
  const anyPending = events.some((e) => e.status === "PENDING");
  const anyFailed = events.some((e) => e.status === "FAILED");
  const anySent = events.some((e) => e.status === "SENT");

  let state: string = "NOT_READY";
  if (anyPending) state = "QUEUED";
  else if (anyFailed) state = "FAILED";
  else if (anySent) state = "SENT";
  else state = "SKIPPED";

  await prisma.lead.update({ where: { id: leadId }, data: { conversionState: state } });
}

export function retryEvent(eventId: string) {
  return processQueue({ eventId });
}

export async function markEventSkipped(eventId: string) {
  const ev = await prisma.conversionEvent.update({
    where: { id: eventId },
    data: { status: "SKIPPED" },
  });
  await rollupLeadConversionState(ev.leadId);
  return ev;
}
