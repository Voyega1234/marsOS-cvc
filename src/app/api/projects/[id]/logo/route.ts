import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user || session.user.role === "CLIENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("logo") as File | null;
  if (!file) return NextResponse.json({ error: "ไม่พบไฟล์" }, { status: 400 });

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
  if (!["jpg", "jpeg", "png", "webp", "gif", "svg"].includes(ext)) {
    return NextResponse.json({ error: "ไฟล์ไม่รองรับ" }, { status: 400 });
  }

  const filename = `${params.id}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const dest = path.join(process.cwd(), "public", "logos", filename);
  await writeFile(dest, buf);

  const logoUrl = `/logos/${filename}`;
  await prisma.project.update({ where: { id: params.id }, data: { logoUrl } });
  return NextResponse.json({ logoUrl });
}
