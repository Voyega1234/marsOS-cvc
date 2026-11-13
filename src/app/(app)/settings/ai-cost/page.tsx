import { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { loadAIJobsView } from "@/lib/ai-jobs-view";
import { PageHeader } from "@/components/ds";
import { AIJobsClient } from "@/components/professional/AIJobsClient";

export const metadata: Metadata = { title: "AI Cost · Settings" };

// หน้า AI (track cost ทั้งหมด) ย้ายมาเป็น subpage ของ Settings
// แยกค่าใช้จ่ายต่อ project (Clients), ลูกค้า Upload Article และงาน Studio — ข้อมูลชุดเดียวกับหน้า AI Jobs
export default async function SettingsAiCostPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) redirect("/setup");
  if (!["ADMIN", "SEO_MANAGER"].includes(session!.user.role)) redirect("/settings");

  const view = await loadAIJobsView(orgId);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Settings"
        title="AI Cost"
        subtitle={`ค่าใช้จ่าย AI ทั้งหมด — แยกตาม client project, ลูกค้า Upload Article และงาน Studio · ${view.jobs.length} jobs`}
      />
      <AIJobsClient {...view} />
    </div>
  );
}
