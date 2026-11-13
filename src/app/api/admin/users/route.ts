import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isClientLoginEmail, syncClientLoginAccount } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // organization มาจาก session ของแอดมินเท่านั้น — ไม่รับ orgId จาก body
  // (หน้า Users ส่งค่าเดียวกับ session อยู่แล้ว ผลลัพธ์จึงเท่าเดิม)
  const organizationId = session.user.organizationId;
  const { name, email: rawEmail, password, role, projectIds } = await req.json();
  // อีเมลเก็บเป็นตัวพิมพ์เล็กเสมอ — ตอน login เทียบแบบไม่สนตัวพิมพ์ ถ้าปล่อยให้ซ้ำต่างตัวพิมพ์
  // จะมี 2 แถวที่ชี้คนเดียวกัน (สิทธิ์ไม่แน่นอนว่าได้แถวไหน)
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";

  if (!email || !password || !role) {
    return NextResponse.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 });
  }

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  if (existing) {
    return NextResponse.json({ error: "อีเมลนี้ถูกใช้แล้ว" }, { status: 400 });
  }

  // โปรเจกต์ที่ผูกให้ CLIENT ต้องเป็นของ organization เดียวกับแอดมิน และไม่ซ้ำกัน
  // ตรวจก่อนสร้าง user — ถ้ามี id ที่ไม่รู้จัก ปฏิเสธทั้งคำขอ ไม่สร้างบัญชีค้างไว้ครึ่งทาง
  let clientProjectIds: string[] = [];
  if (role === "CLIENT" && Array.isArray(projectIds) && projectIds.length > 0) {
    const wanted = Array.from(new Set(projectIds.filter((id): id is string => typeof id === "string" && id.length > 0)));
    const owned = organizationId
      ? await prisma.project.findMany({
          where: { id: { in: wanted }, organizationId },
          select: { id: true },
        })
      : [];
    if (wanted.length === 0 || owned.length !== wanted.length) {
      return NextResponse.json({ error: "โปรเจกต์ที่เลือกไม่ถูกต้อง" }, { status: 400 });
    }
    clientProjectIds = wanted;
  }

  const hashed = await bcrypt.hash(password, 10);

  // สร้าง user กับสิทธิ์โปรเจกต์ใน transaction เดียว — ไม่มีทางได้ CLIENT ที่ไม่มีโปรเจกต์เพราะขั้นที่สองล้ม
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: name || null,
        email,
        password: hashed,
        passwordPlain: password,
        role,
        status: "ACTIVE",
        organizationId,
      },
    });
    if (clientProjectIds.length > 0) {
      await tx.clientProjectAccess.createMany({
        data: clientProjectIds.map((projectId) => ({ userId: created.id, projectId })),
      });
    }
    return created;
  });

  // ลูกค้า login ด้วยชื่อผู้ใช้ + รหัสผ่าน — ต้องมีบัญชีคู่กันใน Supabase Auth
  // ล้มเหลวไม่ยกเลิกการสร้าง: คืน loginReady = false ให้หน้า Users เตือน แล้วกดรีเซ็ตรหัสผ่านเพื่อลองใหม่ได้
  // เฉพาะอีเมล @mars.local (ที่หน้า Users สร้าง) — ลูกค้าที่ใช้อีเมลจริงเข้าด้วย Google ตามเดิม ไม่แตะบัญชี Supabase ของเขา
  let login: { loginReady?: boolean; loginError?: string } = {};
  if (role === "CLIENT" && isClientLoginEmail(email)) {
    const result = await syncClientLoginAccount({ userId: user.id, email, password });
    login = result.ok ? { loginReady: true } : { loginReady: false, loginError: result.error };
    if (!result.ok) console.warn(`[auth] client login account not ready: ${result.error} — ${email}`);
  }

  // Fetch with clientAccess for UI update
  const userWithAccess = await prisma.user.findUnique({
    where: { id: user.id },
    include: {
      clientAccess: { include: { project: { select: { id: true, name: true } } } },
    },
  });

  return NextResponse.json({
    user: {
      id: userWithAccess!.id,
      name: userWithAccess!.name ?? "",
      email: userWithAccess!.email,
      role: userWithAccess!.role,
      status: userWithAccess!.status,
      createdAt: userWithAccess!.createdAt.toISOString(),
      passwordPlain: userWithAccess!.passwordPlain ?? null,
      clientProjects: userWithAccess!.clientAccess.map((a) => ({
        projectId: a.projectId,
        projectName: a.project.name,
      })),
    },
    ...login,
  });
}
