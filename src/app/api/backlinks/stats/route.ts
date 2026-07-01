// Backlink stats API — computes KPIs, review table, tasks, and scores from real DB data.
// Backlink-only scope.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function qualityScore(e: { domainRating: number | null; anchorText: string | null; sourceUrl: string | null }): number {
  let score = 40;
  const dr = e.domainRating ?? 0;
  if (dr >= 70) score += 30;
  else if (dr >= 40) score += 18;
  else if (dr >= 20) score += 8;

  if (e.anchorText && e.anchorText.length > 3 && !/^(click here|here|link|read more|this|website)$/i.test(e.anchorText)) score += 15;
  if (e.sourceUrl) {
    try {
      const host = new URL(e.sourceUrl).hostname;
      if (!host.includes("wordpress") && !host.includes("blogspot") && !host.includes("weebly")) score += 15;
    } catch { /* ignore */ }
  }
  return Math.min(100, Math.max(0, score));
}

function riskScore(e: { anchorText: string | null; sourceUrl: string | null; notes: string | null }): number {
  let score = 5;
  const anchor = (e.anchorText ?? "").toLowerCase();
  const url    = (e.sourceUrl ?? "").toLowerCase();
  const notes  = (e.notes ?? "").toLowerCase();

  const spamKeywords = ["casino", "poker", "viagra", "pills", "adult", "xxx", "loan", "payday", "crypto", "nft", "seo service", "buy backlink"];
  if (spamKeywords.some(k => anchor.includes(k) || url.includes(k) || notes.includes(k))) score += 60;

  if (anchor && anchor.length > 2 && /^[a-z\s]+$/.test(anchor) && anchor.split(" ").length <= 3) score += 20;

  const spamTlds = [".ru", ".xyz", ".tk", ".ml", ".cf", ".gq", ".ga"];
  if (spamTlds.some(t => url.includes(t))) score += 25;

  if (url.includes("fiverr") || url.includes("upwork") || notes.includes("paid")) score += 30;

  return Math.min(100, Math.max(0, score));
}

function aiRecommendation(e: { status: string; domainRating: number | null }, q: number, r: number): string {
  if (e.status === "LOST")     return q >= 60 ? "High-value lost link — reclaim fast" : "Lost link — consider outreach";
  if (e.status === "REJECTED") return "Broken target — fix with 301 redirect";
  if (r >= 70)                 return "High risk — review for disavow";
  if (r >= 40)                 return "Moderate risk — monitor closely";
  if (q >= 70)                 return "High authority — protect & monitor";
  if (q >= 50)                 return "Good placement — leverage for PR";
  return "Low value — low priority";
}

function suggestedTask(e: { status: string }, q: number, r: number): string {
  if (e.status === "LOST")     return q >= 60 ? "Outreach to reclaim" : "Monitor or replace";
  if (e.status === "REJECTED") return "Fix 404 → 301 redirect";
  if (r >= 70)                 return "Review & consider disavow";
  if (r >= 40)                 return "Monitor DR drop";
  if (q >= 70)                 return "Internal link boost";
  return "No action needed";
}

