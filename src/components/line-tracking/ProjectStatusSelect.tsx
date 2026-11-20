"use client";

import { useRef, useTransition } from "react";
import { PROJECT_STATUS, PROJECT_STATUS_LABEL } from "@/lib/line-tracking/enums";
import type { ProjectStatus } from "@/lib/line-tracking/enums";

const TONES: Record<ProjectStatus, string> = {
  DRAFT: "border-slate-200 bg-slate-100 text-slate-600",
  SETUP: "border-amber-200 bg-amber-50 text-amber-700",
  LIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  PAUSED: "border-rose-200 bg-rose-50 text-rose-700",
};

// Filled pastel variant used by the restyled projects table.
const SOLID_TONES: Record<ProjectStatus, string> = {
  DRAFT: "border-transparent bg-gray-100 text-gray-600",
  SETUP: "border-transparent bg-amber-100 text-amber-700",
  LIVE: "border-transparent bg-green-100 text-green-700",
  PAUSED: "border-transparent bg-red-100 text-red-700",
};

/**
 * Inline status picker for the projects list. Submits on change so it behaves like a
 * badge you can click, not a form you have to fill in. Setting PAUSED stops Looker Studio
 * from reading the project (see lookerAuth.ts); the action behind this is staff-only.
 */
export function ProjectStatusSelect({
  projectId,
  status,
  action,
  solid = false,
}: {
  projectId: string;
  status: ProjectStatus;
  action: (formData: FormData) => Promise<void>;
  solid?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      action={(fd) => startTransition(() => action(fd))}
      className="inline-block"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <select
        name="status"
        defaultValue={status}
        disabled={pending}
        onChange={() => formRef.current?.requestSubmit()}
        title="เปลี่ยนสถานะโปรเจกต์"
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium cursor-pointer appearance-none border pr-5 ${(solid ? SOLID_TONES : TONES)[status]} ${
          pending ? "opacity-50" : ""
        }`}
      >
        {PROJECT_STATUS.map((s) => (
          <option key={s} value={s}>
            {PROJECT_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
    </form>
  );
}
