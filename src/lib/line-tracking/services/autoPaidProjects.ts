// Which projects close deals straight to PAID from slips / sales-document PDFs (KOWA).
// Kept apart from salesDocumentService so leadService and client-facing pages can check
// it without an import cycle (salesDocumentService imports leadService).
import type { LtProject as Project } from "@prisma/client";
import { LEAD_STATUS, type LeadStatus } from "@/lib/line-tracking/enums";

/** Projects (by name, case-insensitive) whose sales-document PDFs move the lead straight to PAID. */
const AUTO_PAID_PDF_PROJECT_NAMES = ["kowa cctv"];

export function isAutoPaidProject(project: Pick<Project, "name">): boolean {
  return AUTO_PAID_PDF_PROJECT_NAMES.includes(project.name.trim().toLowerCase().replace(/\s+/g, " "));
}

/**
 * Lead statuses a project uses. BOOKED (900 THB booking slip) exists only for auto-PAID
 * projects, and they close every deal as PAID, so WON is dropped there (it would only
 * duplicate the purchase conversion).
 */
export function projectLeadStatuses(project: Pick<Project, "name">): readonly LeadStatus[] {
  const hidden: LeadStatus = isAutoPaidProject(project) ? "WON" : "BOOKED";
  return LEAD_STATUS.filter((s) => s !== hidden);
}