export async function GET() {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session.user.organizationId;

  const entries = await prisma.backlinkEntry.findMany({
    where: { organizationId: orgId },
    include: { project: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  const now   = Date.now();
  const week  = 7 * 86400000;
  const week2 = 14 * 86400000;

  // ── KPI calculations ──────────────────────────────────────────────────────
  const total        = entries.length;
  const domains      = new Set(entries.map(e => { try { return new URL(e.sourceUrl ?? "").hostname; } catch { return e.sourceUrl ?? ""; } }).filter(Boolean));
  const newThisWeek  = entries.filter(e => now - new Date(e.createdAt).getTime() < week).length;
  const newLastWeek  = entries.filter(e => {
    const age = now - new Date(e.createdAt).getTime();
    return age >= week && age < week2;
  }).length;
  const lostLinks    = entries.filter(e => e.status === "LOST").length;
  const brokenTarget = entries.filter(e => e.status === "REJECTED").length;

  const withScores = entries.map(e => ({
    ...e,
    quality: qualityScore(e),
    risk:    riskScore(e),
  }));

  const riskReview   = withScores.filter(e => e.risk >= 60).length;
  const geminiEnrich = withScores.filter(e => e.quality >= 70 || e.risk >= 60).length;

  // ── Task generation from real data ────────────────────────────────────────
  const tasks: { title: string; assignee: string; priority: "High" | "Medium" | "Low"; reason: string; action: string }[] = [];

  const broken = entries.filter(e => e.status === "REJECTED");
  if (broken.length > 0) tasks.push({
    title:    "Broken Backlink Fix",
    assignee: "SEO / Dev",
    priority: "High",
    reason:   `${broken.length} backlink${broken.length > 1 ? "s" : ""} pointing to broken/404 pages — losing link equity`,
    action:   "Implement 301 redirect from broken URL to correct target",
  });

  const lostHigh = withScores.filter(e => e.status === "LOST" && e.quality >= 60);
  if (lostHigh.length > 0) {
    const top = lostHigh[0];
    tasks.push({
      title:    "Lost Link Reclaim",
      assignee: "Outreach Team",
      priority: "High",
      reason:   `${lostHigh.length} high-value lost link${lostHigh.length > 1 ? "s" : ""}${top.domainRating ? ` (top DR: ${top.domainRating})` : ""}`,
      action:   "Contact editor — request republish or link update",
    });
  }

  const toxic = withScores.filter(e => e.risk >= 70);
  if (toxic.length > 0) tasks.push({
    title:    "Toxic Link Review",
    assignee: "Senior SEO",
    priority: "High",
    reason:   `${toxic.length} link${toxic.length > 1 ? "s" : ""} flagged with risk score ≥ 70`,
    action:   "Review each link — prepare disavow file if confirmed toxic",
  });

  const goodLinks = withScores.filter(e => e.quality >= 60 && e.status === "PUBLISHED");
  if (goodLinks.length > 0) tasks.push({
    title:    "Internal Link Boost",
    assignee: "Content / SEO",
    priority: "Medium",
    reason:   `${goodLinks.length} high-quality backlink${goodLinks.length > 1 ? "s" : ""} — strengthen with internal links`,
    action:   "Add 3+ internal links from high-authority pages to linked targets",
  });

  const anchors = withScores.filter(e => e.anchorText && /^[a-z\s]+$/i.test(e.anchorText) && (e.anchorText ?? "").split(" ").length <= 3);
  if (anchors.length > entries.length * 0.3 && entries.length > 5) tasks.push({
    title:    "Anchor Text Diversification",
    assignee: "SEO",
    priority: "Low",
    reason:   `${Math.round((anchors.length / entries.length) * 100)}% of links use short exact-match anchors`,
    action:   "Request anchor variation from active link partners",
  });

  // ── Quality/Risk score aggregates (for score bars) ─────────────────────
  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  const qualityFactors = {
    topicalRelevance:   avg(withScores.map(e => e.quality)),
    realWebsiteSignal:  avg(withScores.map(e => e.domainRating != null ? Math.min(100, e.domainRating) : 30)),
    anchorNaturalness:  avg(withScores.map(e => e.anchorText && e.anchorText.split(" ").length >= 2 ? 70 : 40)),
    targetPageValue:    avg(withScores.map(e => e.quality)),
    contentPlacement:   avg(withScores.map(e => e.sourceUrl ? 65 : 30)),
    sourceTrust:        avg(withScores.map(e => e.domainRating != null ? Math.min(100, e.domainRating + 10) : 25)),
    spamFootprint:      avg(withScores.map(e => Math.max(0, 100 - e.risk))),
  };

  const riskFactors = {
    spamNiche:          avg(withScores.map(e => {
      const t = (e.anchorText ?? "") + (e.sourceUrl ?? "") + (e.notes ?? "");
      return ["casino","adult","pills","crypto"].some(k => t.toLowerCase().includes(k)) ? 85 : 5;
    })),
    unnaturalAnchor:    avg(withScores.map(e => {
      const a = e.anchorText ?? "";
      return a.length > 0 && a.split(" ").length <= 2 && /^[a-z]+$/i.test(a) ? 60 : 15;
    })),
    scraperPattern:     avg(withScores.map(e => (e.notes ?? "").toLowerCase().includes("crawl") ? 50 : 10)),
    unrelatedContent:   avg(withScores.map(e => e.risk > 40 ? 45 : 10)),
    suspiciousOutbound: avg(withScores.map(e => e.risk > 60 ? 55 : 8)),
    sitewideLink:       avg(withScores.map(e => (e.notes ?? "").toLowerCase().includes("footer") ? 60 : 12)),
    newDomain:          avg(withScores.map(e => e.domainRating != null && e.domainRating < 10 ? 40 : 10)),
  };

  // ── Review table (top 8 by quality desc) ──────────────────────────────
  const reviewTable = withScores
    .sort((a, b) => b.quality - a.quality || b.risk - a.risk)
    .slice(0, 8)
    .map(e => {
      let displayStatus = "Live";
      if (e.status === "LOST")        displayStatus = "Lost";
      else if (e.status === "REJECTED") displayStatus = "Broken Target";
      else if (e.status === "PUBLISHED") displayStatus = "Live";
      else if (e.risk >= 60)          displayStatus = "Risk Review";
      else                            displayStatus = e.status.charAt(0) + e.status.slice(1).toLowerCase();

      let domain = "—";
      try { domain = new URL(e.sourceUrl ?? "").hostname.replace("www.", ""); } catch { domain = e.sourceUrl ?? "—"; }
      let target = e.targetUrl;
      try { target = new URL(e.targetUrl).pathname || "/"; } catch { /* keep */ }

      return {
        domain,
        target,
        anchor:  e.anchorText ?? "—",
        status:  displayStatus,
        quality: e.quality,
        risk:    e.risk,
        ai:      aiRecommendation(e, e.quality, e.risk),
        task:    suggestedTask(e, e.quality, e.risk),
      };
    });

  return NextResponse.json({
    kpi: {
      total, domains: domains.size, newThisWeek, newLastWeek,
      lostLinks, brokenTarget, riskReview, geminiEnrich,
      tasks: tasks.length,
    },
    reviewTable,
    tasks,
    qualityFactors,
    riskFactors,
    hasData: total > 0,
  });
}
