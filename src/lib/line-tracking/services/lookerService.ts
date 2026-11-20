import { prisma } from "@/lib/prisma";
import { LEAD_STATUS_LABEL, type LeadStatus } from "@/lib/line-tracking/enums";
import type { LookerProject } from "@/lib/line-tracking/lookerAuth";
import {
  PURCHASED,
  REACHED_CONTACTED,
  REACHED_QUALIFIED,
  REACHED_BOOKED,
  REACHED_QUOTED,
} from "./projectService";
import { isAutoPaidProject } from "./autoPaidProjects";

/**
 * Data feed for the Looker Studio community connector.
 *
 * Three shapes, matching the pages being mirrored:
 *   - summary:     one row per (day × channel group) — the dashboard page.
 *   - leads:       one row per lead — the Leads CRM page.
 *   - conversions: one row per conversion event — the "Conversion ล่าสุด" card and
 *                  the conversion queue.
 *
 * Days are bucketed in the PROJECT's timezone, not UTC. A lead created 01:00 Bangkok
 * belongs to that Bangkok day; bucketing on UTC would file it under the day before and
 * make the Looker report disagree with the dashboard the client is looking at.
 */

/** Looker's YEAR_MONTH_DAY wants YYYYMMDD; YEAR_MONTH_DAY_SECOND wants YYYYMMDDHHMMSS. */
const MAX_RANGE_DAYS = 400;
const MAX_LEAD_ROWS = 50_000;
const DAY_MS = 86_400_000;

export class LookerRequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "LookerRequestError";
    this.status = status;
  }
}

/** Offset (ms) between the given instant's wall clock in `timeZone` and UTC. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Hour 24 shows up at midnight in some locales' hour12:false output.
  const hour = get("hour") % 24;
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - at.getTime();
}

/** The UTC instant at which the local day `YYYY-MM-DD` begins in `timeZone`. */
function zonedDayStart(day: string, timeZone: string): Date {
  const guess = Date.parse(`${day}T00:00:00Z`);
  // Two passes: the first offset is measured at the wrong instant when the guess lands
  // on the other side of a DST switch, the second is measured at (nearly) the answer.
  const once = guess - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - zoneOffsetMs(new Date(once), timeZone));
}

/** en-CA renders dates as ISO YYYY-MM-DD, which is why it is used here. */
function dayKeyFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function toLookerDate(day: string): string {
  return day.replace(/-/g, "");
}

function toLookerDateTime(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = String(Number(get("hour")) % 24).padStart(2, "0");
  return `${get("year")}${get("month")}${get("day")}${hour}${get("minute")}${get("second")}`;
}

