/**
 * Which Asana section BLM tasks go into. Pure helpers only (no network), so they can be tested without Asana.
 *
 * Without a section Asana drops a new task into the project's first section (usually "Foundation & Audit").
 * Backlink work belongs in "Off-Page SEO", so we look that section up by name.
 */

export const BLM_TASK_SECTION_NAME = "Off-Page SEO";

/** Lower-case, drop spaces, hyphens, dashes, underscores and dots, so "Off-Page SEO", "off page seo" and "OffPage SEO" compare equal. */
export function normalizeSectionName(name: string): string {
  return String(name ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-‐-―−_.]+/g, "");
}

/**
 * Pick the section for BLM tasks. An exact (normalized) "Off-Page SEO" wins; otherwise the first section whose
 * name contains "offpage" (e.g. "Off-Page SEO / Backlinks"). Returns null when none match, so the caller keeps
 * Asana's default placement.
 */
export function pickOffPageSection(sections: { gid: string; name?: string | null }[]): string | null {
  const want = normalizeSectionName(BLM_TASK_SECTION_NAME);
  const list = Array.isArray(sections) ? sections.filter((s) => s && typeof s.gid === "string" && s.gid) : [];
  const exact = list.find((s) => normalizeSectionName(s.name ?? "") === want);
  if (exact) return exact.gid;
  const loose = list.find((s) => normalizeSectionName(s.name ?? "").includes("offpage"));
  return loose ? loose.gid : null;
}
