import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { runContentMap, toUserMessage } from "@/services/ai";

export async function POST(req: NextRequest) {
  const session = await getSession();
  

  if (!session!.user.organizationId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  try {
    const { projectId, keywords } = await req.json();
    if (!projectId || !Array.isArray(keywords)) {
      return NextResponse.json({ error: "Missing projectId or keywords array" }, { status: 400 });
    }

    const result = await runContentMap({
      organizationId: session!.user.organizationId,
      userId:         session!.user.id,
      userRole:       session!.user.role,
      projectId,
      keywords,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[content-map]", err);
    return NextResponse.json({ error: toUserMessage(err) }, { status: 500 });
  }
}
