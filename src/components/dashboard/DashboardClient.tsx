"use client";

import { useUIMode } from "@/contexts/UIModeContext";
import { SimpleDashboard } from "@/components/simple/SimpleDashboard";
import { ProfessionalDashboard } from "@/components/dashboard/ProfessionalDashboard";

interface MyArticle {
  id: string;
  title: string;
  status: string;
  funnelStage: string;
  updatedAt: Date;
  project: { name: string };
}

interface ActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: Date;
  user: { name: string | null };
}

interface JobEntry {
  id: string;
  jobType: string;
  status: string;
  modelProvider: string;
  estimatedCost?: number | null;
  createdAt: Date;
}

interface Props {
  userName: string;
  pipelineCounts: Record<string, number>;
  myArticles: MyArticle[];
  allArticles: {
    id: string;
    title: string;
    status: string;
    funnelStage: string;
    updatedAt: Date;
    project: { id: string; name: string };
    keyword?: { keyword: string } | null;
    assignedTo?: { name: string | null } | null;
  }[];
  recentActivity: ActivityEntry[];
  recentJobs: JobEntry[];
  stats: {
    total: number;
    inReview: number;
    approved: number;
    posted: number;
    errors: number;
    aiJobsToday: number;
    needsAction: number;
    projectCount: number;
    outlinesDone: number;
    articlesDone: number;
    wpDrafted: number;
    aiCostMonth: number;
    monthlyTarget?: number;
    aiCostLimit?: number;
    postedThisMonth?: number;
  };
  stepCounts: { key: string; label: string; labelTh: string; count: number }[];
  upcomingDeadlines?: { id: string; title: string; scheduledAt: Date | null; status: string }[];
}

export function DashboardClient(props: Props) {
  const { mode } = useUIMode();

  if (mode === "simple") {
    return (
      <SimpleDashboard
        userName={props.userName}
        pipelineCounts={props.pipelineCounts}
        myArticles={props.myArticles}
        recentActivity={props.recentActivity}
        stats={{
          total: props.stats.total,
          approved: props.stats.approved,
          posted: props.stats.posted,
          needsAction: props.stats.needsAction,
        }}
      />
    );
  }

  return <ProfessionalDashboard {...props} />;
}
