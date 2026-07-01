// SEO Performance Report — Insight Engine
// Report-only. Does not create tasks, assign owners, or generate workflow items.

export interface GscInsightItem {
  type:
    | "new_keyword"
    | "rising_query"
    | "declining_query"
    | "position_gain"
    | "position_loss"
    | "low_ctr"
    | "high_ctr"
    | "opportunity"
    | "page_2";
  query?: string;
  page?: string;
  currClicks: number;
  currImpressions: number;
  currCtr: number;
  currPosition: number;
  prevClicks?: number;
  prevImpressions?: number;
  prevPosition?: number;
  clicksDelta?: number;
  impressionsDelta?: number;
  positionDelta?: number;
  label: string;
  detail: string;
}

export interface GSCOverview {
  clicks: number; impressions: number; ctr: number; position: number;
  clicksDelta: number; impressionsDelta: number; ctrDelta: number; positionDelta: number;
}
export interface GSCRow {
  page?: string; query?: string;
  clicks: number; impressions: number; ctr: number; position: number;
}
export interface GSCData {
  overview: GSCOverview;
  pages: (GSCRow & { page: string })[];
  queries: (GSCRow & { query: string })[];
  devices: { device: string; clicks: number; impressions: number }[];
  period: { start: string; end: string; days: number };
}

export interface GA4Overview {
  sessions: number; users: number; conversions: number; revenue: number;
  engagementRate: number;
  sessionsDelta: number; usersDelta: number; conversionsDelta: number; revenueDelta: number;
}
export interface GA4Channel {
  channel: string; sessions: number; conversions: number; revenue: number;
}
export interface GA4Page {
  path: string; views: number; sessions: number; bounceRate: number; engagementRate: number;
}
export interface GA4Event {
  event: string; isConversion: boolean; count: number; conversions: number;
}
export interface GA4Data {
  overview: GA4Overview;
  channels: GA4Channel[];
  pages: GA4Page[];
  devices: { device: string; sessions: number; conversions: number }[];
  events: GA4Event[];
  period: { start: string; end: string; days: number };
}

export interface PSIStrategy {
  status: string;
  scores: { performance: number | null; accessibility: number | null; seo: number | null };
  vitals: {
    lcp: { display: string; value: number | null };
    cls: { display: string; value: number | null };
    fcp: { display: string; value: number | null };
    ttfb: { display: string; value: number | null };
    responsiveness: { metric: string; value: string; numericValue: number | null };
  };
  opportunities: { type: string; savings?: string }[];
}
export interface PSIData { url: string; mobile?: PSIStrategy; desktop?: PSIStrategy }

export interface AiMetric {
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  impressionsDelta: number;
  clicksDelta: number;
}

export interface GscAiData {
  available: boolean;
  reason?: string;
  period?: { start: string; end: string; days: number };
  aiOverviews: AiMetric | null;
  aiMode: AiMetric | null;
}

export interface SEOInsight {
  type: "opportunity" | "warning" | "risk" | "strength";
  area: "gsc" | "ga4" | "conversion" | "pagespeed" | "connected" | "ai";
  title: string;
  finding: string;
  impact: string;
  recommendation: string;
}

// ── Normalize URL for cross-source joining ─────────────────────────────────────
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return u.pathname.replace(/\/$/, "") || "/";
  } catch { return raw; }
}

