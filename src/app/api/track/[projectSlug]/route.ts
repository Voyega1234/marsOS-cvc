import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getProjectBySlug } from "@/lib/line-tracking/services/projectService";
import { markLineClicked, recordAdClick } from "@/lib/line-tracking/services/trackingService";
import { saveBrowserIds } from "@/lib/line-tracking/services/clickSignalService";
import { asBodyObject, cleanGaClientId, coerceTrackBody, hasBrowserIds, readBrowserIds } from "@/lib/line-tracking/browserIds";

// This endpoint is called from the project's tracked website by the
// embed snippet, so it must allow cross-origin requests.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * Ingest an ad click from an external site. Body (JSON) carries UTM + click IDs
 * + ga_client_id captured by embed.js. Returns { clickId } which the snippet
 * then attaches to the "Add LINE" link.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectSlug: string }> }
) {
  const { projectSlug } = await params;
  const project = await getProjectBySlug(projectSlug);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404, headers: CORS });
  }

  // "lineclick" can arrive via query params (sendBeacon, CORS-safe) — check first.
  const qs = new URL(req.url).searchParams;
  if (qs.get("event") === "lineclick" && qs.get("click_id")) {
    // Sent by sendBeacon: the browser does not wait for, or read, the answer. Answer now
    // and let the stamp finish after the response (waitUntil keeps the function alive).
    // The beacon also carries the browser ids as they are at this moment (GA session,
    // _fbp, _ttp): the page-load read usually comes before the tags have set them.
    const clickId = qs.get("click_id");
    waitUntil(
      Promise.all([
        markLineClicked(project.id, clickId),
        saveBrowserIds(project.id, clickId, readBrowserIds((name) => qs.get(name))),
      ])
    );
    return NextResponse.json({ ok: true }, { headers: CORS });
  }

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  // Text fields are length-capped and type-checked; the browser ids are shape-checked one by one.
  const rawBody = asBodyObject(raw);
  const body = coerceTrackBody(rawBody);

  // …or via JSON body.
  if (body.event === "lineclick" && body.click_id) {
    const clickId = body.click_id;
    waitUntil(
      Promise.all([
        markLineClicked(project.id, clickId),
        saveBrowserIds(project.id, clickId, readBrowserIds((name) => rawBody[name])),
      ])
    );
    return NextResponse.json({ ok: true }, { headers: CORS });
  }

  const browserIds = readBrowserIds((name) => rawBody[name]);

  const click = await recordAdClick(project.id, {
    source: body.utm_source,
    medium: body.utm_medium,
    campaign: body.utm_campaign,
    adset: body.utm_adset,
    content: body.utm_content,
    keyword: body.utm_term || body.keyword,
    gclid: body.gclid,
    fbclid: body.fbclid,
    ttclid: body.ttclid,
    msclkid: body.msclkid,
    twclid: body.twclid,
    scclid: body.scclid,
    gaClientId: cleanGaClientId(body.ga_client_id),
    landingUrl: body.landing_url,
    referrer: body.referrer,
    userAgent: req.headers.get("user-agent") ?? undefined,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
  });
  // After the answer: the visitor's page is waiting for the click id, not for this.
  if (hasBrowserIds(browserIds)) {
    waitUntil(saveBrowserIds(project.id, click.clickId, browserIds, { trusted: true }));
  }

  return NextResponse.json(
    { ok: true, clickId: click.clickId, project: project.slug },
    { headers: CORS }
  );
}
