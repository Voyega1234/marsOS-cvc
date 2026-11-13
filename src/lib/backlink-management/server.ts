/** ตัวช่วยฝั่งเซิร์ฟเวอร์ของ Backlink Management */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface StaffCtx {
  orgId: string;
  userId: string;
  role: string;
  userName: string;
}

export async function requireStaff(): Promise<StaffCtx | NextResponse> {
  const session = await getSession();
  const u = session?.user;
  if (!u?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.role === "CLIENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return {
    orgId: u.organizationId,
    userId: u.id,
    role: u.role,
    userName: (u as { name?: string | null }).name || (u as { email?: string | null }).email || "",
  };
}

export function isCtx(x: StaffCtx | NextResponse): x is StaffCtx {
  return !(x instanceof NextResponse);
}

export interface EventInput {
  organizationId: string;
  requestId: string;
  type: "CREATED" | "STATUS" | "PRICE" | "ASSIGN" | "VERIFY" | "ASANA" | "NOTE";
  fromStatus?: string;
  toStatus?: string;
  amount?: number | null;
  note?: string;
  source?: "user" | "asana" | "system";
  actorId?: string | null;
}

export async function addEvent(e: EventInput) {
  return prisma.blmRequestEvent.create({
    data: {
      organizationId: e.organizationId,
      requestId: e.requestId,
      type: e.type,
      fromStatus: e.fromStatus ?? "",
      toStatus: e.toStatus ?? "",
      amount: e.amount ?? null,
      note: (e.note ?? "").slice(0, 1000),
      source: e.source ?? "user",
      actorId: e.actorId ?? null,
    },
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function serverError(e: unknown): NextResponse {
  const msg = e instanceof Error ? e.message : "เกิดข้อผิดพลาด";
  return NextResponse.json({ error: msg }, { status: 500 });
}

/** วันที่ "YYYY-MM-DD" → Date (UTC เที่ยงวัน กันเลื่อนวัน) */
export function parseDateOnly(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function dateOnlyString(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[\/?#]/)[0]
    .replace(/:\d+$/, "");
}
