import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getGSCAuth } from "@/lib/google-auth";
import { google } from "googleapis";

interface GSCRow {
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
  keys?: string[] | null;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { siteUrl, days = 28 } = await req.json();
  if (!siteUrl) return NextResponse.json({ error: "siteUrl required" }, { status: 400 });

  try {
    const auth = getGSCAuth();
    const sc   = google.searchconsole({ version: "v1", auth });

    const now      = new Date();
    const endDate  = new Date(now.getTime() - 3 * 86400000);
    const startDate = new Date(endDate.getTime() - days * 86400000);
    const prevEnd  = new Date(startDate.getTime() - 86400000);
    const prevStart = new Date(prevEnd.getTime() - days * 86400000);
    const fmt = (d: Date) => d.toISOString().split("T")[0];

    const query = (body: Record<string, unknown>) =>
      sc.searchanalytics.query({ siteUrl, requestBody: body as never });

    const [overviewCurr, overviewPrev, byPage, byQuery, byDevice, byDate] = await Promise.all([
      query({ startDate: fmt(startDate), endDate: fmt(endDate) }),
      query({ startDate: fmt(prevStart), endDate: fmt(prevEnd) }),
      query({ startDate: fmt(startDate), endDate: fmt(endDate), dimensions: ["page"],  rowLimit: 25 }),
      query({ startDate: fmt(startDate), endDate: fmt(endDate), dimensions: ["query"], rowLimit: 25 }),
      query({ startDate: fmt(startDate), endDate: fmt(endDate), dimensions: ["device"] }),
      query({ startDate: fmt(startDate), endDate: fmt(endDate), dimensions: ["date"],  rowLimit: 90 }),
    ]);

    const curr: GSCRow = overviewCurr.data.rows?.[0] ?? {};
    const prev: GSCRow = overviewPrev.data.rows?.[0] ?? {};

    const pct = (a: number, b: number) => b ? Math.round((a - b) / b * 100) : 0;

    const currClicks = curr.clicks ?? 0, prevClicks = prev.clicks ?? 0;
    const currImpr   = curr.impressions ?? 0, prevImpr   = prev.impressions ?? 0;
    const currCtr    = curr.ctr ?? 0, prevCtr    = prev.ctr ?? 0;
    const currPos    = curr.position ?? 0, prevPos    = prev.position ?? 0;

    const mapRow = (r: GSCRow) => ({
      clicks:      r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr:         Number(((r.ctr ?? 0) * 100).toFixed(1)),
      position:    Number((r.position ?? 0).toFixed(1)),
    });

    return NextResponse.json({
      period: { start: fmt(startDate), end: fmt(endDate), days },
      overview: {
        clicks: currClicks, impressions: currImpr,
        ctr: Number((currCtr * 100).toFixed(1)),
        position: Number(currPos.toFixed(1)),
        clicksDelta: pct(currClicks, prevClicks),
        impressionsDelta: pct(currImpr, prevImpr),
        ctrDelta: pct(currCtr, prevCtr),
        positionDelta: Number((currPos - prevPos).toFixed(1)),
      },
      pages: (byPage.data.rows ?? []).map(r => ({ page: r.keys?.[0] ?? "", ...mapRow(r) })),
      queries: (byQuery.data.rows ?? []).map(r => ({ query: r.keys?.[0] ?? "", ...mapRow(r) })),
      devices: (byDevice.data.rows ?? []).map(r => ({ device: r.keys?.[0] ?? "", clicks: r.clicks ?? 0, impressions: r.impressions ?? 0 })),
      daily: (byDate.data.rows ?? []).map(r => ({ date: r.keys?.[0] ?? "", clicks: r.clicks ?? 0, impressions: r.impressions ?? 0 })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
