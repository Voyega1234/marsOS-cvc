"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteProjectAction } from "@/lib/line-tracking/actions";

function SubmitButton({ armed }: { armed: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={!armed || pending}
      className="btn-primary bg-rose-600 hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? "กำลังลบ…" : "ลบโปรเจกต์นี้ถาวร"}
    </button>
  );
}

/**
 * Admin-only danger zone. Rendered only for LT admins, but the real enforcement
 * lives in deleteProjectAction — this component just makes the consequences hard
 * to miss and the action hard to trigger by accident.
 */
export function DeleteProjectCard({
  projectId,
  slug,
  projectName,
  leadCount,
}: {
  projectId: string;
  slug: string;
  projectName: string;
  leadCount: number;
}) {
  const [typed, setTyped] = useState("");
  const armed = typed.trim() === slug;

  return (
    <div className="card mt-6 border-2 border-rose-200 bg-rose-50/50 p-5">
      <h3 className="text-sm font-bold text-rose-700">⚠️ Danger zone — ลบโปรเจกต์</h3>
      <p className="mt-1 text-xs text-rose-700/80">
        ลบ <b>{projectName}</b> ออกถาวร <b>กู้คืนไม่ได้</b> — และจะลบข้อมูลที่ผูกกับโปรเจกต์นี้ตามไปด้วยทั้งหมด:
      </p>
      <ul className="mt-2 list-inside list-disc text-xs text-rose-700/80">
        <li>
          <b>Leads {leadCount.toLocaleString()} รายการ</b> (ชื่อ / เบอร์โทร / ยอดเงินของลูกค้าจริง)
        </li>
        <li>คลิกโฆษณา, ผู้ใช้ LINE, conversion event ที่ส่งไปแล้ว</li>
        <li>Tracking link, short link และการตั้งค่า connector</li>
      </ul>

      <form action={deleteProjectAction} className="mt-3 space-y-2">
        <input type="hidden" name="projectId" value={projectId} />
        <label className="mb-1 block text-sm font-medium text-rose-700">
          พิมพ์ <code className="rounded bg-rose-100 px-1 font-bold">{slug}</code> เพื่อยืนยัน
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            name="confirmSlug"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            placeholder={slug}
            className="field-input max-w-xs"
          />
          <SubmitButton armed={armed} />
        </div>
        {!armed && typed.length > 0 && (
          <p className="text-xs text-rose-600">ข้อความยังไม่ตรงกับ slug</p>
        )}
      </form>
    </div>
  );
}
