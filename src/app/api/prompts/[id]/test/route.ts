import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { canViewPrompts, testPrompt } from "@/services/prompts";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewPrompts(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { variables } = await req.json().catch(() => ({ variables: {} }));

  try {
    const result = await testPrompt(
      params.id,
      session.user.organizationId!,
      session.user.id,
      variables ?? {}
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