// ── GSC Insights ──────────────────────────────────────────────────────────────
export function deriveGSCInsights(gsc: GSCData): SEOInsight[] {
  const insights: SEOInsight[] = [];
  const { overview, queries, pages } = gsc;

  // Overall direction
  if (overview.clicksDelta > 10 && overview.impressionsDelta > 5) {
    insights.push({
      type: "strength", area: "gsc",
      title: "Organic Visibility Growing",
      finding: `Clicks increased ${overview.clicksDelta}% and impressions ${overview.impressionsDelta}% vs previous period.`,
      impact: "The website is gaining organic reach. Search engines are showing the site more often and users are clicking through.",
      recommendation: "Continue publishing high-quality content targeting growing keywords. Protect ranking positions with regular content updates.",
    });
  } else if (overview.clicksDelta < -10) {
    insights.push({
      type: "risk", area: "gsc",
      title: "Organic Clicks Declining",
      finding: `Clicks dropped ${Math.abs(overview.clicksDelta)}% vs previous period.`,
      impact: "Fewer users are reaching the site from organic search. This may affect leads and conversions.",
      recommendation: "Review pages that lost clicks. Check for ranking drops, title/meta changes, or algorithm updates affecting the site.",
    });
  }

  // CTR drop with stable impressions = snippet issue
  if (overview.ctrDelta < -15 && overview.impressionsDelta >= -5) {
    insights.push({
      type: "opportunity", area: "gsc",
      title: "CTR Dropped — Search Snippet May Need Improvement",
      finding: `CTR declined ${Math.abs(overview.ctrDelta)}% while impressions remained stable. The site is visible but fewer users are clicking.`,
      impact: "Low CTR means lost traffic despite good ranking positions. Improving title tags and meta descriptions can recover clicks without needing higher rankings.",
      recommendation: "Review title tags and meta descriptions for top-impression pages. Make them more compelling, benefit-driven, and include target keywords naturally.",
    });
  }

  // High-impression low-CTR queries
  const ctrOpportunities = queries.filter(q => q.impressions >= 100 && q.ctr < 2);
  if (ctrOpportunities.length > 0) {
    insights.push({
      type: "opportunity", area: "gsc",
      title: `${ctrOpportunities.length} Keyword${ctrOpportunities.length > 1 ? "s" : ""} with High Impressions but Low CTR`,
      finding: `Queries like "${ctrOpportunities[0]?.query}" appear frequently in search results but get very few clicks (CTR below 2%).`,
      impact: "These keywords represent untapped traffic. Small improvements to search snippets could deliver significant click increases.",
      recommendation: "Improve title tags and meta descriptions for these pages. Use power words, numbers, and clear value propositions to increase click appeal.",
    });
  }

  // Quick-win ranking opportunities (positions 4–10)
  const quickWins = queries.filter(q => q.position >= 4 && q.position <= 10 && q.impressions >= 50);
  if (quickWins.length > 0) {
    insights.push({
      type: "opportunity", area: "gsc",
      title: `${quickWins.length} Quick-Win Ranking Opportunit${quickWins.length > 1 ? "ies" : "y"} (Positions 4–10)`,
      finding: `Keywords such as "${quickWins[0]?.query}" are ranking on the first page (positions 4–10). These are close to top-3 positions.`,
      impact: "Moving from position 4–10 to top 3 can dramatically increase clicks. Top 3 positions capture the majority of organic traffic.",
      recommendation: "Improve content depth, add internal links, and refresh these pages with updated information to push rankings into top 3.",
    });
  }

  // Content optimization opportunity (positions 11–20)
  const page2Targets = queries.filter(q => q.position > 10 && q.position <= 20 && q.impressions >= 30);
  if (page2Targets.length > 0) {
    insights.push({
      type: "opportunity", area: "gsc",
      title: `${page2Targets.length} Keyword${page2Targets.length > 1 ? "s" : ""} on Page 2 — Content Optimization Needed`,
      finding: `Keywords like "${page2Targets[0]?.query}" rank on page 2 (positions 11–20). They appear in search but rarely get clicked.`,
      impact: "Page 2 keywords receive very little traffic. Improving content quality can push them to page 1 and unlock significant new traffic.",
      recommendation: "Expand content coverage, improve heading structure, add FAQs, and build internal links to these pages.",
    });
  }

  return insights;
}

