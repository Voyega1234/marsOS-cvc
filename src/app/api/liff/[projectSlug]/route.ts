import { NextRequest, NextResponse } from "next/server";
import { getProjectBySlug } from "@/lib/line-tracking/services/projectService";
import { getConnectionConfig } from "@/lib/line-tracking/services/connectionStore";
import { recordAdClick } from "@/lib/line-tracking/services/trackingService";
import { upsertLineUser } from "@/lib/line-tracking/services/lineService";
import type { LineConfig } from "@/lib/line-tracking/connectors";

/**
 * LIFF tracking endpoint — supports "LINE-domain-only" links:
 *   https://liff.line.me/{liffId}?src=fb-post&utm_campaign=...
 * The LIFF page (src/app/liff/[projectSlug]) opens inside LINE, calls here with
 * the user's LIFF access token, then forwards the user to the OA add-friend URL.
 *
 * We verify the token WITH LINE (never trust a client-supplied userId), record
 * the click, and stamp it on the LineUser row. NO Lead is created here — the
 * Lead appears when the real follow event hits the webhook, where leadService
 * now prefers the user's remembered click (exact 1:1, no phantom leads and no
 * premature conversion events for people who bounce before adding).
 *
 * Purely additive: website embed, /go, /t and webhook flows are untouched.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectSlug: string }> }
) {
  const { projectSlug } = await params;
  const project = await getProjectBySlug(projectSlug);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  const config = await getConnectionConfig<LineConfig>(project.id, "LINE");
  // Public info only: liffId is in the link itself, addFriendUrl is a public lin.ee.
  return NextResponse.json({
    liffId: config.liffId ?? null,
    addFriendUrl: config.addFriendUrl ?? null,
  });
}

interface LiffTrackBody {
  accessToken?: string;
  query?: Record<string, string>;
  landingUrl?: string;
  referrer?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectSlug: string }> }
) {
  const { projectSlug } = await params;
  const project = await getProjectBySlug(projectSlug);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  let body: LiffTrackBody = {};
  try {
    body = (await req.json()) as LiffTrackBody;
  } catch {
    /* keep empty body */
  }
  if (!body.accessToken) {
    return NextResponse.json({ error: "accessToken required" }, { status: 400 });
  }

  const config = await getConnectionConfig<LineConfig>(project.id, "LINE");

  // 1) Verify the LIFF access token with LINE — the ONLY trustworthy source of
  //    the userId. Also pin the token to this project's Login channel when set
  //    (a valid token from someone else's LIFF app must not count here).
  //    The profile call does not depend on the verify answer, so it starts at the same time
  //    (one LINE round trip of waiting instead of two). Its result is only looked at after
  //    the verify checks pass; a failure is held back until then, so every answer below is
  //    the same as when the two calls ran one after the other.
  const profilePending = fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${body.accessToken}` },
    signal: AbortSignal.timeout(10_000),
  }).then(
    (res) => ({ res, error: null as unknown }),
    (error: unknown) => ({ res: null, error })
  );
  const verifyRes = await fetch(
    `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(body.accessToken)}`,
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!verifyRes.ok) {
    return NextResponse.json({ error: "invalid access token" }, { status: 401 });
  }
  const verify = (await verifyRes.json()) as { client_id?: string };
  if (config.loginChannelId && verify.client_id !== config.loginChannelId) {
    return NextResponse.json({ error: "token belongs to another channel" }, { status: 401 });
  }

  const profileOutcome = await profilePending;
  if (!profileOutcome.res) throw profileOutcome.error;
  const profileRes = profileOutcome.res;
  if (!profileRes.ok) {
    return NextResponse.json({ error: "profile fetch failed" }, { status: 401 });
  }
  const profile = (await profileRes.json()) as {
    userId?: string;
    displayName?: string;
    pictureUrl?: string;
  };
  if (!profile.userId) {
    return NextResponse.json({ error: "no userId in profile" }, { status: 401 });
  }

  // 2) Record the click (source defaults keep LIFF traffic identifiable).
  const q = body.query ?? {};
  const click = await recordAdClick(project.id, {
    source: q.utm_source || q.src || "line-liff",
    medium: q.utm_medium || "liff",
    campaign: q.utm_campaign,
    adset: q.utm_adset,
    content: q.utm_content,
    keyword: q.utm_term,
    gclid: q.gclid,
    fbclid: q.fbclid,
    ttclid: q.ttclid,
    msclkid: q.msclkid,
    twclid: q.twclid,
    scclid: q.scclid,
    landingUrl: body.landingUrl,
    referrer: body.referrer,
    userAgent: req.headers.get("user-agent") ?? undefined,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
    // Opening the LIFF link IS an add-LINE intent — mark it so the 3h-window
    // fallback also sees it if per-user matching ever misses. Written in the same
    // insert as the click (was a second update).
    lineClickedAt: new Date(),
  });

  // 3) Stamp the click on the LineUser (creates the row if first contact).
  //    The Lead itself is created by the follow-event webhook, which now picks
  //    this exact click up from the LineUser row.
  await upsertLineUser({
    projectId: project.id,
    lineUserId: profile.userId,
    displayName: profile.displayName,
    pictureUrl: profile.pictureUrl,
    clickId: click.clickId,
  });

  return NextResponse.json({
    ok: true,
    clickId: click.clickId,
    addFriendUrl: config.addFriendUrl ?? null,
  });
}
