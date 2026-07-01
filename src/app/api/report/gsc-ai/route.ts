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
    const sc = google.searchconsole({ version: "v1", auth });

    const now = new Date();
    const endDate = new Date(now.getTime() - 3 * 86400000);
    const startDate = new Date(endDate.getTime() - days * 86400000);
    const prevEnd = new Date(startDate.getTime() - 86400000);
    const prevStart = new Date(prevEnd.getTime() - days * 86400000);
    const fmt = (d: Date) => d.toISOString().split("T")[0];

    const query = (searchType: string, body: Record<string, unknown>) =>
      sc.searchanalytics.query({
        siteUrl,
        requestBody: { ...body, searchType } as never,
      });

    // Fetch AI Overviews and AI Mode in parallel (current + prev periods)
    const [aoCurrentRes, aoPrevRes, amCurrentRes, amPrevRes] = await Promise.allSettled([
      query("AI_OVERVIEWS", { startDate: fmt(startDate), endDate: fmt(endDate) }),
      query("AI_OVERVIEWS", { startDate: fmt(prevStart), endDate: fmt(prevEnd) }),
      query("AI_MODE", { startDate: fmt(startDate), endDate: fmt(endDate) }),
      query("AI_MODE", { startDate: fmt(prevStart), endDate: fmt(prevEnd) }),
    ]);

    const extractRow = (res: PromiseSettledResult<{ data: { rows?: GSCRow[] } }>) => {
      if (res.status === "rejected") return null;
      const row: GSCRow = res.value.data.rows?.[0] ?? {};
      return {
        clicks: row.clicks ?? 0,
        impressions: row.impressions ?? 0,
        ctr: Number(((row.ctr ?? 0) * 100).toFixed(1)),
        position: Number((row.position ?? 0).toFixed(1)),
      };
    };

    const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : 0);

    const aoCurr = extractRow(aoCurrentRes);
    const aoPrev = extractRow(aoPrevRes);
    const amCurr = extractRow(amCurrentRes);
    const amPrev = extractRow(amPrevRes);

    // If both are null — account doesn't have AI Performance data
    if (!aoCurr && !amCurr) {
      return NextResponse.json({ available: false });
    }

    return NextResponse.json({
      available: true,
      period: { start: fmt(startDate), end: fmt(endDate), days },
      aiOverviews: aoCurr
        ? {
            ...aoCurr,
            impressionsDelta: aoPrev ? pct(aoCurr.impressions, aoPrev.impressions) : 0,
            clicksDelta: aoPrev ? pct(aoCurr.clicks, aoPrev.clicks) : 0,
          }
        : null,
      aiMode: amCurr
        ? {
            ...amCurr,
            impressionsDelta: amPrev ? pct(amCurr.impressions, amPrev.impressions) : 0,
            clicksDelta: amPrev ? pct(amCurr.clicks, amPrev.clicks) : 0,
          }
        : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    // 400/403 with "searchType" means this account has no AI Performance access
    if (msg.includes("searchType") || msg.includes("invalid") || msg.includes("400") || msg.includes("403")) {
      return NextResponse.json({ available: false, reason: msg });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
