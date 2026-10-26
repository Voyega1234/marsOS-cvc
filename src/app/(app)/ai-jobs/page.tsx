import { Metadata } from "next";

import { getSession } from "@/lib/auth";
import { loadAIJobsView } from "@/lib/ai-jobs-view";
import { AIJobsClient } from "@/components/professional/AIJobsClient";

export const metadata: Metadata = { title: "AI Jobs" };

export default async function AIJobsPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const view = await loadAIJobsView(orgId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-brand-navy">AI Jobs</h1>
        <p className="text-sm text-gray-500 mt-0.5">{view.jobs.length} jobs total</p>
      </div>
      <AIJobsClient {...view} />
    </div>
  );
}