// ── GA4 Insights ──────────────────────────────────────────────────────────────
export function deriveGA4Insights(ga4: GA4Data): SEOInsight[] {
  const insights: SEOInsight[] = [];
  const { overview, channels, pages, events } = ga4;

  // Organic channel check
  const organic = channels.find(c => c.channel.toLowerCase().includes("organic"));
  if (organic) {
    const organicPct = overview.sessions > 0 ? Math.round(organic.sessions / overview.sessions * 100) : 0;
    if (organicPct >= 40) {
      insights.push({
        type: "strength", area: "ga4",
        title: `Organic Search is the #1 Traffic Source (${organicPct}%)`,
        finding: `Organic search drives ${organicPct}% of all sessions. This shows strong SEO foundation.`,
        impact: "High organic dependence means SEO performance directly impacts business results. Maintaining and growing this channel is critical.",
        recommendation: "Continue investing in SEO content and technical optimization. Monitor organic traffic weekly for early detection of drops.",
      });
    }
  }

  // Engagement rate
  if (overview.engagementRate < 40) {
    insights.push({
      type: "warning", area: "ga4",
      title: "Low Engagement Rate — Possible Content or Intent Mismatch",
      finding: `Overall engagement rate is ${overview.engagementRate.toFixed(1)}%. Many visitors are leaving quickly.`,
      impact: "Low engagement signals that visitors are not finding what they searched for. This may hurt conversion rates and may send negative UX signals to search engines.",
      recommendation: "Review landing pages with high traffic but low engagement. Check if content matches search intent. Improve page load speed and above-the-fold content.",
    });
  } else if (overview.engagementRate >= 65) {
    insights.push({
      type: "strength", area: "ga4",
      title: "Strong Engagement Rate",
      finding: `Engagement rate of ${overview.engagementRate.toFixed(1)}% is above the typical benchmark.`,
      impact: "High engagement signals content quality and intent match. This supports both conversions and organic ranking.",
      recommendation: "Identify the top-engaged pages and use them as templates for new content creation.",
    });
  }

  // High traffic + low engagement pages
  const weakPages = pages.filter(p => p.sessions >= 30 && p.engagementRate < 35);
  if (weakPages.length > 0) {
    insights.push({
      type: "warning", area: "ga4",
      title: `${weakPages.length} Page${weakPages.length > 1 ? "s" : ""} with High Traffic but Low Engagement`,
      finding: `Pages like "${weakPages[0]?.path}" receive significant traffic but have engagement rates below 35%.`,
      impact: "These pages attract users who quickly leave. This may indicate content-intent mismatch, poor UX, or slow load speed — all of which can hurt conversion.",
      recommendation: "Review content relevance, page structure, and load performance on these pages. Ensure above-the-fold content immediately addresses user intent.",
    });
  }

  // Conversion events available
  const convEvents = events.filter(e => e.isConversion);
  if (convEvents.length === 0) {
    insights.push({
      type: "warning", area: "conversion",
      title: "No Conversion Events Detected in GA4",
      finding: "No conversion events were found in the selected date range.",
      impact: "Without conversion tracking, it is not possible to measure SEO's contribution to business outcomes.",
      recommendation: "Set up GA4 conversion events for key actions such as form submissions, phone clicks, LINE clicks, or purchases. This is critical for measuring SEO ROI.",
    });
  }

  return insights;
}

// ── Conversion Insights ───────────────────────────────────────────────────────
export function deriveConversionInsights(ga4: GA4Data): SEOInsight[] {
  const insights: SEOInsight[] = [];
  const { overview, pages, channels, events } = ga4;

  const organic = channels.find(c => c.channel.toLowerCase().includes("organic"));
  const convRate = overview.sessions > 0
    ? (overview.conversions / overview.sessions * 100)
    : 0;

  if (organic && organic.conversions > 0) {
    const organicConvRate = organic.sessions > 0
      ? (organic.conversions / organic.sessions * 100).toFixed(2)
      : "0";
    insights.push({
      type: "strength", area: "conversion",
      title: "Organic Search is Generating Conversions",
      finding: `Organic search produced ${organic.conversions} conversions with a ${organicConvRate}% conversion rate.`,
      impact: "SEO is directly contributing to business outcomes. Organic conversions represent high-intent users who found the business through search.",
      recommendation: "Continue tracking organic conversions. Identify which landing pages convert best and create more content on similar topics.",
    });
  }

  // High traffic, low conversion pages
  const highTrafficLowConv = pages.filter(p => p.sessions >= 30 && p.engagementRate >= 50);
  if (highTrafficLowConv.length > 0 && convRate < 1) {
    insights.push({
      type: "opportunity", area: "conversion",
      title: "High-Traffic Pages Not Converting — CRO Opportunity",
      finding: `Pages like "${highTrafficLowConv[0]?.path}" receive good traffic and engagement but overall conversion rate is only ${convRate.toFixed(2)}%.`,
      impact: "Improving conversion rate on engaged pages can significantly increase leads without needing more traffic.",
      recommendation: "Add clear calls-to-action, improve contact forms, add social proof, and test different CTA placements on high-traffic pages.",
    });
  }

  // Top conversion events
  const topConvEvents = events.filter(e => e.isConversion).sort((a, b) => b.conversions - a.conversions);
  if (topConvEvents.length > 0) {
    insights.push({
      type: "strength", area: "conversion",
      title: `Top Conversion Event: ${topConvEvents[0].event}`,
      finding: `"${topConvEvents[0].event}" generated ${topConvEvents[0].conversions} conversions in this period.`,
      impact: "Understanding which conversion events drive the most value helps prioritize SEO pages and content.",
      recommendation: `Focus SEO content on pages that lead to "${topConvEvents[0].event}" conversions. Create more content that addresses the same user intent.`,
    });
  }

  return insights;
}

