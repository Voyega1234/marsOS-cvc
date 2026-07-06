import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getGSCAuth } from "@/lib/google-auth";
import { google } from "googleapis";

interface GSCRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId || !session.user.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId  = session.user.organizationId;
  const userId = session.user.id;

  const body = await req.json().catch(() => ({}));
  const {
    siteUrl,         // e.g. "sc-domain:example.com" or "https://example.com/"
    projectId,
    dropThreshold = 20,   // % drop to flag
    minClicks = 5,        // ignore pages with very low baseline
    lookbackDays = 28,
  } = body;

  if (!siteUrl) return NextResponse.json({ error: "siteUrl required" }, { status: 400 });

  try {
    const auth = getGSCAuth();
    const sc   = google.searchconsole({ version: "v1", auth });

    const now      = new Date();
    const endDate  = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days lag
    const startDate = new Date(endDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    const prevEnd  = new Date(startDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    const fmt = (d: Date) => d.toISOString().split("T")[0];

    // Current period
    const [currRes, prevRes] = await Promise.all([
      sc.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: fmt(startDate), endDate: fmt(endDate),
          dimensions: ["page"], rowLimit: 500,
        },
      }),
      sc.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: fmt(prevStart), endDate: fmt(prevEnd),
          dimensions: ["page"], rowLimit: 500,
        },
      }),
    ]);

    const curr = (currRes.data.rows ?? []) as GSCRow[];
    const prev = (prevRes.data.rows ?? []) as GSCRow[];

    // Build lookup maps
    const currMap = new Map(curr.map(r => [r.keys[0], r]));
    const prevMap = new Map(prev.map(r => [r.keys[0], r]));

    const toRefresh: {
      url: string; clicks: number; prevClicks: number;
      impressions: number; clicksChangePct: number; imprsChangePct: number;
    }[] = [];

    for (const [url, p] of Array.from(prevMap.entries())) {
      if (p.clicks < minClicks) continue;
      const c = currMap.get(url);
      const currClicks = c?.clicks ?? 0;
      const dropPct = ((p.clicks - currClicks) / p.clicks) * 100;
      if (dropPct >= dropThreshold) {
        const impDrop = p.impressions > 0 ? ((p.impressions - (c?.impressions ?? 0)) / p.impressions) * 100 : 0;
        toRefresh.push({
          url,
          clicks:          currClicks,
          prevClicks:      p.clicks,
          impressions:     c?.impressions ?? 0,
          clicksChangePct: -dropPct,
          imprsChangePct:  -impDrop,
        });
      }
    }

    // Sort by largest drop first
    toRefresh.sort((a, b) => a.clicksChangePct - b.clicksChangePct);

    // Upsert into ContentRefreshItem — skip if URL already exists for this org
    const existing = await (prisma as any).contentRefreshItem.findMany({
      where: { organizationId: orgId },
      select: { url: true },
    });
    const existingUrls = new Set(existing.map((e: { url: string }) => e.url));

    const newItems = toRefresh.filter(r => !existingUrls.has(r.url));

    if (newItems.length > 0) {
      await Promise.all(
        newItems.map(r =>
          (prisma as any).contentRefreshItem.create({
            data: {
              organizationId: orgId,
              createdById:    userId,
              url:            r.url,
              ...(projectId && { projectId }),
              priority:       r.clicksChangePct < -50 ? "high" : "medium",
              status:         "pending",
              clicks:         r.clicks,
              impressions:    r.impressions,
              clicksChangePct: r.clicksChangePct,
              imprsChangePct:  r.imprsChangePct,
              reasons:        JSON.stringify(["traffic drop"]),
              recommendation: `Clicks dropped ${Math.abs(r.clicksChangePct).toFixed(0)}% (${r.prevClicks} → ${r.clicks})`,
              daysOld:        null,
            },
          })
        )
      );
    }

    return NextResponse.json({
      scanned:  toRefresh.length,
      added:    newItems.length,
      skipped:  toRefresh.length - newItems.length,
      items:    newItems.slice(0, 20), // preview
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
