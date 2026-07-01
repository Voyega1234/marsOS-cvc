import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { activatePrompt, deactivatePrompt, canActivatePrompts } from "@/services/prompts";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canActivatePrompts(session.user.role)) {
    return NextResponse.json({ error: "Forbidden — Admin only can activate/deactivate prompts" }, { status: 403 });
  }

  const { action } = await req.json().catch(() => ({ action: "activate" }));
  const orgId = session.user.organizationId!;
  const userId = session.user.id;

  try {
    const updated =
      action === "deactivate"
        ? await deactivatePrompt(params.id, orgId, userId)
        : await activatePrompt(params.id, orgId, userId);

    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
