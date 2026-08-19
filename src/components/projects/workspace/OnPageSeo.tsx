"use client";

import { useCallback, useState } from "react";
import { Globe, ListChecks } from "lucide-react";

import type { WorkspaceProject } from "./types";
import { ONPAGE_CATEGORIES, ONPAGE_TEMPLATES } from "@/lib/seo-check-templates";
import { SeoTaskChecklist, type SeoTaskStats } from "./SeoTaskChecklist";

interface Props {
  project: WorkspaceProject;
  userRole: string;
}

const EMPTY_STATS: SeoTaskStats = { total: 0, done: 0, open: 0 };

export function OnPageSeo({ project, userRole }: Props) {
  const readOnly = userRole === "CLIENT";
  const [stats, setStats] = useState<SeoTaskStats>(EMPTY_STATS);
  const displayName = project.clientName ?? project.name;

  const handleStatsChange = useCallback((next: SeoTaskStats) => setStats(next), []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-brand-navy">On-Page SEO</h2>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-gray-500">
            <span>{displayName}</span>
            {project.website && (
              <a
                href={project.website}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-indigo-600 hover:underline"
              >
                <Globe className="h-3.5 w-3.5" />
                {project.website}
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5 text-gray-500">
            <ListChecks className="h-4 w-4" />
            เปิดอยู่ <span className="font-semibold text-brand-navy">{stats.open}</span>
          </div>
          <div className="text-gray-500">
            เสร็จแล้ว <span className="font-semibold text-green-600">{stats.done}</span> / {stats.total}
          </div>
        </div>
      </div>

      <SeoTaskChecklist
        projectId={project.id}
        area="ONPAGE"
        categories={ONPAGE_CATEGORIES}
        templates={ONPAGE_TEMPLATES}
        readOnly={readOnly}
        onStatsChange={handleStatsChange}
      />
    </div>
  );
}
