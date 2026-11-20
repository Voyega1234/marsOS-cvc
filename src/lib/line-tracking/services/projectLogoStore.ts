// Reads and writes project logos (see projectLogo.ts). No authorization here: callers check.
import { prisma } from "@/lib/prisma";
import { PROJECT_LOGO_TYPE, logoFromConfig } from "@/lib/line-tracking/projectLogo";

export async function getProjectLogo(projectId: string): Promise<string | null> {
  const row = await prisma.projectConnection.findUnique({
    where: { projectId_type: { projectId, type: PROJECT_LOGO_TYPE } },
    select: { configJson: true },
  });
  return logoFromConfig(row?.configJson);
}

/** Every project's logo in one query, keyed by project id. Projects without one are absent. */
export async function getAllProjectLogos(): Promise<Map<string, string>> {
  const rows = await prisma.projectConnection.findMany({
    where: { type: PROJECT_LOGO_TYPE },
    select: { projectId: true, configJson: true },
  });
  const logos = new Map<string, string>();
  for (const row of rows) {
    const logo = logoFromConfig(row.configJson);
    if (logo) logos.set(row.projectId, logo);
  }
  return logos;
}

/** dataUri must already have passed parseProjectLogo. */
export async function saveProjectLogo(projectId: string, dataUri: string): Promise<void> {
  const configJson = JSON.stringify({ dataUri });
  await prisma.projectConnection.upsert({
    where: { projectId_type: { projectId, type: PROJECT_LOGO_TYPE } },
    create: { projectId, type: PROJECT_LOGO_TYPE, status: "NOT_CONNECTED", configJson },
    update: { configJson },
  });
}

export async function removeProjectLogo(projectId: string): Promise<void> {
  await prisma.projectConnection.deleteMany({ where: { projectId, type: PROJECT_LOGO_TYPE } });
}
