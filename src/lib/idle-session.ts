/**
 * idle logout — ไม่ได้ใช้งานเกิน 12 ชม. ต้อง login ใหม่ (ตรวจใน middleware)
 * cookie เก็บเวลาใช้งานล่าสุด (epoch ms)
 * - ตั้งครั้งแรกที่ /auth/callback ตอน login สำเร็จ (session ที่ไม่มี cookie นี้ = ต้อง login ใหม่)
 * - "ใช้งาน" = เปิดหน้า/เปลี่ยนหน้า หรือยิง API ที่แก้ข้อมูล (GET /api เช่น polling ไม่นับ แค่ตรวจ)
 * - อัปเดตไม่ถี่กว่าทุก 5 นาที กัน Set-Cookie ทุก request
 * ไฟล์นี้ต้องไม่ import อะไรฝั่ง Node — middleware รันบน Edge
 */
import type { NextResponse } from "next/server";

export const IDLE_COOKIE = "mars_last_active";
export const IDLE_LIMIT_MS = 12 * 60 * 60 * 1000;
export const IDLE_TOUCH_MS = 5 * 60 * 1000;

export function setActiveCookie(res: NextResponse, now: number = Date.now()) {
  res.cookies.set(IDLE_COOKIE, String(now), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
}
