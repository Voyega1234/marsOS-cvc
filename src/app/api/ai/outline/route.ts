import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { runOutline, toUserMessage } from "@/services/ai";

export async function POST(req: NextRequest) {
  const session = await getSession();
  

  if (!session!.user.organizationId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  try {
    const { articleId } = await req.json();
    if (!articleId) return NextResponse.json({ error: "Missing articleId" }, { status: 400 });

    const result = await runOutline({
      organizationId: session!.user.organizationId,
      userId:         session!.user.id,
      userRole:       session!.user.role,
      articleId,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[outline]", err);
    return NextResponse.json({ error: toUserMessage(err) }, { status: 500 });
  }
}
