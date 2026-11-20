import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkCronAuth } from "@/lib/line-tracking/cron";
import {
  isConvertCakeProject, recordCcSyncError, runCcSheetSync,
} from "@/lib/line-tracking/services/convertCakeSheetSync";

// Sheet read + up to 300 status changes.
export const maxDuration = 60;

/**
 * Convert Cake only: pull lead statuses from Convert Cake's Google Sheet (every 10 min
 * via Vercel Cron). Projects without an enabled sheet config, and any project that is not
 * Convert Cake, are skipped. Conversions queued here go out with /api/conversions/process.
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req);
  if (!auth.ok) {
    return auth.reason === "unconfigured"
      ? NextResponse.json({ error: "CRON_SECRET is not configured on this deployment" }, { status: 503 })
      : NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const configs = await prisma.ccSheetSync.findMany({ where: { enabled: true }, select: { projectId: true } });
  const projects = await prisma.ltProject.findMany({
    where: { id: { in: configs.map((c) => c.projectId) } },
    select: { id: true, name: true },
  });
  const results: { projectId: string; ok: boolean; counts?: unknown; error?: string }[] = [];
  for (const p of projects.filter(isConvertCakeProject)) {
    try {
      const r = await runCcSheetSync(p.id, { apply: true });
      results.push({ projectId: p.id, ok: true, counts: r.counts });
    } catch (err) {
      await recordCcSyncError(p.id, err);
      results.push({ projectId: p.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({ ok: results.every((r) => r.ok), results });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
