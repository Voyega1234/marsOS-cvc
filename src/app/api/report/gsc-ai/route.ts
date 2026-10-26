import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { clientCanAccessSite } from "@/lib/client-access";
import { getGSCAuth } from "@/lib/google-auth";
import { google } from "googleapis";
import { makeScopedGscQuery, ownerFilterSummary, readOwnerFilterInput, resolveSmeOwnerScope, type SmeOwnerScope } from "@/lib/sme-articles/owner-report";
import type { RawGscRow } from "@/lib/upload-article/gsc-report";

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

  const body = await req.json().catch(() => ({}));
  const { siteUrl, days = 28 } = body;
  // กรองตามผู้ดูแลบทความ (SEO SME) — ทีมภายในเท่านั้น
  const ownerInput = readOwnerFilterInput(body);
  if (ownerInput && session.user.role === "CLIENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // CLIENT ดูได้เฉพาะเว็บของโปรเจกต์ตัวเอง — กันดึงข้อมูลของลูกค้ารายอื่น
  if (!(await clientCanAccessSite(session, siteUrl))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!siteUrl) return NextResponse.json({ error: "siteUrl required" }, { status: 400 });

  try {
    const auth = await getGSCAuth();
    const sc = google.searchconsole({ version: "v1", auth });

    const now = new Date();
    const endDate = new Date(now.getTime() - 3 * 86400000);
    const startDate = new Date(endDate.getTime() - days * 86400000);
    const prevEnd = new Date(startDate.getTime() - 86400000);
    const prevStart = new Date(prevEnd.getTime() - days * 86400000);
    const fmt = (d: Date) => d.toISOString().split("T")[0];

    let scope: SmeOwnerScope | null = null;
    if (ownerInput) {
      const r = await resolveSmeOwnerScope({
        sc, siteUrl, orgId: session.user.organizationId, ...ownerInput,
        ranges: [{ startDate: fmt(startDate), endDate: fmt(endDate) }, { startDate: fmt(prevStart), endDate: fmt(prevEnd) }],
      });
      if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
      scope = r.scope;
    }
    // ไม่มี scope = ทั้งเว็บเหมือนเดิม, มี scope = เฉพาะหน้าของบทความผู้ดูแล
    const scopedQuery = makeScopedGscQuery(sc, siteUrl, scope);
    const query = (searchType: string, body: Record<string, unknown>) => scopedQuery({ ...body, searchType });

    // Fetch AI Overviews and AI Mode in parallel (current + prev periods)
    const [aoCurrentRes, aoPrevRes, amCurrentRes, amPrevRes] = await Promise.allSettled([
      query("AI_OVERVIEWS", { startDate: fmt(startDate), endDate: fmt(endDate) }),
      query("AI_OVERVIEWS", { startDate: fmt(prevStart), endDate: fmt(prevEnd) }),
      query("AI_MODE", { startDate: fmt(startDate), endDate: fmt(endDate) }),
      query("AI_MODE", { startDate: fmt(prevStart), endDate: fmt(prevEnd) }),
    ]);

    const extractRow = (res: PromiseSettledResult<RawGscRow[]>) => {
      if (res.status === "rejected") return null;
      const row: GSCRow = res.value[0] ?? {};
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
      return NextResponse.json({ available: false, ownerFilter: ownerFilterSummary(scope) });
    }

    return NextResponse.json({
      available: true,
      period: { start: fmt(startDate), end: fmt(endDate), days },
      ownerFilter: ownerFilterSummary(scope),
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
