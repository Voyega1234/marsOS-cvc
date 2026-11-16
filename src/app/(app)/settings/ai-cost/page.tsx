import { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { loadAIJobsView } from "@/lib/ai-jobs-view";
import { resolveAiCostRange } from "@/lib/ai-cost-range";
import { PageHeader } from "@/components/ds";
import { AIJobsClient } from "@/components/professional/AIJobsClient";

export const metadata: Metadata = { title: "AI Cost · Settings" };

// หน้า AI (track cost ทั้งหมด) ย้ายมาเป็น subpage ของ Settings
// แยกค่าใช้จ่ายต่อ project (Clients), ลูกค้า Upload Article และงาน Studio — ข้อมูลชุดเดียวกับหน้า AI Jobs
export default async function SettingsAiCostPage({ searchParams }: {
  searchParams?: { range?: string | string[]; from?: string | string[]; to?: string | string[] };
}) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) redirect("/setup");
  if (!["ADMIN", "SEO_MANAGER"].includes(session!.user.role)) redirect("/settings");

  // ช่วงเวลาอยู่ใน URL (?range=7d หรือ ?from=&to=) — ไม่ส่ง = เดือนนี้
  const view = await loadAIJobsView(orgId, resolveAiCostRange(searchParams));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Settings"
        title="AI Cost"
        subtitle={`ค่าใช้จ่าย AI ทั้งหมด — แยกตาม client project, ลูกค้า Upload Article และงาน Studio · ${view.range.label} · ${view.totalJobsRange.toLocaleString()} jobs`}
      />
      <AIJobsClient {...view} />
    </div>
  );
}
