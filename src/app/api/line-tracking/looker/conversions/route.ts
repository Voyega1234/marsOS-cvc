import { NextResponse } from "next/server";
import { authorizeLookerRequest } from "@/lib/line-tracking/lookerAuth";
import {
  LookerRequestError,
  getLookerConversions,
  parseLookerRange,
} from "@/lib/line-tracking/services/lookerService";

export const dynamic = "force-dynamic";

/**
 * GET /api/line-tracking/looker/conversions?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * One row per conversion event sent to an ad platform — the "Conversion ล่าสุด" card
 * and the conversion queue. Auth is the bearer token alone; the project is derived from
 * it, which is why this route takes no projectId parameter of any kind.
 */
export async function GET(req: Request) {
  const auth = await authorizeLookerRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(req.url);
    const range = parseLookerRange(url.searchParams, auth.project.timezone);
    const rows = await getLookerConversions(auth.project, range);

    return NextResponse.json(
      {
        project: {
          name: auth.project.name,
          currency: auth.project.currency,
          timezone: auth.project.timezone,
        },
        range: { start: range.startDay, end: range.endDay },
        rows,
      },
      // Looker caches on its own side; anything cached here would serve one project's
      // response to another, since the token lives in a header.
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    if (err instanceof LookerRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[looker/conversions] failed", err);
    return NextResponse.json(
      { error: "Internal error building the conversions feed" },
      { status: 500 }
    );
  }
}
