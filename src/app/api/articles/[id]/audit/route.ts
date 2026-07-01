import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { runArticleAudit } from "@/services/ai/services/ArticleAuditService";
import { AINoDataError, AIPreConditionError, AIPermissionError, AINoPromptError } from "@/services/ai/errors";
import type { Role } from "@/types";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  

  try {
    const result = await runArticleAudit({
      organizationId: session!.user.organizationId ?? "",
      articleId:      params.id,
      userId:         session!.user.id,
      userRole:       session!.user.role as Role,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AIPermissionError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof AINoDataError)     return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof AIPreConditionError) return NextResponse.json({ error: err.message }, { status: 422 });
    if (err instanceof AINoPromptError)   return NextResponse.json({ error: err.message, code: "NO_PROMPT" }, { status: 422 });
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
