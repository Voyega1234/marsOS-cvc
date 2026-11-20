import { CATEGORICAL, OTHER_COLOR, TargetBar } from "@/components/ui/Widgets";
import { LEAD_STATUS_LABEL } from "@/lib/line-tracking/enums";

// Pipeline order of the lead statuses, by their display label. The colour slot of a status is its
// place here, so a status keeps its colour when another one has no leads and drops out of the data.
const STATUS_SLOTS = Object.values(LEAD_STATUS_LABEL) as string[];

/** Colour of a lead status, by its display label. Statuses past the palette share the "other" colour. */
export function statusColor(label: string): string {
  const k = STATUS_SLOTS.indexOf(label);
  return (k >= 0 ? CATEGORICAL[k] : undefined) ?? OTHER_COLOR;
}

/** Ranked list: project name, bar relative to the largest project, then leads and closed sales. */
export function LeadsByProjectList({ data }: { data: { name: string; leads: number; purchases: number }[] }) {
  const rows = [...data].sort((a, b) => b.leads - a.leads);
  const max = Math.max(1, ...rows.map((r) => r.leads));
  return (
    <ul className="divide-y divide-gray-100">
      {rows.map((r, i) => (
        <li key={r.name} className="grid grid-cols-[1.5rem_minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 py-2 sm:grid-cols-[1.5rem_minmax(0,15rem)_minmax(0,1fr)_auto]">
          <span className="text-xs tabular-nums text-gray-500">{i + 1}</span>
          <span className="truncate text-sm font-medium text-gray-900" title={r.name}>{r.name}</span>
          <TargetBar value={r.leads} max={max} size="sm" title={`${r.name}: ${r.leads.toLocaleString()} leads`} />
          <div className="w-24 text-right text-xs tabular-nums leading-[1.1rem]">
            <div className="text-sm font-semibold text-gray-900">{r.leads.toLocaleString()}</div>
            <div className="text-gray-500">ปิดการขาย {r.purchases.toLocaleString()}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Share bar of lead statuses. The colour belongs to the status (see STATUS_SLOTS); statuses
 * past the sixth slot share one "other" colour and merge into a single bar segment, but each
 * keeps its own legend row.
 */
export function StatusShareCard({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return <div className="flex h-[220px] items-center justify-center text-sm text-gray-500">ยังไม่มีข้อมูล</div>;
  }
  const slotOf = (name: string) => {
    const k = STATUS_SLOTS.indexOf(name);
    return k >= 0 ? k : CATEGORICAL.length;
  };
  const colorOf = (name: string) => CATEGORICAL[slotOf(name)] ?? OTHER_COLOR;
  const head = data.filter((d) => slotOf(d.name) < CATEGORICAL.length);
  const tail = data.filter((d) => slotOf(d.name) >= CATEGORICAL.length);
  const tailSum = tail.reduce((s, d) => s + d.value, 0);
  const pct = (v: number) => `${((v / total) * 100).toFixed(1)}%`;
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
        {head.map((d) =>
          d.value > 0 ? <div key={d.name} title={`${d.name}: ${pct(d.value)}`} style={{ width: pct(d.value), background: colorOf(d.name) }} /> : null,
        )}
        {tailSum > 0 && <div title={`อื่น ๆ: ${pct(tailSum)}`} style={{ width: pct(tailSum), background: OTHER_COLOR }} />}
      </div>
      <ul className="mt-3 flex flex-1 flex-col divide-y divide-gray-100">
        {data.map((d) => (
          <li key={d.name} className="flex flex-1 items-center gap-2 py-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: colorOf(d.name) }} />
            <span className="min-w-0 flex-1 truncate text-gray-700">{d.name}</span>
            <span className="w-14 text-right tabular-nums text-gray-500">{pct(d.value)}</span>
            <span className="w-12 text-right font-medium tabular-nums text-gray-900">{d.value.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
