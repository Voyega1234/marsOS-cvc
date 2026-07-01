import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getGA4Auth } from "@/lib/google-auth";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { propertyId, days = 28 } = await req.json();
  if (!propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });

  try {
    // Get access token from service account
    const auth   = getGA4Auth();
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("Could not get access token");

    const end   = new Date(Date.now() - 86400000);
    const start = new Date(end.getTime() - days * 86400000);
    const fmt   = (d: Date) => d.toISOString().split("T")[0];

    const prevEnd   = new Date(start.getTime() - 86400000);
    const prevStart = new Date(prevEnd.getTime() - days * 86400000);

    const BASE = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    type GA4Row = { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] };
    type GA4Resp = { rows?: GA4Row[] };

    const runReport = async (body: Record<string, unknown>): Promise<GA4Resp> => {
      const r = await fetch(BASE, { method: "POST", headers, body: JSON.stringify(body) });
      if (!r.ok) {
        const err = await r.json();
        throw new Error((err as { error?: { message?: string } })?.error?.message ?? `HTTP ${r.status}`);
      }
      return r.json() as Promise<GA4Resp>;
    };

    const mv = (row: GA4Row | undefined, idx: number) =>
      Number(row?.metricValues?.[idx]?.value ?? 0);
    const dv = (row: GA4Row | undefined, idx: number) =>
      row?.dimensionValues?.[idx]?.value ?? "";

    const [overview, byChannel, byPage, byDevice, byEvent, byDate] = await Promise.all([
      runReport({
        dateRanges: [
          { startDate: fmt(start), endDate: fmt(end) },
          { startDate: fmt(prevStart), endDate: fmt(prevEnd) },
        ],
        metrics: [
          { name: "sessions" }, { name: "totalUsers" },
          { name: "conversions" }, { name: "totalRevenue" }, { name: "engagementRate" },
        ],
      }),
      runReport({
        dateRanges: [{ startDate: fmt(start), endDate: fmt(end) }],
        dimensions: [{ name: "sessionDefaultChannelGrouping" }],
        metrics: [{ name: "sessions" }, { name: "conversions" }, { name: "totalRevenue" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
      runReport({
        dateRanges: [{ startDate: fmt(start), endDate: fmt(end) }],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }, { name: "sessions" }, { name: "bounceRate" }, { name: "engagementRate" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 20,
      }),
      runReport({
        dateRanges: [{ startDate: fmt(start), endDate: fmt(end) }],
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "sessions" }, { name: "conversions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      }),
      runReport({
        dateRanges: [{ startDate: fmt(start), endDate: fmt(end) }],
        dimensions: [{ name: "eventName" }, { name: "isConversionEvent" }],
        metrics: [{ name: "eventCount" }, { name: "conversions" }],
        orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
        limit: 20,
      }),
      runReport({
        dateRanges: [{ startDate: fmt(start), endDate: fmt(end) }],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }],
        orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
        limit: 90,
      }),
    ]);

    const curr = overview.rows?.[0];
    const prev = overview.rows?.[1];

    const pct = (a: number, b: number) => b ? Math.round((a - b) / b * 100) : 0;

    const currSessions = mv(curr, 0), currUsers = mv(curr, 1), currConv = mv(curr, 2), currRev = mv(curr, 3), currEng = mv(curr, 4);
    const prevSessions = mv(prev, 0), prevUsers = mv(prev, 1), prevConv = mv(prev, 2), prevRev = mv(prev, 3);

    return NextResponse.json({
      period: { start: fmt(start), end: fmt(end), days },
      overview: {
        sessions: currSessions, users: currUsers, conversions: currConv,
        revenue: Number(currRev.toFixed(2)),
        engagementRate: Number((currEng * 100).toFixed(1)),
        sessionsDelta: pct(currSessions, prevSessions),
        usersDelta:    pct(currUsers, prevUsers),
        conversionsDelta: pct(currConv, prevConv),
        revenueDelta:  pct(currRev, prevRev),
      },
      channels: (byChannel.rows ?? []).map(r => ({
        channel:     dv(r, 0),
        sessions:    mv(r, 0),
        conversions: mv(r, 1),
        revenue:     Number(mv(r, 2).toFixed(2)),
      })),
      pages: (byPage.rows ?? []).map(r => ({
        path:           dv(r, 0),
        views:          mv(r, 0),
        sessions:       mv(r, 1),
        bounceRate:     Number((mv(r, 2) * 100).toFixed(1)),
        engagementRate: Number((mv(r, 3) * 100).toFixed(1)),
      })),
      devices: (byDevice.rows ?? []).map(r => ({
        device:      dv(r, 0),
        sessions:    mv(r, 0),
        conversions: mv(r, 1),
      })),
      events: (byEvent.rows ?? []).map(r => ({
        event:         dv(r, 0),
        isConversion:  dv(r, 1) === "true",
        count:         mv(r, 0),
        conversions:   mv(r, 1),
      })),
      daily: (byDate.rows ?? []).map(r => ({
        date:     dv(r, 0),
        sessions: mv(r, 0),
        users:    mv(r, 1),
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
