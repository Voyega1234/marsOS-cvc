"use client";

import { useRef } from "react";
import { changeLeadStatusAction } from "@/lib/line-tracking/actions";
import { LEAD_STATUS, LEAD_STATUS_LABEL, type LeadStatus } from "@/lib/line-tracking/enums";

export function LeadStatusSelect({
  projectId,
  leadId,
  status,
  statuses = LEAD_STATUS,
}: {
  projectId: string;
  leadId: string;
  status: string;
  /** Statuses this project uses (KOWA has no WON). */
  statuses?: readonly LeadStatus[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  // A lead already in a status the project now hides (e.g. a KOWA lead set to WON before
  // WON was removed) must still show it, or the select falls back to the first option.
  const options = statuses.includes(status as LeadStatus) || !(LEAD_STATUS as readonly string[]).includes(status)
    ? statuses
    : [...statuses, status as LeadStatus];

  return (
    <form ref={formRef} action={changeLeadStatusAction}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="leadId" value={leadId} />
      <select
        name="status"
        defaultValue={status}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-blue"
      >
        {options.map((s) => (
          <option key={s} value={s}>
            {LEAD_STATUS_LABEL[s]} ({s})
          </option>
        ))}
      </select>
    </form>
  );
}