// ── PageSpeed Insights ────────────────────────────────────────────────────────
export function derivePSIInsights(psi: PSIData): SEOInsight[] {
  const insights: SEOInsight[] = [];
  const mobile = psi.mobile?.status === "ok" ? psi.mobile : null;
  const desktop = psi.desktop?.status === "ok" ? psi.desktop : null;

  if (!mobile && !desktop) return insights;

  const mobileScore = mobile?.scores.performance ?? null;
  const desktopScore = desktop?.scores.performance ?? null;

  // Mobile performance
  if (mobileScore !== null) {
    if (mobileScore < 50) {
      insights.push({
        type: "risk", area: "pagespeed",
        title: "Poor Mobile Performance Score",
        finding: `Mobile performance score is ${mobileScore}/100, which is considered poor.`,
        impact: "Google uses mobile-first indexing. Poor mobile speed directly affects rankings, engagement, and conversion. Users on mobile are likely experiencing slow page loads.",
        recommendation: "Prioritize mobile speed improvements: compress images, reduce unused JavaScript, improve server response time, and implement lazy loading.",
      });
    } else if (mobileScore < 90) {
      insights.push({
        type: "warning", area: "pagespeed",
        title: "Mobile Performance Needs Improvement",
        finding: `Mobile performance score is ${mobileScore}/100. Good target is 90+.`,
        impact: "Moderate mobile speed may not cause immediate ranking drops but can hurt engagement and conversion, especially on slower networks.",
        recommendation: "Review PageSpeed opportunities and address the highest-savings items first. Aim for 90+ for competitive markets.",
      });
    } else {
      insights.push({
        type: "strength", area: "pagespeed",
        title: "Excellent Mobile Performance",
        finding: `Mobile performance score is ${mobileScore}/100.`,
        impact: "Fast mobile speed supports good rankings, high engagement, and better conversion rates.",
        recommendation: "Maintain current performance standards. Monitor after any new feature launches or third-party script additions.",
      });
    }
  }

  // CWV checks on mobile
  if (mobile) {
    const lcpMs = mobile.vitals.lcp.value;
    if (lcpMs !== null && lcpMs > 4000) {
      insights.push({
        type: "risk", area: "pagespeed",
        title: "Poor LCP — Main Content Loads Too Slowly",
        finding: `Largest Contentful Paint (LCP) is ${mobile.vitals.lcp.display} on mobile. Good threshold is under 2.5 seconds.`,
        impact: "Slow LCP means users wait a long time before seeing the main content. This increases abandonment and can hurt rankings as a Core Web Vitals signal.",
        recommendation: "Optimize the largest visual element: compress hero images, preload critical resources, use CDN, and reduce server response time (TTFB).",
      });
    }

    const cls = mobile.vitals.cls.value;
    if (cls !== null && cls > 0.25) {
      insights.push({
        type: "risk", area: "pagespeed",
        title: "High CLS — Layout Shifts Causing Poor UX",
        finding: `Cumulative Layout Shift (CLS) is ${mobile.vitals.cls.display}. Good threshold is below 0.1.`,
        impact: "Layout shifts cause buttons and links to move while users try to click. This directly damages conversion rates and is a negative user experience signal.",
        recommendation: "Reserve space for images and ads using CSS aspect-ratio. Avoid inserting content above the fold after the page loads.",
      });
    }

    // Opportunities
    if (mobile.opportunities.length > 0) {
      const savings = mobile.opportunities.map(o => o.type.replace(/_/g, " ")).join(", ");
      insights.push({
        type: "warning", area: "pagespeed",
        title: "Technical Optimization Opportunities Found",
        finding: `Mobile PageSpeed identified the following issues: ${savings}.`,
        impact: "These issues contribute to slower page loads which affect both user experience and SEO performance.",
        recommendation: "Work with a developer to address these opportunities. Prioritize by estimated savings impact.",
      });
    }
  }

  return insights;
}

