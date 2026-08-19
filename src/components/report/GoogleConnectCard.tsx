"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Link2, Unlink } from "lucide-react";

// การ์ดเชื่อม Gmail (เมล์กลาง apps@convertcake.com) สำหรับดึงข้อมูล GSC/GA4
// ของหน้า Report/Performance เท่านั้น — ไม่ใช่ login ระบบ
export function GoogleConnectCard({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<{ connected: boolean; email: string | null; configured: boolean } | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/google-connect");
      if (r.ok) setStatus(await r.json());
    } catch { /* ignore */ }
  }

  useEffect(() => {
    load();
    const p = new URLSearchParams(window.location.search);
    if (p.get("gconn") === "ok") toast.success(`เชื่อมต่อ Google สำเร็จ: ${p.get("email") ?? ""}`);
    if (p.get("gconn") === "error") toast.error("เชื่อมต่อ Google ไม่สำเร็จ ลองใหม่อีกครั้ง");
  }, []);

  async function disconnect() {
    if (!confirm("ตัดการเชื่อมต่อ Google? หน้า Report จะดึงข้อมูลไม่ได้จนกว่าจะเชื่อมใหม่")) return;
    const r = await fetch("/api/google-connect", { method: "DELETE" });
    if (r.ok) { toast.success("ตัดการเชื่อมต่อแล้ว"); load(); }
  }

  if (!status) return null;

  if (status.connected) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
        <CheckCircle2 className="size-3.5 shrink-0" />
        <span>ข้อมูล GSC/GA4 เชื่อมผ่าน Google: <b>{status.email}</b></span>
        {isAdmin && (
          <button onClick={disconnect} className="ml-auto flex items-center gap-1 text-emerald-600 hover:text-red-600 transition-colors">
            <Unlink className="size-3" /> ตัดการเชื่อมต่อ
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
      <span>
        ยังไม่ได้เชื่อม Google สำหรับข้อมูล Report —
        {status.configured
          ? " เชื่อมด้วยเมล์ที่มี access GSC/GA4 (แนะนำ apps@convertcake.com)"
          : " ต้องตั้งค่า GOOGLE_OAUTH_CLIENT_ID/SECRET ใน env ก่อน"}
      </span>
      {isAdmin && status.configured && (
        <a href="/api/google-connect/start"
          className="ml-auto flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-700 hover:bg-amber-100 transition-colors">
          <Link2 className="size-3" /> เชื่อมต่อ Google
        </a>
      )}
    </div>
  );
}
