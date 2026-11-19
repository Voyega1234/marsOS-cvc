import { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { resolveAiCostRange } from "@/lib/ai-cost-range";
import { loadAiCostView } from "@/lib/ai-cost-data";
import { parseAiCostFilters, parseAiCostPage, parseAiCostSort } from "@/lib/ai-cost-filters";
import { PageHeader } from "@/components/ds";
import { AiCostClient } from "@/components/ai-cost/AiCostClient";

export const metadata: Metadata = { title: "AI Cost · Settings" };

// หน้า AI Cost (Settings → AI Cost) — แยกค่าใช้จ่ายตามระบบ ประเภทงาน โมเดล โปรเจกต์ ผู้ใช้
// ตัวกรองทั้งหมดอยู่ใน URL (?range= &module= &type= &model= &source= &user= &status= &sort= &page=)
// หน้า /ai-jobs ยังเป็นรายการ job เดิม (AIJobsClient) ไม่เปลี่ยน
type SP = Record<string, string | string[] | undefined>;

export default async function SettingsAiCostPage({ searchParams }: { searchParams?: SP }) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) redirect("/setup");
  // ADMIN only: the owner decided on 2026-11-18 that SEO_MANAGER must not see AI cost
  if (session!.user.role !== "ADMIN") redirect("/settings");

  const range = resolveAiCostRange(searchParams);
  const filters = parseAiCostFilters(searchParams);
  const sort = parseAiCostSort(searchParams);
  const view = await loadAiCostView(orgId, range, filters, { sort, page: parseAiCostPage(searchParams) });

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        eyebrow="Settings"
        title="AI Cost"
        subtitle="ค่าใช้จ่าย AI และ API ทั้งระบบ — เลือกช่วงเวลาและตัวกรองด้านล่างเพื่อดูว่าเงินไปอยู่ที่ไหน"
      />
      <AiCostClient view={view} range={range} filters={filters} sort={sort} />
    </div>
  );
}
