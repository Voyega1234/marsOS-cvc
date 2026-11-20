import { NextRequest, NextResponse } from "next/server";
import { processQueue } from "@/lib/line-tracking/services/conversionQueueService";
import { checkCronAuth } from "@/lib/line-tracking/cron";

// One run sends every queued conversion to the ad platforms, so it needs more than the default time.
export const maxDuration = 300;

/**
 * Process the conversion queue. Optional ?projectId=... to scope to one project.
 * Intended to be triggered by a cron/scheduler; protect with CRON_SECRET in prod.
 * Retries failed events up to MAX_RETRY (handled inside processQueue).
 */
export async function POST(req: NextRequest) {
  const auth = checkCronAuth(req);
  if (!auth.ok) {
    // 503, not 401, when the secret was never configured: that is a broken
    // deploy (the cron cannot run either), and it needs to look different from
    // a rejected caller so the smoke test can tell them apart.
    return auth.reason === "unconfigured"
      ? NextResponse.json(
          { error: "CRON_SECRET is not configured on this deployment" },
          { status: 503 }
        )
      : NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const projectId = new URL(req.url).searchParams.get("projectId") ?? undefined;
  try {
    const summary = await processQueue({ projectId });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
