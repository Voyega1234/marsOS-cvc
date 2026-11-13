import { Metadata } from "next";

import { getSession } from "@/lib/auth";
import { loadAIJobsView } from "@/lib/ai-jobs-view";
import { PageHeader } from "@/components/ds";
import { AIJobsClient } from "@/components/professional/AIJobsClient";

export const metadata: Metadata = { title: "AI Jobs" };

export default async function AIJobsPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const view = await loadAIJobsView(orgId);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="AI" title="AI Jobs" subtitle={`${view.jobs.length} jobs total`} />
      <AIJobsClient {...view} />
    </div>
  );
}
