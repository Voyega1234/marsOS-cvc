import Link from "next/link";
import { TintTile, TargetBar } from "@/components/ui/Widgets";
import { LeadsByProjectList, StatusShareCard } from "@/components/line-tracking/AgencyCharts";

export interface AgencyStats {
  totalProjects: number;
  activeProjects: number;
  totalLeads: number;
  qualifiedLeads: number;
  purchases: number;
  conversionSent: number;
  conversionFailed: number;
}

export interface AgencyDashboardViewProps {
  stats: AgencyStats;
  leadsByProject: { name: string; leads: number; purchases: number }[];
  donutData: { name: string; value: number }[];
  guideHref: string;
  projectsHref: string;
}

// Presentation of /line-tracking; the real page and the preview replica both render this.
export function AgencyDashboardView({ stats, leadsByProject, donutData, guideHref, projectsHref }: AgencyDashboardViewProps) {
  const failed = stats.conversionFailed > 0;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl text-gray-900">Line Tracking</h1>
          <p className="mt-1 text-sm text-gray-500">
            ภาพรวมทุกโปรเจกต์ — Ads → เว็บไซต์ → LINE Lead → Conversion (ทีมทุกคนเห็นเหมือนกัน)
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={guideHref} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">คู่มือติดตั้ง</Link>
          <Link href={projectsHref} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">ดูโปรเจกต์ทั้งหมด →</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TintTile tint="neutral" label="โปรเจกต์ทั้งหมด" value={stats.totalProjects.toLocaleString()} sub={`LIVE ${stats.activeProjects}`}>
          <TargetBar value={stats.activeProjects} max={stats.totalProjects} size="sm" title={`LIVE ${stats.activeProjects} / ${stats.totalProjects}`} />
        </TintTile>
        <TintTile tint="blue" label="Leads ทั้งหมด" value={stats.totalLeads.toLocaleString()} sub={`Qualified ${stats.qualifiedLeads}`}>
          <TargetBar value={stats.qualifiedLeads} max={stats.totalLeads} size="sm" title={`Qualified ${stats.qualifiedLeads} / ${stats.totalLeads}`} />
        </TintTile>
        <TintTile tint="mint" label="ปิดการขาย" value={stats.purchases.toLocaleString()} sub="Won / Paid">
          <TargetBar value={stats.purchases} max={stats.totalLeads} size="sm" title={`Won / Paid ${stats.purchases} / ${stats.totalLeads} leads`} />
        </TintTile>
        <TintTile
          tint="neutral"
          label="Conversion ส่งแล้ว"
          value={stats.conversionSent.toLocaleString()}
          sub={<span className={failed ? "font-semibold text-red-500" : ""}>{failed ? `ล้มเหลว ${stats.conversionFailed}` : "ไม่มีที่ล้มเหลว"}</span>}
        >
          <TargetBar
            value={stats.conversionSent}
            max={stats.conversionSent + stats.conversionFailed}
            tone={failed ? "amber" : "green"}
            size="sm"
            title={`ส่งแล้ว ${stats.conversionSent} / ${stats.conversionSent + stats.conversionFailed}`}
          />
        </TintTile>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-gray-900">Leads &amp; ปิดการขาย ต่อโปรเจกต์</h2>
          </div>
          {leadsByProject.length === 0 ? (
            <div className="flex h-[220px] items-center justify-center text-sm text-gray-500">ยังไม่มีข้อมูล</div>
          ) : (
            <LeadsByProjectList data={leadsByProject} />
          )}
        </div>

        <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-base font-semibold text-gray-900">สถานะ Lead รวมทุกโปรเจกต์</h2>
          <div className="flex-1">
            <StatusShareCard data={donutData} />
          </div>
        </div>
      </div>
    </div>
  );
}
