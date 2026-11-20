"use client";

import { useState } from "react";

export function PayloadViewer({
  request,
  response,
}: {
  request?: string | null;
  response?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const pretty = (raw?: string | null) => {
    if (!raw) return "(empty)";
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  };

  return (
    <>
      <button type="button" className="btn-secondary text-xs" onClick={() => setOpen((v) => !v)}>
        {open ? "ซ่อน payload" : "View payload"}
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-500">Request</div>
            <pre className="max-h-56 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100 dark:text-slate-800">
              {pretty(request)}
            </pre>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-500">Response</div>
            <pre className="max-h-56 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100 dark:text-slate-800">
              {pretty(response)}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}
