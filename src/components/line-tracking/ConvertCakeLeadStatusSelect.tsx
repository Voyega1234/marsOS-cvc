"use client";

import { useRef } from "react";
import { setCcLeadStatusAction } from "@/lib/line-tracking/convertCakeLeadStatusAction";
import { ccStatusName } from "@/lib/line-tracking/services/convertCakeSheetPlan";

/** Convert Cake only: status select that lists the sheet's status names. */
export function ConvertCakeLeadStatusSelect({
  projectId,
  leadId,
  current,
  options,
  statusLabel,
}: {
  projectId: string;
  leadId: string;
  /** Current sheet status label ("" when the lead has none yet). */
  current: string;
  /** Sheet status labels that map to a MarsOS status, in sheet order. */
  options: string[];
  /** MarsOS status label, shown while the lead has no sheet status yet. */
  statusLabel: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const list = current && !options.includes(current) ? [...options, current] : options;

  return (
    <form ref={formRef} action={setCcLeadStatusAction}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="leadId" value={leadId} />
      <select
        name="label"
        defaultValue={current}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-blue"
      >
        {!current && <option value="" disabled>{statusLabel} — เลือกสถานะ</option>}
        {list.map((s) => (
          <option key={s} value={s}>
            {ccStatusName(s)}
          </option>
        ))}
      </select>
    </form>
  );
}
