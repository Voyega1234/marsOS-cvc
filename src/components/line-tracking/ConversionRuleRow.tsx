import { updateConversionRuleAction } from "@/lib/line-tracking/actions";
import { LEAD_STATUS_LABEL } from "@/lib/line-tracking/enums";
import type { LeadStatus } from "@/lib/line-tracking/enums";
import { PLATFORMS, PLATFORM_STANDARD_EVENTS } from "@/lib/line-tracking/platforms";
import type { PlatformsConfig } from "@/lib/line-tracking/platforms";
import { parseJson } from "@/lib/line-tracking/json";
import type { ConversionRule } from "@prisma/client";

/**
 * Per-status rule editor. Event names are editable two ways (no client JS —
 * this stays a server-component form):
 *  - pick a Standard event of that platform from the dropdown, or
 *  - type a Custom name in the free-text box, which OVERRIDES the dropdown
 *    when non-empty (see updateConversionRuleAction).
 * The current/default name is pre-selected, so nothing changes until you do.
 */
export function ConversionRuleRow({
  projectId,
  rule,
}: {
  projectId: string;
  rule: ConversionRule;
}) {
  const platforms = parseJson<PlatformsConfig>(rule.platformsJson, {});

  return (
    <form
      action={updateConversionRuleAction}
      className="grid grid-cols-1 items-start gap-3 rounded-lg border border-slate-100 p-3 md:grid-cols-[130px_1fr_auto]"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="ruleId" value={rule.id} />

      <div>
        <div className="font-semibold text-slate-800">{rule.leadStatus}</div>
        <div className="text-xs text-slate-400">{LEAD_STATUS_LABEL[rule.leadStatus as LeadStatus]}</div>
        <label className="mt-2 flex items-center gap-1 text-xs font-medium text-slate-600">
          <input type="checkbox" name="enabled" defaultChecked={rule.enabled} className="h-4 w-4 rounded" />
          เปิดกฎนี้
        </label>
        <label className="mt-2 flex items-center gap-1 text-xs text-slate-600">
          Value
          <input
            name="defaultValue"
            type="number"
            defaultValue={rule.defaultValue}
            className="w-20 rounded border border-slate-300 px-2 py-1 text-xs"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {PLATFORMS.map((p) => {
          const cfg = platforms[p.id];
          const currentEvent = cfg?.eventName ?? p.events[rule.leadStatus as LeadStatus];
          if (!currentEvent) return null; // no event for this status (e.g. LOST)
          const standards = PLATFORM_STANDARD_EVENTS[p.id] ?? [];
          // Keep the saved/default name selectable even if it's not a standard one.
          const options = standards.includes(currentEvent) ? standards : [currentEvent, ...standards];
          return (
            <div key={p.id} className="rounded-lg border border-slate-100 p-2">
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <input type="checkbox" name={`p_${p.id}`} defaultChecked={!!cfg?.enabled} className="h-4 w-4 rounded" />
                {p.label}
              </label>
              <select
                name={`evt_${p.id}`}
                defaultValue={currentEvent}
                className="mt-1.5 w-full rounded border border-slate-200 px-1.5 py-1 text-xs text-slate-600"
              >
                {options.map((ev) => (
                  <option key={ev} value={ev}>{ev}{ev === currentEvent ? " (ปัจจุบัน)" : ""}</option>
                ))}
              </select>
              <input
                name={`evtcustom_${p.id}`}
                placeholder="หรือพิมพ์ Custom event เอง…"
                autoComplete="off"
                className="mt-1 w-full rounded border border-dashed border-slate-200 px-1.5 py-1 text-xs text-slate-600 placeholder:text-slate-300"
              />
            </div>
          );
        })}
      </div>

      <button type="submit" className="btn-secondary text-xs">Save</button>
    </form>
  );
}