// ── Connected Loop Insights ───────────────────────────────────────────────────
export function deriveConnectedInsights(
  gsc: GSCData | null,
  ga4: GA4Data | null,
  psi: PSIData | null
): SEOInsight[] {
  const insights: SEOInsight[] = [];

  // PSI poor + GA4 low conversion = compound risk
  if (psi?.mobile?.status === "ok" && ga4) {
    const mScore = psi.mobile.scores.performance ?? 100;
    const convRate = ga4.overview.sessions > 0
      ? ga4.overview.conversions / ga4.overview.sessions * 100
      : 0;
    if (mScore < 60 && convRate < 1) {
      insights.push({
        type: "risk", area: "connected",
        title: "Slow Page Speed + Low Conversion — Compound Risk",
        finding: "Mobile performance is poor and the overall conversion rate is low. These two factors are likely linked.",
        impact: "Slow pages frustrate users before they can convert. Improving speed is likely to also improve conversion rate.",
        recommendation: "Treat page speed improvements as a conversion optimization priority, not just a technical task. Even a 1-second improvement can lift conversions meaningfully.",
      });
    }
  }

  // GSC impressions up + GA4 sessions up + low conversion = visibility without ROI
  if (gsc && ga4) {
    const growingVisibility = gsc.overview.impressionsDelta > 10;
    const growingSessions   = ga4.overview.sessionsDelta > 10;
    const lowConversion     = ga4.overview.conversions < 5;
    if (growingVisibility && growingSessions && lowConversion) {
      insights.push({
        type: "opportunity", area: "connected",
        title: "Growing Traffic but Low Conversions — CRO Opportunity",
        finding: "Search visibility and traffic are both growing, but conversions remain low. The site is attracting more visitors who are not converting.",
        impact: "This signals a disconnect between attracting visitors and converting them. Conversion optimization could unlock the full value of the SEO growth.",
        recommendation: "Audit top landing pages for conversion elements: clear CTAs, trust signals, fast load, and content that addresses user intent at the decision stage.",
      });
    }
  }

  // GSC CTR opportunity + GA4 weak engagement = double intent problem
  if (gsc && ga4) {
    const lowCTR  = gsc.overview.ctr < 3;
    const lowEng  = ga4.overview.engagementRate < 45;
    if (lowCTR && lowEng) {
      insights.push({
        type: "warning", area: "connected",
        title: "Low CTR and Low Engagement — Possible Intent Mismatch",
        finding: "Both search CTR and on-page engagement are low. Users are not compelled to click, and those who do leave quickly.",
        impact: "This suggests the search snippets may not match what users want, and the landing page content may not deliver what was implied in the title.",
        recommendation: "Rewrite title tags and meta descriptions to accurately reflect page content. Then align page content to better satisfy the user intent behind the top queries.",
      });
    }
  }

  return insights;
}

