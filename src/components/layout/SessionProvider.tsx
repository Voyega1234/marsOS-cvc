"use client";

import { createContext, useContext } from "react";
import type { AppSession } from "@/lib/session-types";

/**
 * แทนที่ SessionProvider ของ next-auth หลังถอดระบบล็อกอินออก
 *
 * session ถูก resolve ที่ root layout ฝั่ง server แล้วส่งลงมาเป็น prop
 * ตัว provider นี้จึงเป็นแค่ context เปล่า ๆ ไม่มีการยิง /api/auth/session
 */
const SessionContext = createContext<AppSession | null>(null);

export function SessionProvider({
  children,
  session,
}: {
  children: React.ReactNode;
  session: AppSession | null;
}) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/**
 * คงหน้าตา return เดิมของ next-auth ({ data, status }) ไว้
 * ผู้เรียกทั้ง 5 จุดจึงไม่ต้องแก้ตรรกะ เปลี่ยนแค่บรรทัด import
 */
export function useSession(): {
  data: AppSession | null;
  status: "authenticated" | "unauthenticated";
} {
  const session = useContext(SessionContext);
  return { data: session, status: session ? "authenticated" : "unauthenticated" };
}
