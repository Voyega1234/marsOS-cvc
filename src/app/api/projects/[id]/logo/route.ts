import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { validateClientLogoInput } from "@/lib/upload-article/client-logo";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user || session.user.role === "CLIENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { id: true, organizationId: true },
  });
  if (!project || project.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "ไม่พบโปรเจกต์" }, { status: 404 });
  }

  let body: { logo?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !("logo" in body)) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const v = validateClientLogoInput(body.logo);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  await prisma.project.update({ where: { id: project.id }, data: { logoUrl: v.value } });
  return NextResponse.json({ logoUrl: v.value });
}