// ── AI Performance Insights ───────────────────────────────────────────────────
export function deriveAIInsights(ai: GscAiData): SEOInsight[] {
  const insights: SEOInsight[] = [];
  if (!ai.available) return insights;

  const ao = ai.aiOverviews;
  const am = ai.aiMode;
  const totalImpr = (ao?.impressions ?? 0) + (am?.impressions ?? 0);
  const totalClicks = (ao?.clicks ?? 0) + (am?.clicks ?? 0);

  // Has meaningful AI visibility
  if (totalImpr > 0) {
    const ctr = totalImpr > 0 ? (totalClicks / totalImpr * 100).toFixed(1) : "0";
    insights.push({
      type: "strength", area: "ai",
      title: "เว็บไซต์ปรากฏใน AI-Generated Results",
      finding: `เว็บไซต์ถูกแสดงผลใน AI Overviews / AI Mode รวม ${totalImpr.toLocaleString()} impressions และ ${totalClicks.toLocaleString()} clicks (CTR ${ctr}%)`,
      impact: "การปรากฏใน AI Overviews และ AI Mode บน Google Search ช่วยเพิ่ม brand visibility และ traffic ในยุค AI Search — เป็นสัญญาณว่าเนื้อหาของเว็บไซต์ได้รับการอ้างอิงจาก AI",
      recommendation: "รักษา E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness) ของเนื้อหา เพิ่ม structured data / FAQ schema และสร้างเนื้อหาที่ตอบคำถามผู้ใช้ได้ตรงจุด เพื่อเพิ่มโอกาสถูก AI อ้างอิง",
    });
  } else {
    insights.push({
      type: "opportunity", area: "ai",
      title: "ยังไม่ปรากฏใน AI Search Results",
      finding: "ในช่วงเวลาที่วิเคราะห์ เว็บไซต์ยังไม่มี impressions จาก AI Overviews หรือ AI Mode บน Google Search",
      impact: "AI Overviews และ AI Mode กำลังกลายเป็น touchpoint หลักบน Google Search — หากเนื้อหาไม่ถูกอ้างอิงใน AI results อาจสูญเสีย visibility ในระยะยาว",
      recommendation: "สร้างเนื้อหาแบบ Q&A ที่ตอบคำถามผู้ใช้โดยตรง เพิ่ม FAQ schema markup ปรับ heading structure ให้ชัดเจน และสร้าง content ที่มีข้อมูลเชิงลึก (EEAT) เพื่อเพิ่มโอกาสถูก AI อ้างอิง",
    });
  }

  // AI Overviews specific
  if (ao && ao.impressions > 0) {
    if (ao.impressionsDelta > 20) {
      insights.push({
        type: "strength", area: "ai",
        title: `AI Overviews Impressions เพิ่มขึ้น ${ao.impressionsDelta}%`,
        finding: `AI Overviews impressions เพิ่มขึ้น ${ao.impressionsDelta}% เทียบกับช่วงก่อนหน้า (${ao.impressions.toLocaleString()} impressions, ${ao.clicks.toLocaleString()} clicks)`,
        impact: "Google AI กำลังอ้างอิงเนื้อหาของเว็บไซต์มากขึ้นใน AI Overviews ซึ่งแสดงที่ตำแหน่งบนสุดของหน้าผลการค้นหา",
        recommendation: "วิเคราะห์ว่า keyword ใดที่ทำให้เกิด AI Overview impressions และสร้างเนื้อหาเพิ่มเติมในทิศทางเดียวกัน",
      });
    } else if (ao.impressionsDelta < -15) {
      insights.push({
        type: "warning", area: "ai",
        title: `AI Overviews Impressions ลดลง ${Math.abs(ao.impressionsDelta)}%`,
        finding: `AI Overviews impressions ลดลง ${Math.abs(ao.impressionsDelta)}% เทียบกับช่วงก่อนหน้า`,
        impact: "เนื้อหาอาจถูก AI อ้างอิงน้อยลง อาจเกิดจาก Google ปรับ algorithm หรือมีเนื้อหาคู่แข่งที่ดีกว่า",
        recommendation: "ทบทวนและอัปเดตเนื้อหาที่เคยได้รับ AI Overviews impressions — เพิ่มความครบถ้วน ความถูกต้อง และ structured data",
      });
    }

    if (ao.ctr < 1 && ao.impressions >= 100) {
      insights.push({
        type: "opportunity", area: "ai",
        title: "AI Overviews CTR ต่ำ — มีโอกาสเพิ่ม Click-Through",
        finding: `CTR จาก AI Overviews อยู่ที่ ${ao.ctr.toFixed(1)}% ซึ่งต่ำกว่าเกณฑ์ที่ควรเป็น (impressions: ${ao.impressions.toLocaleString()})`,
        impact: "ผู้ใช้เห็นเนื้อหาของเว็บไซต์ใน AI Overview แต่ไม่คลิก — อาจเกิดจากเนื้อหาที่แสดงใน AI ตอบคำถามได้ครบจนไม่จำเป็นต้องเข้าเว็บ",
        recommendation: "เพิ่ม call-to-action ในเนื้อหา เพิ่มข้อมูลเชิงลึกที่ AI ไม่สามารถสรุปได้ทั้งหมด เช่น ตัวอย่างจริง case study ราคา และบริการเฉพาะ",
      });
    }
  }

  // AI Mode specific
  if (am && am.impressions > 0) {
    if (am.impressionsDelta > 30) {
      insights.push({
        type: "strength", area: "ai",
        title: `AI Mode Impressions เพิ่มขึ้น ${am.impressionsDelta}%`,
        finding: `AI Mode impressions เพิ่มขึ้น ${am.impressionsDelta}% (${am.impressions.toLocaleString()} impressions, ${am.clicks.toLocaleString()} clicks) — เว็บไซต์ถูกอ้างอิงใน Conversational AI Search มากขึ้น`,
        impact: "AI Mode เป็น feature ใหม่ของ Google ที่ใช้ Conversational AI ตอบคำถาม — การปรากฏในช่องทางนี้ช่วย reach ผู้ใช้ที่ค้นหาด้วยคำถามยาวและ complex queries",
        recommendation: "สร้างเนื้อหาที่ตอบ multi-turn questions ในรูปแบบ conversational เช่น FAQ เชิงลึก comparison tables และ how-to guides",
      });
    }
  }

  return insights;
}

