import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getGSCAuth } from "@/lib/google-auth";
import { google } from "googleapis";
import type { GscInsightItem } from "@/lib/report/seo-insights";

// GscInsightItem is defined in @/lib/report/seo-insights — import from there directly

interface GSCRow {
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
  keys?: string[] | null;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

    const q = (body: Record<string, unknown>) =>
      sc.searchanalytics.query({ siteUrl, requestBody: body as never });

    // Fetch curr + prev for queries and pages (rowLimit 500 for comparison depth)
    const [queryCurr, queryPrev, pageCurr, pagePrev] = await Promise.all([
      q({ startDate: fmt(startDate), endDate: fmt(endDate), dimensions: ["query"], rowLimit: 500 }),
      q({ startDate: fmt(prevStart), endDate: fmt(prevEnd),  dimensions: ["query"], rowLimit: 500 }),
      q({ startDate: fmt(startDate), endDate: fmt(endDate), dimensions: ["page"],  rowLimit: 200 }),
      q({ startDate: fmt(prevStart), endDate: fmt(prevEnd),  dimensions: ["page"],  rowLimit: 200 }),
    ]);

    const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : 0);

    // Build prev maps
    const prevQueryMap = new Map<string, GSCRow>();
    for (const r of queryPrev.data.rows ?? []) {
      if (r.keys?.[0]) prevQueryMap.set(r.keys[0], r);
    }
    const prevPageMap = new Map<string, GSCRow>();
    for (const r of pagePrev.data.rows ?? []) {
      if (r.keys?.[0]) prevPageMap.set(r.keys[0], r);
    }

    const insights: GscInsightItem[] = [];

    // ── Analyse per-query ─────────────────────────────────────────────────────
    for (const row of queryCurr.data.rows ?? []) {
      const query = row.keys?.[0] ?? "";
      const curr = {
        clicks:      row.clicks ?? 0,
        impressions: row.impressions ?? 0,
        ctr:         Number(((row.ctr ?? 0) * 100).toFixed(1)),
        position:    Number((row.position ?? 0).toFixed(1)),
      };
      const prev = prevQueryMap.get(query);
      const prevClicks = prev?.clicks ?? 0;
      const prevImpressions = prev?.impressions ?? 0;
      const prevPosition = prev ? Number((prev.position ?? 0).toFixed(1)) : null;

      const clicksDelta = pct(curr.clicks, prevClicks);
      const impressionsDelta = pct(curr.impressions, prevImpressions);
      const positionDelta = prevPosition !== null ? Number((curr.position - prevPosition).toFixed(1)) : null;

      // New keyword (appeared this period, not in prev)
      if (!prev && curr.impressions >= 10) {
        insights.push({
          type: "new_keyword",
          query,
          currClicks: curr.clicks,
          currImpressions: curr.impressions,
          currCtr: curr.ctr,
          currPosition: curr.position,
          label: "Keyword ใหม่",
          detail: `"${query}" เริ่มปรากฏใน Search — ${curr.impressions.toLocaleString()} impressions, position #${curr.position}`,
        });
        continue;
      }

      if (!prev) continue;

      // Rising query: clicks or impressions up ≥30%
      if ((clicksDelta >= 30 || impressionsDelta >= 30) && curr.impressions >= 20) {
        insights.push({
          type: "rising_query",
          query,
          currClicks: curr.clicks,
          currImpressions: curr.impressions,
          currCtr: curr.ctr,
          currPosition: curr.position,
          prevClicks,
          prevImpressions,
          prevPosition: prevPosition ?? undefined,
          clicksDelta,
          impressionsDelta,
          positionDelta: positionDelta ?? undefined,
          label: "Keyword กำลัง Rising",
          detail: `"${query}" clicks +${clicksDelta}%, impressions +${impressionsDelta}% เทียบช่วงก่อนหน้า`,
        });
      }

      // Declining query: clicks or impressions down ≥30%
      if ((clicksDelta <= -30 || impressionsDelta <= -30) && prevImpressions >= 20) {
        insights.push({
          type: "declining_query",
          query,
          currClicks: curr.clicks,
          currImpressions: curr.impressions,
          currCtr: curr.ctr,
          currPosition: curr.position,
          prevClicks,
          prevImpressions,
          prevPosition: prevPosition ?? undefined,
          clicksDelta,
          impressionsDelta,
          positionDelta: positionDelta ?? undefined,
          label: "Keyword ลดลง",
          detail: `"${query}" clicks ${clicksDelta}%, impressions ${impressionsDelta}% ต้องตรวจสอบ`,
        });
      }

      // Position gain: improved ≥3 positions AND has impressions
      if (positionDelta !== null && positionDelta <= -3 && curr.impressions >= 15) {
        insights.push({
          type: "position_gain",
          query,
          currClicks: curr.clicks,
          currImpressions: curr.impressions,
          currCtr: curr.ctr,
          currPosition: curr.position,
          prevPosition: prevPosition ?? undefined,
          positionDelta,
          label: "Position ขึ้น",
          detail: `"${query}" อันดับดีขึ้น ${Math.abs(positionDelta)} ตำแหน่ง (${prevPosition} → #${curr.position})`,
        });
      }

      // Position loss: dropped ≥3 positions AND had impressions
      if (positionDelta !== null && positionDelta >= 3 && prevImpressions >= 15) {
        insights.push({
          type: "position_loss",
          query,
          currClicks: curr.clicks,
          currImpressions: curr.impressions,
          currCtr: curr.ctr,
          currPosition: curr.position,
          prevPosition: prevPosition ?? undefined,
          positionDelta,
          label: "Position ร่วง",
          detail: `"${query}" อันดับลดลง ${positionDelta} ตำแหน่ง (${prevPosition} → #${curr.position})`,
        });
      }

      // Low CTR: impressions ≥100, CTR <1.5%
      if (curr.impressions >= 100 && curr.ctr < 1.5) {
        insights.push({
          type: "low_ctr",
          query,
          currClicks: curr.clicks,
          currImpressions: curr.impressions,
          currCtr: curr.ctr,
          currPosition: curr.position,
          label: "CTR ต่ำ — ควรปรับ Snippet",
          detail: `"${query}" มี ${curr.impressions.toLocaleString()} impressions แต่ CTR แค่ ${curr.ctr}% (#${curr.position})`,
        });
      }

      // Opportunity: position 4-10, impressions ≥50
      if (curr.position >= 4 && curr.position <= 10 && curr.impressions >= 50) {
        insights.push({
          type: "opportunity",
          query,
          currClicks: curr.clicks,
          currImpressions: curr.impressions,
          currCtr: curr.ctr,
          currPosition: curr.position,
          label: "โอกาสขึ้น Top 3",
          detail: `"${query}" อยู่อันดับ #${curr.position} — ${curr.impressions.toLocaleString()} impressions รอดันขึ้น Top 3`,
        });
      }

      // Page 2: position 11-20, impressions ≥30
      if (curr.position > 10 && curr.position <= 20 && curr.impressions >= 30) {
        insights.push({
          type: "page_2",
          query,
          currClicks: curr.clicks,
          currImpressions: curr.impressions,
          currCtr: curr.ctr,
          currPosition: curr.position,
          label: "หน้า 2 — ต้อง Push",
          detail: `"${query}" อยู่หน้า 2 อันดับ #${curr.position} — ${curr.impressions.toLocaleString()} impressions`,
        });
      }
    }

    // ── Analyse per-page (position gain/loss for pages) ───────────────────────
    for (const row of pageCurr.data.rows ?? []) {
      const page = row.keys?.[0] ?? "";
      const curr = {
        clicks:      row.clicks ?? 0,
        impressions: row.impressions ?? 0,
        ctr:         Number(((row.ctr ?? 0) * 100).toFixed(1)),
        position:    Number((row.position ?? 0).toFixed(1)),
      };
      const prev = prevPageMap.get(page);
      if (!prev) continue;

      const prevPosition = Number((prev.position ?? 0).toFixed(1));
      const positionDelta = Number((curr.position - prevPosition).toFixed(1));
      const clicksDelta = pct(curr.clicks, prev.clicks ?? 0);

      // Page rising fast
      if (clicksDelta >= 50 && curr.clicks >= 10) {
        insights.push({
          type: "rising_query",
          page,
          currClicks: curr.clicks,
          currImpressions: curr.impressions,
          currCtr: curr.ctr,
          currPosition: curr.position,
          prevClicks: prev.clicks ?? 0,
          clicksDelta,
          label: "หน้าที่ Clicks พุ่งขึ้น",
          detail: `หน้า ${page.replace(/^https?:\/\/[^/]+/, "")} clicks +${clicksDelta}% เทียบช่วงก่อนหน้า`,
        });
      }

      // Page dropping fast
      if (clicksDelta <= -40 && (prev.clicks ?? 0) >= 10) {
        insights.push({
          type: "declining_query",
          page,
          currClicks: curr.clicks,
          currImpressions: curr.impressions,
          currCtr: curr.ctr,
          currPosition: curr.position,
          prevClicks: prev.clicks ?? 0,
          clicksDelta,
          positionDelta,
          label: "หน้าที่ Clicks ลดลง",
          detail: `หน้า ${page.replace(/^https?:\/\/[^/]+/, "")} clicks ${clicksDelta}% ต้องตรวจสอบ`,
        });
      }
    }

    // Sort by priority: new > rising > declining > position changes > low_ctr > opportunity > page_2
    const ORDER: Record<GscInsightItem["type"], number> = {
      new_keyword:      0,
      rising_query:     1,
      declining_query:  2,
      position_gain:    3,
      position_loss:    4,
      low_ctr:          5,
      high_ctr:         6,
      opportunity:      7,
      page_2:           8,
    };
    insights.sort((a, b) => ORDER[a.type] - ORDER[b.type]);

    return NextResponse.json({
      period: { start: fmt(startDate), end: fmt(endDate), prevStart: fmt(prevStart), prevEnd: fmt(prevEnd), days },
      insights: insights.slice(0, 50), // cap at 50
      counts: {
        total: insights.length,
        new_keyword:     insights.filter(i => i.type === "new_keyword").length,
        rising:          insights.filter(i => i.type === "rising_query").length,
        declining:       insights.filter(i => i.type === "declining_query").length,
        position_change: insights.filter(i => i.type === "position_gain" || i.type === "position_loss").length,
        low_ctr:         insights.filter(i => i.type === "low_ctr").length,
        opportunity:     insights.filter(i => i.type === "opportunity").length,
        page_2:          insights.filter(i => i.type === "page_2").length,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
