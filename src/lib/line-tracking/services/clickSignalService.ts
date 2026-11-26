// What the system knows about the click behind a lead, gathered for the conversion senders:
// the click row itself (lt_ad_click) plus the browser identifiers embed.js read on the
// customer's website (lt_click_browser_ids).
//
// lt_click_browser_ids is created by scripts/sql/add-line-tracking-click-browser-ids.sql.
// Every access to it here tolerates the table being absent, so tracking and sending keep
// working (without those ids) until that script has been run. Nothing in this file may make
// a click, a lead or a conversion fail.
import { prisma } from "@/lib/prisma";
import { parseJson } from "@/lib/line-tracking/json";
import {
  browserIdsFromStored,
  hasBrowserIds,
  mergeBrowserIds,
  type BrowserIds,
} from "@/lib/line-tracking/browserIds";
import type { ClickSignals } from "./senderTypes";

// While the table has not been created, do not ask for it on every visit: one failed query
// (and one error line in the log) per instance every few minutes is enough to notice the
// moment the script has been run.
const RECHECK_MISSING_TABLE_MS = 5 * 60 * 1000;
let tableMissingUntil = 0;

const tableLooksMissing = () => Date.now() < tableMissingUntil;

function noteFailure(err: unknown) {
  // P2021: the table does not exist in the database.
  if ((err as { code?: string } | null)?.code === "P2021") {
    tableMissingUntil = Date.now() + RECHECK_MISSING_TABLE_MS;
  }
}

// The public endpoint only fills ids into a click this young; a stale click gets no new ids.
const BROWSER_ID_FILL_WINDOW_DAYS = 90;

/**
 * Store the browser identifiers of one click. Newer values replace older ones, field by
 * field, so the read at "pressed the LINE button" refines the read at page load.
 *
 * The caller is a public endpoint: the click must belong to the project named in the URL,
 * otherwise nothing is written. `trusted` skips that lookup for a click created in this
 * same request.
 */
export async function saveBrowserIds(
  projectId: string,
  clickId: string | null | undefined,
  ids: BrowserIds,
  opts: { trusted?: boolean } = {}
): Promise<void> {
  if (!clickId || !hasBrowserIds(ids)) return;
  try {
    if (!opts.trusted) {
      // The GA client id also lives on the click row. A page-load read often misses it (the
      // GA cookie is not set yet), so the later read fills it in. Doubles as the ownership
      // check: zero rows means the click is not this project's.
      const where = {
        clickId,
        projectId,
        createdAt: { gte: new Date(Date.now() - BROWSER_ID_FILL_WINDOW_DAYS * 24 * 60 * 60 * 1000) },
      };
      const owned = ids.gaClientId
        ? (await prisma.adClick.updateMany({ where, data: { gaClientId: ids.gaClientId } })).count
        : await prisma.adClick.count({ where });
      if (!owned) return;
    }
    if (tableLooksMissing()) return;
    const existing = await prisma.ltClickBrowserIds.findUnique({ where: { clickId }, select: { dataJson: true } });
    const merged = mergeBrowserIds(browserIdsFromStored(parseJson(existing?.dataJson, {})), ids);
    const dataJson = JSON.stringify(merged);
    if (existing?.dataJson === dataJson) return;
    await prisma.ltClickBrowserIds.upsert({
      where: { clickId },
      create: { clickId, dataJson },
      update: { dataJson },
    });
  } catch (err) {
    // Table not created yet, or the click row was removed in between: carry on without.
    noteFailure(err);
  }
}

/** Click signals for a set of click ids, in two queries. Unknown ids are simply absent. */
export async function loadClickSignals(
  clickIds: (string | null | undefined)[]
): Promise<Map<string, ClickSignals>> {
  const ids = Array.from(new Set(clickIds.filter((id): id is string => !!id)));
  const out = new Map<string, ClickSignals>();
  if (ids.length === 0) return out;

  try {
    const clicks = await prisma.adClick.findMany({
      where: { clickId: { in: ids } },
      select: { clickId: true, createdAt: true, gaClientId: true, userAgent: true, landingUrl: true, referrer: true },
    });
    for (const c of clicks) {
      out.set(c.clickId, {
        clickedAt: c.createdAt,
        gaClientId: c.gaClientId ?? undefined,
        userAgent: c.userAgent ?? undefined,
        landingUrl: c.landingUrl ?? undefined,
        referrer: c.referrer ?? undefined,
      });
    }
  } catch {
    return out;
  }

  if (tableLooksMissing()) return out;
  try {
    const rows = await prisma.ltClickBrowserIds.findMany({
      where: { clickId: { in: ids } },
      select: { clickId: true, dataJson: true },
    });
    for (const row of rows) {
      const signals = out.get(row.clickId);
      if (!signals) continue;
      const stored = browserIdsFromStored(parseJson(row.dataJson, {}));
      out.set(row.clickId, {
        ...signals,
        ...stored,
        gaClientId: stored.gaClientId ?? signals.gaClientId,
      });
    }
  } catch (err) {
    // Table not created yet: the click row alone still helps.
    noteFailure(err);
  }
  return out;
}
