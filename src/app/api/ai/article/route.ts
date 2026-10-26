import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { legacyWriterGuard } from "@/lib/legacy-writer-server";
import { runArticleWriter, toUserMessage } from "@/services/ai";

export async function POST(req: NextRequest) {
  // เส้นทางเขียนแบบเก่าไม่ใช้ข้อจำกัดของ Content Engine — ปิดถาวร (ตอบ 410 ก่อนทำอะไร)
  const gone = legacyWriterGuard();
  if (gone) return gone;

  const session = await getSession();
  

  if (!session!.user.organizationId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  try {
    const { articleId } = await req.json();
    if (!articleId) return NextResponse.json({ error: "Missing articleId" }, { status: 400 });

    const result = await runArticleWriter({
      organizationId: session!.user.organizationId,
      userId:         session!.user.id,
      userRole:       session!.user.role,
      articleId,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[article-writer]", err);
    return NextResponse.json({ error: toUserMessage(err) }, { status: 500 });
  }
}
