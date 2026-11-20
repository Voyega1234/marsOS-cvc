import { NextResponse } from "next/server";
import { authorizeLookerRequest } from "@/lib/line-tracking/lookerAuth";
import {
  LookerRequestError,
  getLookerLeads,
  parseLookerRange,
} from "@/lib/line-tracking/services/lookerService";

export const dynamic = "force-dynamic";

/**
 * GET /api/line-tracking/looker/leads?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Lead-level rows for the Looker Studio connector — the Leads CRM page. Phone and real
 * name are masked unless the project has lookerIncludePii turned on; the field list is
 * the same either way so toggling it never breaks an existing report.
 */
export async function GET(req: Request) {
  const auth = await authorizeLookerRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(req.url);
    const range = parseLookerRange(url.searchParams, auth.project.timezone);
    const rows = await getLookerLeads(auth.project, range);

    return NextResponse.json(
      {
        project: {
          name: auth.project.name,
          currency: auth.project.currency,
          timezone: auth.project.timezone,
          includesPii: auth.project.lookerIncludePii,
        },
        range: { start: range.startDay, end: range.endDay },
        rows,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    if (err instanceof LookerRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[looker/leads] failed", err);
    return NextResponse.json({ error: "Internal error building the leads feed" }, { status: 500 });
  }
}