export interface LookerRange {
  /** Inclusive local day, YYYY-MM-DD. */
  startDay: string;
  endDay: string;
  /** Half-open UTC window [from, to) covering those local days. */
  from: Date;
  to: Date;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse ?start=&end= (local days, inclusive). Missing values default to the last 30
 * days so a misconfigured data source still returns something sane instead of erroring.
 */
export function parseLookerRange(params: URLSearchParams, timeZone: string): LookerRange {
  const fmt = dayKeyFormatter(timeZone);
  const today = fmt.format(new Date());

  const rawEnd = params.get("end")?.trim() || today;
  const rawStart =
    params.get("start")?.trim() ||
    fmt.format(new Date(zonedDayStart(rawEnd, timeZone).getTime() - 29 * DAY_MS));

  for (const [label, value] of [["start", rawStart], ["end", rawEnd]] as const) {
    if (!DAY_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
      throw new LookerRequestError(`Bad ${label} date "${value}" — expected YYYY-MM-DD`);
    }
  }
  if (rawStart > rawEnd) {
    throw new LookerRequestError(`start (${rawStart}) is after end (${rawEnd})`);
  }

  const from = zonedDayStart(rawStart, timeZone);
  // Half-open: start of the day AFTER `end`, so the whole end day is included without
  // the off-by-one-second games that a `lte 23:59:59` bound plays.
  const to = zonedDayStart(
    fmt.format(new Date(zonedDayStart(rawEnd, timeZone).getTime() + 36 * 3600 * 1000)),
    timeZone
  );

  const days = Math.round((to.getTime() - from.getTime()) / DAY_MS);
  if (days > MAX_RANGE_DAYS) {
    throw new LookerRequestError(
      `Date range is ${days} days — the maximum is ${MAX_RANGE_DAYS}. Narrow the range in Looker.`
    );
  }

  return { startDay: rawStart, endDay: rawEnd, from, to };
}

const UNKNOWN_CHANNEL = "Unassigned";

export interface LookerSummaryRow {
  date: string;
  channel: string;
  visits: number;
  line_clicks: number;
  leads: number;
  contacted: number;
  qualified: number;
  quoted: number;
  /** KOWA only (900 THB booking slip); omitted for every other project. */
  booked?: number;
  purchases: number;
  revenue: number;
}

function emptyRow(date: string, channel: string, withBooked: boolean): LookerSummaryRow {
  return {
    date,
    channel,
    visits: 0,
    line_clicks: 0,
    leads: 0,
    contacted: 0,
    qualified: 0,
    quoted: 0,
    ...(withBooked ? { booked: 0 } : {}),
    purchases: 0,
    revenue: 0,
  };
}

/**
 * Day × channel aggregates. Funnel stages are CUMULATIVE, exactly as the dashboard
 * counts them: a WON lead is also counted in contacted/qualified/quoted. Charting
 * these as a funnel therefore gives monotonically shrinking bars, and summing any one
 * column over a date range gives the same number the dashboard shows for that range.
 */
export async function getLookerSummary(
  project: LookerProject,
  range: LookerRange
): Promise<LookerSummaryRow[]> {
  const window = { gte: range.from, lt: range.to };
  const [clicks, leads] = await Promise.all([
    prisma.adClick.findMany({
      where: { projectId: project.id, createdAt: window },
      select: { createdAt: true, channelGroup: true, lineClickedAt: true },
    }),
    prisma.lead.findMany({
      where: { projectId: project.id, createdAt: window },
      select: { createdAt: true, channelGroup: true, status: true, value: true },
    }),
  ]);

  const withBooked = isAutoPaidProject(project);
  const fmt = dayKeyFormatter(project.timezone);
  const rows = new Map<string, LookerSummaryRow>();
  const at = (createdAt: Date, channelGroup: string | null) => {
    const date = toLookerDate(fmt.format(createdAt));
    const channel = channelGroup || UNKNOWN_CHANNEL;
    const key = `${date}|${channel}`;
    let row = rows.get(key);
    if (!row) {
      row = emptyRow(date, channel, withBooked);
      rows.set(key, row);
    }
    return row;
  };

  for (const click of clicks) {
    const row = at(click.createdAt, click.channelGroup);
    row.visits += 1;
    if (click.lineClickedAt) row.line_clicks += 1;
  }

  for (const lead of leads) {
    const row = at(lead.createdAt, lead.channelGroup);
    row.leads += 1;
    if (REACHED_CONTACTED.includes(lead.status)) row.contacted += 1;
    if (REACHED_QUALIFIED.includes(lead.status)) row.qualified += 1;
    if (REACHED_QUOTED.includes(lead.status)) row.quoted += 1;
    if (withBooked && REACHED_BOOKED.includes(lead.status)) row.booked = (row.booked ?? 0) + 1;
    if (PURCHASED.includes(lead.status)) {
      row.purchases += 1;
      row.revenue += lead.value ?? 0;
    }
  }

  return Array.from(rows.values()).sort(
    (a, b) => a.date.localeCompare(b.date) || a.channel.localeCompare(b.channel)
  );
}

export interface LookerLeadRow {
  date: string;
  created_at: string;
  lead_name: string;
  line_name: string;
  phone: string;
  channel_group: string;
  channel: string;
  source: string;
  campaign: string;
  keyword: string;
  status: string;
  status_label: string;
  line_stage: string;
  conversion_state: string;
  sales_owner: string;
  has_gclid: boolean;
  has_fbclid: boolean;
  has_ttclid: boolean;
  /** Mirrors the dashboard's "เคยทัก": the LINE user has sent us at least one message. */
  has_messaged: boolean;
  /** Empty string when the lead has never messaged — Looker reads that as no date. */
  last_message_at: string;
  value: number;
  slip_amount: number;
}

/** Keep the last 4 digits so a human can still match a row against a phone they know. */
function maskPhone(phone: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "••••";
  return `••••${digits.slice(-4)}`;
}

/**
 * Lead-level rows.
 *
 * The SCHEMA is identical whether or not PII is enabled — when it is off the sensitive
 * values are MASKED, never dropped. Dropping fields would change the schema and break
 * every chart in an existing report the moment the owner flips the toggle.
 */
export async function getLookerLeads(
  project: LookerProject,
  range: LookerRange
): Promise<LookerLeadRow[]> {
  const where = { projectId: project.id, createdAt: { gte: range.from, lt: range.to } };

  const total = await prisma.lead.count({ where });
  if (total > MAX_LEAD_ROWS) {
    // Refusing beats silently truncating: a report built on a quietly cut-off extract
    // under-reports and nobody can tell by looking at it.
    throw new LookerRequestError(
      `This range has ${total.toLocaleString("en-US")} leads, over the ${MAX_LEAD_ROWS.toLocaleString("en-US")}-row limit. Pick a shorter date range.`
    );
  }

  const leads = await prisma.lead.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true,
      displayName: true,
      fullName: true,
      phone: true,
      channel: true,
      channelGroup: true,
      source: true,
      campaign: true,
      keyword: true,
      status: true,
      value: true,
      slipAmount: true,
      salesOwner: true,
      conversionState: true,
      gclid: true,
      fbclid: true,
      ttclid: true,
      lineUser: { select: { displayName: true, friendStatus: true, lastMessageAt: true } },
    },
  });

  const fmt = dayKeyFormatter(project.timezone);
  const pii = project.lookerIncludePii;

  return leads.map((lead) => {
    const lineName = lead.lineUser?.displayName || lead.displayName || "";
    const realName = lead.fullName || lead.displayName || "";
    return {
      date: toLookerDate(fmt.format(lead.createdAt)),
      created_at: toLookerDateTime(lead.createdAt, project.timezone),
      // With PII off the report still has a per-lead label to group by — the LINE
      // display name — it just is not the customer's real, given name.
      lead_name: pii ? realName : lineName,
      line_name: lineName,
      phone: pii ? lead.phone || "" : maskPhone(lead.phone),
      channel_group: lead.channelGroup || UNKNOWN_CHANNEL,
      channel: lead.channel || UNKNOWN_CHANNEL,
      source: lead.source || "",
      campaign: lead.campaign || "",
      keyword: lead.keyword || "",
      status: lead.status,
      status_label: LEAD_STATUS_LABEL[lead.status as LeadStatus] ?? lead.status,
      line_stage: lead.lineUser?.friendStatus || "UNKNOWN",
      conversion_state: lead.conversionState,
      sales_owner: lead.salesOwner || "",
      has_gclid: !!lead.gclid,
      has_fbclid: !!lead.fbclid,
      has_ttclid: !!lead.ttclid,
      has_messaged: !!lead.lineUser?.lastMessageAt,
      last_message_at: lead.lineUser?.lastMessageAt
        ? toLookerDateTime(lead.lineUser.lastMessageAt, project.timezone)
        : "",
      value: lead.value ?? 0,
      slip_amount: lead.slipAmount ?? 0,
    };
  });
}

