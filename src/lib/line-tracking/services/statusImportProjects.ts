// Which projects use the customer-list status import. Kept apart from statusImportService
// so the conversion queue can check it without loading the file parser.
import type { LtProject as Project } from "@prisma/client"
import { prisma } from "@/lib/prisma"

/** Projects (by name, case-insensitive) that get the file import on the Leads page. */
const IMPORT_PROJECT_NAMES = ["mfactors"]

export function isStatusImportProject(project: Pick<Project, "name">): boolean {
  return IMPORT_PROJECT_NAMES.includes(project.name.trim().toLowerCase().replace(/\s+/g, " "))
}

/**
 * The survey appointment from the file ("วันที่นัดสำรวจ" + "เวลา") has no column on Lead,
 * so the import writes it at the end of the status history note after this mark.
 */
export const SURVEY_MARK = "📅 นัดสำรวจ"
const SURVEY_IN_NOTE = /📅 นัดสำรวจ (.+)$/

/** Latest survey appointment per lead, read from the status history notes. */
export async function latestSurveyDates(projectId: string, leadIds?: string[]): Promise<Map<string, string>> {
  const rows = await prisma.leadStatusHistory.findMany({
    where: { lead: { projectId }, ...(leadIds ? { leadId: { in: leadIds } } : {}), note: { contains: SURVEY_MARK } },
    orderBy: { createdAt: "desc" },
    select: { leadId: true, note: true },
  })
  const out = new Map<string, string>()
  for (const r of rows) {
    const survey = r.note?.match(SURVEY_IN_NOTE)?.[1]?.trim()
    if (survey && !out.has(r.leadId)) out.set(r.leadId, survey)
  }
  return out
}
