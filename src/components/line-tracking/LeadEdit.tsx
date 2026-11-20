"use client";

import { updateLeadContactAction } from "@/lib/line-tracking/actions";

// Inline editor for sales to fill the customer's real name + phone (LINE never
// provides these) and the sales owner.
export function LeadEdit({
  projectId,
  leadId,
  fullName,
  phone,
  salesOwner,
  value,
  currency,
}: {
  projectId: string;
  leadId: string;
  fullName: string | null;
  phone: string | null;
  salesOwner: string | null;
  value: number;
  currency: string;
}) {
  return (
    <form action={updateLeadContactAction} className="flex flex-col gap-1">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="leadId" value={leadId} />
      <input
        name="fullName"
        defaultValue={fullName ?? ""}
        placeholder="ชื่อจริง"
        className="w-32 rounded border border-slate-300 px-2 py-1 text-xs"
      />
      <input
        name="phone"
        defaultValue={phone ?? ""}
        placeholder="เบอร์โทร"
        className="w-32 rounded border border-slate-300 px-2 py-1 text-xs"
      />
      <label className="flex items-center gap-1 text-[10px] text-slate-400">
        มูลค่า ({currency})
        <input
          name="value"
          type="number"
          min="0"
          step="1"
          defaultValue={value}
          className="w-24 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
        />
      </label>
      <div className="flex items-center gap-1">
        <input
          name="salesOwner"
          defaultValue={salesOwner ?? ""}
          placeholder="เซลส์"
          className="w-20 rounded border border-slate-300 px-2 py-1 text-xs"
        />
        <button type="submit" className="btn-secondary px-2 py-1 text-xs">บันทึก</button>
      </div>
    </form>
  );
}
