import {
  getAgencyDashboardStats,
  getAgencyLeadsByProject,
  getAgencyStatusDistribution,
} from "@/lib/line-tracking/services/projectService";
import { AgencyDashboardView } from "@/components/line-tracking/AgencyDashboardView";
import { LEAD_STATUS_LABEL } from "@/lib/line-tracking/enums";

export const dynamic = "force-dynamic";

// ภาพรวมทุกโปรเจกต์ (dashboard เหมือน Linli) — ทุกคนที่ล้อกอินเห็นเหมือนกัน
export default async function LineTrackingDashboard() {
  const [stats, leadsByProject, statusDist] = await Promise.all([
    getAgencyDashboardStats(),
    getAgencyLeadsByProject(),
    getAgencyStatusDistribution(),
  ]);

  const donutData = statusDist.map((s) => ({
    name: (LEAD_STATUS_LABEL as Record<string, string>)[s.status] ?? s.status,
    value: s.count,
  }));

  return (
    <AgencyDashboardView
      stats={stats}
      leadsByProject={leadsByProject}
      donutData={donutData}
      guideHref="/line-tracking/guide"
      projectsHref="/line-tracking/projects"
    />
  );
}
