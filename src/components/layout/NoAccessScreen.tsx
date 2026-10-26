"use client";

import { createSupabaseBrowser } from "@/lib/supabase/client";

/**
 * login Google ผ่านแล้ว แต่บัญชีนี้ไม่มีสิทธิ์ใน MarsOS (pool ผู้ใช้ร่วมกับ plasai / ถูกปิดสิทธิ์ / ไม่อยู่ในรายชื่อ)
 * แสดงหน้านี้แทนเนื้อหาทั้งหมด — ไม่ render sidebar หรือหน้าใด ๆ ของระบบ
 */
export function NoAccessScreen() {
  async function switchAccount() {
    try { await createSupabaseBrowser().auth.signOut(); } catch { /* env ไม่ครบ (dev) */ }
    window.location.href = "/login";
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-navy px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-7 text-center space-y-4">
        <h1 className="text-xl font-bold text-brand-navy">MarsOS</h1>
        <p className="text-sm text-brand-navy">บัญชีนี้ยังไม่มีสิทธิ์เข้าใช้งาน MarsOS</p>
        <p className="text-[12px] text-gray-500">ติดต่อแอดมินเพื่อขอสิทธิ์ หรือเข้าสู่ระบบด้วยบัญชีอื่น</p>
        <button
          type="button" onClick={switchAccount}
          className="w-full rounded-lg bg-brand-blue hover:opacity-90 text-white text-sm font-semibold py-2.5 transition-opacity"
        >
          ออกจากระบบ / ใช้บัญชีอื่น
        </button>
      </div>
    </div>
  );
}
