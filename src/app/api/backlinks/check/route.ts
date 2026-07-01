// Self link checker — verifies live/lost/broken/redirect/nofollow status
// Backlink-only scope. Does not touch other modules.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const TIMEOUT_MS = 10000;
const BATCH_SIZE = 5; // concurrent checks to avoid rate limiting

type LinkStatus = "LIVE" | "LOST" | "BROKEN_TARGET" | "REDIRECTED" | "NOFOLLOW" | "ERROR";

interface CheckResult {
  id: string;
  sourceUrl: string;
  targetUrl: string;
  status: LinkStatus;
  httpCode: number | null;
  finalUrl: string | null;
  isNofollow: boolean;
  checkedAt: string;
  error?: string;
}

async function checkLink(sourceUrl: string, targetUrl: string): Promise<{
  status: LinkStatus; httpCode: number | null; finalUrl: string | null; isNofollow: boolean; error?: string;
}> {
  // Step 1: Check if target URL is alive
  let targetCode: number | null = null;
  let targetFinal: string | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(targetUrl, {
      method: "HEAD",
      signal: ctrl.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    targetCode = res.status;
    targetFinal = res.url !== targetUrl ? res.url : null;

    if (res.status === 404 || res.status === 410) {
      return { status: "BROKEN_TARGET", httpCode: targetCode, finalUrl: targetFinal, isNofollow: false };
    }
  } catch {
    return { status: "BROKEN_TARGET", httpCode: null, finalUrl: null, isNofollow: false, error: "Target unreachable" };
  }

  // Step 2: Check if source page links to target (and check nofollow)
  if (!sourceUrl) {
    return { status: "LIVE", httpCode: targetCode, finalUrl: targetFinal, isNofollow: false };
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(sourceUrl, {
      method: "GET",
      signal: ctrl.signal,
      headers: { "User-Agent": "MarsOS-LinkChecker/1.0 (SEO monitoring bot)" },
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { status: "LOST", httpCode: res.status, finalUrl: null, isNofollow: false };
    }

    const html = await res.text();
    const targetDomain = new URL(targetUrl).hostname.replace("www.", "");

    // Find all <a> tags that point to target domain
    const linkRegex = /<a\s+[^>]*href=["']([^"']*)[^>]*>/gi;
    let match: RegExpExecArray | null;
    let foundLink = false;
    let isNofollow = false;

    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];
      const fullTag = match[0];
      try {
        const linkUrl = new URL(href, sourceUrl);
        if (linkUrl.hostname.replace("www.", "") === targetDomain) {
          foundLink = true;
          // Check nofollow in rel attribute
          const relMatch = fullTag.match(/rel=["']([^"']*)['"]/i);
          if (relMatch && relMatch[1].toLowerCase().includes("nofollow")) {
            isNofollow = true;
          }
          break;
        }
      } catch { /* skip invalid URLs */ }
    }

    if (!foundLink) {
      return { status: "LOST", httpCode: res.status, finalUrl: null, isNofollow: false };
    }

    return {
      status: isNofollow ? "NOFOLLOW" : targetFinal ? "REDIRECTED" : "LIVE",
      httpCode: targetCode,
      finalUrl: targetFinal,
      isNofollow,
    };
  } catch {
    // Source unreachable — can't confirm link exists
    return { status: "ERROR", httpCode: null, finalUrl: null, isNofollow: false, error: "Source unreachable" };
  }
}

// POST /api/backlinks/check
// Body: { ids?: string[] } — check specific IDs, or all if omitted (max 50)
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = session.user.organizationId;
  const body = await req.json().catch(() => ({}));
  const { ids } = body as { ids?: string[] };

  const where: Record<string, unknown> = { organizationId: orgId };
  if (ids?.length) where.id = { in: ids };

  const entries = await prisma.backlinkEntry.findMany({
    where,
    select: { id: true, sourceUrl: true, targetUrl: true },
    take: 50, // hard cap — large batches should use background worker
    orderBy: { updatedAt: "asc" },
  });

  if (entries.length === 0) {
    return NextResponse.json({ results: [], checked: 0 });
  }

  const results: CheckResult[] = [];

  // Process in batches to avoid hammering external sites
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (entry) => {
        const check = await checkLink(entry.sourceUrl ?? "", entry.targetUrl);
        return {
          id: entry.id,
          sourceUrl: entry.sourceUrl ?? "",
          targetUrl: entry.targetUrl,
          checkedAt: new Date().toISOString(),
          ...check,
        } as CheckResult;
      })
    );
    results.push(...batchResults);
  }

  // Map check statuses back to BacklinkEntry statuses
  const STATUS_MAP: Record<LinkStatus, string> = {
    LIVE:          "PUBLISHED",
    LOST:          "LOST",
    BROKEN_TARGET: "REJECTED",
    REDIRECTED:    "PUBLISHED",
    NOFOLLOW:      "PUBLISHED",
    ERROR:         "REQUESTED",
  };

  // Update DB statuses in bulk
  await Promise.all(
    results.map(r =>
      prisma.backlinkEntry.update({
        where: { id: r.id },
        data: {
          status: STATUS_MAP[r.status],
          notes: [
            r.httpCode ? `HTTP ${r.httpCode}` : null,
            r.isNofollow ? "nofollow" : null,
            r.finalUrl ? `→ ${r.finalUrl.slice(0, 80)}` : null,
            r.error ?? null,
            `Checked ${new Date().toLocaleDateString("th-TH")}`,
          ].filter(Boolean).join(" · "),
        },
      })
    )
  );

  return NextResponse.json({
    results,
    checked: results.length,
    summary: {
      live:         results.filter(r => r.status === "LIVE").length,
      lost:         results.filter(r => r.status === "LOST").length,
      broken:       results.filter(r => r.status === "BROKEN_TARGET").length,
      redirected:   results.filter(r => r.status === "REDIRECTED").length,
      nofollow:     results.filter(r => r.status === "NOFOLLOW").length,
      error:        results.filter(r => r.status === "ERROR").length,
    },
  });
}
