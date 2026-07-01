import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

async function fetchPSI(url: string, strategy: "mobile" | "desktop") {
  const apiKey = process.env.PAGESPEED_API_KEY ?? "";
  const params = new URLSearchParams({
    url, strategy, category: "performance",
    ...(apiKey ? { key: apiKey } : {}),
  });

  const r = await fetch(`${PSI_ENDPOINT}?${params}`, { next: { revalidate: 3600 } });
  if (r.status === 429) return { strategy, status: "rate_limited" };
  if (!r.ok) return { strategy, status: "error", message: `HTTP ${r.status}` };

  const data = await r.json();
  const cats   = data?.lighthouseResult?.categories ?? {};
  const audits = data?.lighthouseResult?.audits     ?? {};

  const score = (key: string) => {
    const s = cats[key]?.score;
    return s != null ? Math.round(s * 100) : null;
  };
  const dv = (key: string) => audits[key]?.displayValue ?? "N/A";
  const nv = (key: string) => {
    const v = audits[key]?.numericValue;
    return v != null ? Number(Number(v).toFixed(1)) : null;
  };

  const inp_dv = dv("interaction-to-next-paint");
  const responsiveness = inp_dv !== "N/A"
    ? { metric: "INP", value: inp_dv, numericValue: nv("interaction-to-next-paint") }
    : { metric: "TBT", value: dv("total-blocking-time"), numericValue: nv("total-blocking-time") };

  // Top opportunities
  const opportunities: { type: string; savings?: string }[] = [];
  const unusedJs = (audits["unused-javascript"]?.details?.items ?? []) as { wastedBytes?: number }[];
  const totalUnused = unusedJs.reduce((s: number, i) => s + (i.wastedBytes ?? 0), 0);
  if (totalUnused > 50000) opportunities.push({ type: "unused_javascript", savings: `${Math.round(totalUnused / 1024)}KB` });

  const blockings = (audits["render-blocking-resources"]?.details?.items ?? []) as { wastedMs?: number; url?: string }[];
  blockings.slice(0, 2).forEach((i) => {
    if ((i.wastedMs ?? 0) > 100) opportunities.push({ type: "render_blocking", savings: `${i.wastedMs}ms` });
  });

  return {
    strategy, status: "ok",
    scores: {
      performance: score("performance"),
      accessibility: score("accessibility"),
      seo: score("seo"),
    },
    vitals: {
      fcp:   { display: dv("first-contentful-paint"),   value: nv("first-contentful-paint") },
      lcp:   { display: dv("largest-contentful-paint"),  value: nv("largest-contentful-paint") },
      cls:   { display: dv("cumulative-layout-shift"),   value: nv("cumulative-layout-shift") },
      ttfb:  { display: dv("server-response-time"),      value: nv("server-response-time") },
      si:    { display: dv("speed-index"),               value: nv("speed-index") },
      responsiveness,
    },
    opportunities,
  };
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { url } = await req.json();
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });

  try {
    const [mobile, desktop] = await Promise.all([
      fetchPSI(url, "mobile"),
      fetchPSI(url, "desktop"),
    ]);
    return NextResponse.json({ url, mobile, desktop });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
