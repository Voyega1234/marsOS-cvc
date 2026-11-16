import { Metadata } from "next";

import { getSession } from "@/lib/auth";
import { loadAIJobsView } from "@/lib/ai-jobs-view";
import { resolveAiCostRange } from "@/lib/ai-cost-range";
import { PageHeader } from "@/components/ds";
import { AIJobsClient } from "@/components/professional/AIJobsClient";

export const metadata: Metadata = { title: "AI Jobs" };

export default async function AIJobsPage({ searchParams }: {
  searchParams?: { range?: string | string[]; from?: string | string[]; to?: string | string[] };
}) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const view = await loadAIJobsView(orgId, resolveAiCostRange(searchParams));

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="AI" title="AI Jobs" subtitle={`${view.range.label} · ${view.totalJobsRange.toLocaleString()} jobs`} />
      <AIJobsClient {...view} />
    </div>
  );
}
