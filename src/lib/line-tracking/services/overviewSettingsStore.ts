// Reads and writes a project's Overview view setting (overviewMode.ts). It lives in one
// lt_project_connection row of type OVERVIEW_SETTINGS that stays NOT_CONNECTED, so the setup
// checklist (which counts CONNECTED rows) is unaffected. No authorization here: callers check.
import { prisma } from "@/lib/prisma";
import {
  OVERVIEW_SETTINGS_TYPE,
  parseOverviewSettings,
  type OverviewSettings,
} from "@/lib/line-tracking/overviewMode";

export async function getOverviewSettings(projectId: string): Promise<OverviewSettings> {
  const row = await prisma.projectConnection.findUnique({
    where: { projectId_type: { projectId, type: OVERVIEW_SETTINGS_TYPE } },
    select: { configJson: true },
  });
  return parseOverviewSettings(row?.configJson);
}

export async function saveOverviewSettings(projectId: string, settings: OverviewSettings): Promise<void> {
  const configJson = JSON.stringify({ mode: settings.mode, adSpendByMonth: settings.adSpendByMonth });
  await prisma.projectConnection.upsert({
    where: { projectId_type: { projectId, type: OVERVIEW_SETTINGS_TYPE } },
    create: { projectId, type: OVERVIEW_SETTINGS_TYPE, status: "NOT_CONNECTED", configJson },
    update: { configJson },
  });
}
