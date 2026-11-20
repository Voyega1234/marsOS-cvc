import { NextRequest, NextResponse } from "next/server";
import { leadsExportResponse } from "@/lib/line-tracking/leadExport";
import { projectRouteAccess } from "@/lib/line-tracking/pageGuard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Leads CRM export (CSV) for the Export button on the Leads page.
 *
 * Staff only. The middleware requires a MarsOS login; this route then checks the module
 * role itself (projectRouteAccess), because a route handler does not run the layouts.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const access = await projectRouteAccess(projectId, { clientAllowed: true });
  if (!access.ok) return NextResponse.json({ error: "ไม่มีสิทธิ์ export ข้อมูลโปรเจกต์นี้" }, { status: access.status });
  return leadsExportResponse(projectId, req.nextUrl.searchParams);
}
