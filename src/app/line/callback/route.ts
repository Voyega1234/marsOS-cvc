import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { stringifyJson } from "@/lib/line-tracking/json";
import { getProjectBySlug } from "@/lib/line-tracking/services/projectService";
import { getConnectionConfig } from "@/lib/line-tracking/services/connectionStore";
import {
  decodeLineState,
  exchangeCodeForProfile,
  upsertLineUser,
} from "@/lib/line-tracking/services/lineService";
import { upsertLeadFromClick } from "@/lib/line-tracking/services/leadService";
import { pushLeads } from "@/lib/line-tracking/services/sheetService";
import { processQueue } from "@/lib/line-tracking/services/conversionQueueService";
import { isConnectorReal } from "@/lib/line-tracking/services/connectionStore";
import { getTrackingBaseUrl } from "@/lib/line-tracking/services/trackingService";
import type { LineConfig } from "@/lib/line-tracking/connectors";

/**
 * REAL LINE Login callback. LINE redirects here with ?code=&state=. We decode
 * the state (projectSlug + clickId), exchange the code for the user's profile,
 * create/update the LINE user + Lead, best-effort sync the Sheet, then redirect
 * to the success page. Falls back to an error message if credentials/flow fail.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const state = decodeLineState(searchParams.get("state"));
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${origin}/line/start?error=${encodeURIComponent(error)}`);
  }
  if (!code || !state?.projectSlug) {
    return NextResponse.json({ error: "missing code/state" }, { status: 400 });
  }

  const project = await getProjectBySlug(state.projectSlug);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const config = await getConnectionConfig<LineConfig>(project.id, "LINE");

  try {
    const profile = await exchangeCodeForProfile(config, {
      code,
      redirectUri: `${getTrackingBaseUrl()}/line/callback`,
    });

    const lineUser = await upsertLineUser({
      projectId: project.id,
      lineUserId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl,
      clickId: state.clickId ?? undefined,
    });

    const { lead } = await upsertLeadFromClick({
      projectId: project.id,
      lineUserId: lineUser.id,
      clickId: state.clickId ?? undefined,
      displayName: profile.displayName,
      defaultValue: project.defaultConversionValue,
      currency: project.currency,
    });

    // Send generate_lead (+ enabled platforms) to GA4/ads in real time.
    try {
      await processQueue({ projectId: project.id });
    } catch {
      /* safety-net cron will retry */
    }

    if (await isConnectorReal(project.id, "GOOGLE_SHEET")) {
      try {
        await pushLeads(project.id);
      } catch {
        /* logged inside pushLeads */
      }
    }

    return NextResponse.redirect(`${origin}/line/success?lead_id=${lead.id}`);
  } catch (err) {
    await prisma.webhookLog.create({
      data: {
        projectId: project.id,
        source: "LINE",
        payload: stringifyJson({ code: "***", state }),
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
    return NextResponse.redirect(
      `${origin}/line/start?project=${project.slug}&error=login_failed`
    );
  }
}