export interface LookerConversionRow {
  date: string;
  created_at: string;
  sent_at: string;
  event_name: string;
  platform: string;
  status: string;
  lead_name: string;
  channel_group: string;
  retry_count: number;
  last_error: string;
  event_value: number;
}

/**
 * One row per conversion event sent to an ad platform.
 *
 * `lead_name` follows the same PII rule as the leads feed: the real name only when the
 * project has PII enabled, otherwise the LINE display name. `last_error` is kept because
 * a report that shows FAILED events without saying why is not actionable — it is a
 * platform error string, never customer data.
 */
export async function getLookerConversions(
  project: LookerProject,
  range: LookerRange
): Promise<LookerConversionRow[]> {
  const where = { projectId: project.id, createdAt: { gte: range.from, lt: range.to } };

  const total = await prisma.conversionEvent.count({ where });
  if (total > MAX_LEAD_ROWS) {
    throw new LookerRequestError(
      `This range has ${total.toLocaleString("en-US")} conversion events, over the ${MAX_LEAD_ROWS.toLocaleString("en-US")}-row limit. Pick a shorter date range.`
    );
  }

  const events = await prisma.conversionEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      sentAt: true,
      eventName: true,
      eventValue: true,
      platform: true,
      status: true,
      retryCount: true,
      lastError: true,
      lead: {
        select: {
          fullName: true,
          displayName: true,
          channelGroup: true,
          lineUser: { select: { displayName: true } },
        },
      },
    },
  });

  const fmt = dayKeyFormatter(project.timezone);
  const pii = project.lookerIncludePii;

  return events.map((event) => {
    const lineName = event.lead?.lineUser?.displayName || event.lead?.displayName || "";
    const realName = event.lead?.fullName || event.lead?.displayName || "";
    return {
      date: toLookerDate(fmt.format(event.createdAt)),
      created_at: toLookerDateTime(event.createdAt, project.timezone),
      sent_at: event.sentAt ? toLookerDateTime(event.sentAt, project.timezone) : "",
      event_name: event.eventName,
      platform: event.platform,
      status: event.status,
      lead_name: pii ? realName : lineName,
      channel_group: event.lead?.channelGroup || UNKNOWN_CHANNEL,
      retry_count: event.retryCount,
      last_error: event.lastError || "",
      event_value: event.eventValue ?? 0,
    };
  });
}
