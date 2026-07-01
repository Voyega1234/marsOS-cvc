import type { Role } from "@/types";
import type { JobType } from "./types";
import { AIPermissionError } from "./errors";

/**
 * Which roles may trigger each job type.
 * ADMIN can always do everything — it's implicit at the top of each list.
 */
const JOB_PERMISSIONS: Record<JobType, Role[]> = {
  KEYWORD_RESEARCH: ["ADMIN", "SEO_MANAGER", "SEO_PLANNER"],
  CONTENT_MAP:      ["ADMIN", "SEO_MANAGER", "SEO_PLANNER"],
  OUTLINE:          ["ADMIN", "SEO_MANAGER", "SEO_PLANNER", "WRITER"],
  ARTICLE_HTML:     ["ADMIN", "SEO_MANAGER", "WRITER"],
  SEO_METADATA:     ["ADMIN", "SEO_MANAGER", "WRITER"],
  IMAGE_PROMPT:     ["ADMIN", "SEO_MANAGER", "WRITER"],
  SEO_CHECK:        ["ADMIN", "SEO_MANAGER", "REVIEWER"],
  WORDPRESS_DRAFT:  ["ADMIN", "SEO_MANAGER", "PUBLISHER"],
  ARTICLE_AUDIT:    ["ADMIN", "SEO_MANAGER", "WRITER", "REVIEWER"],
  ARTICLE_FIX:      ["ADMIN", "SEO_MANAGER", "WRITER"],
};

export function assertCanRunJob(role: Role, jobType: JobType): void {
  const allowed = JOB_PERMISSIONS[jobType];
  if (!allowed.includes(role)) {
    throw new AIPermissionError(jobType, role);
  }
}

export function canRunJob(role: Role, jobType: JobType): boolean {
  return JOB_PERMISSIONS[jobType].includes(role);
}
