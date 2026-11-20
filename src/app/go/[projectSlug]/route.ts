import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getProjectBySlug } from "@/lib/line-tracking/services/projectService";
import { recordAdClick, extractParams } from "@/lib/line-tracking/services/trackingService";

/**
 * Direct "Add LINE" tracking link — captures the click server-side then
 * redirects straight into the LINE flow (no landing page). Use this as the
 * link in a Facebook post / bio / ad when you want one tap → LINE.
 *
 *   {BASE}/go/{slug}?utm_source=facebook&utm_medium=social&utm_campaign=...
 *
 * Attribution (which click → which LINE user) is preserved because the click_id
 * is carried into /line/start → LINE Login state.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectSlug: string }> }
) {
  const { projectSlug } = await params;
  const project = await getProjectBySlug(projectSlug);
  const { origin, searchParams } = new URL(req.url);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const h = await headers();
  const captured = extractParams(searchParams);
  const click = await recordAdClick(project.id, {
    ...captured,
    landingUrl: `/go/${project.slug}?${searchParams.toString()}`,
    referrer: h.get("referer") ?? undefined,
    userAgent: h.get("user-agent") ?? undefined,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
  });

  // Straight to the LINE start step, carrying the click_id for attribution.
  return NextResponse.redirect(
    `${origin}/line/start?project=${project.slug}&click_id=${click.clickId}`
  );
}
