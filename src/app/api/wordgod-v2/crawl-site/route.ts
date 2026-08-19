/**
 * WordGod v2 — /api/wordgod-v2/crawl-site
 * Step 0.1: Crawl a website URL to extract sitemap categories + business context
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { crawlSiteContext, buildSiteContextSummary } from '@/lib/wordgod/services/siteContextService';
import { derivePillarsFromSiteContext } from '@/lib/wordgod/pipeline/siteTaxonomy';

export async function POST(req: NextRequest) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session!.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { url } = await req.json();
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  const ctx = await crawlSiteContext(url);
  const summary = buildSiteContextSummary(ctx);

  // Additive: money-page-aware pillars derived from the sitemap taxonomy. The
  // dashboard uses these to prefill pillars; falls back to a naive mapping when [].
  const derivedPillars = derivePillarsFromSiteContext(ctx);

  return NextResponse.json({ ...ctx, summary, derivedPillars });
}