// ── Executive Summary Generator ───────────────────────────────────────────────
export interface ExecutiveSummary {
  direction: "growth" | "stable" | "decline" | "mixed";
  headline: string;
  summary: string;
  mainStrengths: string[];
  mainRisks: string[];
  mainOpportunities: string[];
}

export function buildExecutiveSummary(
  gsc: GSCData | null,
  ga4: GA4Data | null,
  psi: PSIData | null,
  allInsights: SEOInsight[]
): ExecutiveSummary {
  const strengths    = allInsights.filter(i => i.type === "strength");
  const risks        = allInsights.filter(i => i.type === "risk");
  const opportunities = allInsights.filter(i => i.type === "opportunity");
  const warnings     = allInsights.filter(i => i.type === "warning");

  // Determine overall direction
  let direction: ExecutiveSummary["direction"] = "stable";
  if (gsc) {
    const clickGrowth = gsc.overview.clicksDelta;
    const posImprove  = gsc.overview.positionDelta < -1;
    if (clickGrowth > 10 || posImprove) direction = "growth";
    else if (clickGrowth < -10) direction = "decline";
    else if (risks.length > 1 && strengths.length > 0) direction = "mixed";
  }

  const directionLabel: Record<string, string> = {
    growth: "SEO performance is growing",
    stable: "SEO performance is stable",
    decline: "SEO performance is declining",
    mixed: "SEO performance shows mixed signals",
  };

  const gscSummary = gsc
    ? `Organic search delivered ${gsc.overview.clicks.toLocaleString()} clicks and ${gsc.overview.impressions.toLocaleString()} impressions over the period.`
    : "";
  const ga4Summary = ga4
    ? `GA4 recorded ${ga4.overview.sessions.toLocaleString()} sessions with a ${ga4.overview.engagementRate.toFixed(1)}% engagement rate.`
    : "";
  const convSummary = ga4?.overview.conversions
    ? `${ga4.overview.conversions.toLocaleString()} conversion${ga4.overview.conversions !== 1 ? "s" : ""} were tracked.`
    : "";
  const psiSummary = psi?.mobile?.status === "ok" && psi.mobile.scores.performance !== null
    ? `Mobile performance scores at ${psi.mobile.scores.performance}/100.`
    : "";

  const summary = [gscSummary, ga4Summary, convSummary, psiSummary].filter(Boolean).join(" ");

  return {
    direction,
    headline: directionLabel[direction],
    summary,
    mainStrengths:    strengths.map(i => i.title).slice(0, 3),
    mainRisks:        [...risks, ...warnings].map(i => i.title).slice(0, 3),
    mainOpportunities: opportunities.map(i => i.title).slice(0, 3),
  };
}

// ── Recommendations Builder ───────────────────────────────────────────────────
export interface RecommendationGroup {
  area: string;
  items: string[];
}

export function buildRecommendations(allInsights: SEOInsight[]): RecommendationGroup[] {
  const byArea: Record<string, string[]> = {
    "Search Visibility":        [],
    "AI Search Optimization":   [],
    "Content & Landing Pages":  [],
    "Conversion Optimization":  [],
    "Technical & PageSpeed":    [],
    "Measurement & Tracking":   [],
  };

  for (const insight of allInsights) {
    if (!insight.recommendation) continue;
    if (insight.area === "gsc")        byArea["Search Visibility"].push(insight.recommendation);
    else if (insight.area === "ai")    byArea["AI Search Optimization"].push(insight.recommendation);
    else if (insight.area === "ga4")   byArea["Content & Landing Pages"].push(insight.recommendation);
    else if (insight.area === "conversion") byArea["Conversion Optimization"].push(insight.recommendation);
    else if (insight.area === "pagespeed") byArea["Technical & PageSpeed"].push(insight.recommendation);
    else if (insight.area === "connected") byArea["Conversion Optimization"].push(insight.recommendation);
  }

  // Deduplicate
  for (const key of Object.keys(byArea)) {
    byArea[key] = Array.from(new Set(byArea[key]));
  }

  return Object.entries(byArea)
    .filter(([, items]) => items.length > 0)
    .map(([area, items]) => ({ area, items }));
}
