import { prisma } from "@/lib/prisma";
import { runAIJob, logActivity } from "../runner";
import { assertCanRunJob } from "../permissions";
import { mockContentMap } from "../mock";
import { AINoDataError } from "../errors";
import type { ContentMapInput, ContentMapOutput } from "../types";

export async function runContentMap(input: ContentMapInput) {
  const { organizationId, projectId, keywords, userId, userRole } = input;

  // 1. Permission check
  assertCanRunJob(userRole, "CONTENT_MAP");

  // 2. Validate input
  if (!keywords || keywords.length === 0) throw new AINoDataError("keywords list");

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
  });
  if (!project) throw new AINoDataError(`Project ${projectId}`);

  // 3. Run job
  const result = await runAIJob<ContentMapOutput>({
    organizationId,
    projectId,
    jobType:    "CONTENT_MAP",
    promptType: "CONTENT_MAP_PROMPT",
    variables: {
      project_name:    project.name,
      website:         project.website,
      business_type:   project.businessType,
      target_audience: project.targetAudience,
      language:        project.language,
      seed_keyword:    keywords.join(", "),
    },
    userId,
    mockFn: () => mockContentMap(keywords, project.name),
  });

  // 4. Activity log
  await logActivity(organizationId, userId, "GENERATE_CONTENT_MAP", "Project", projectId, {
    keywordCount: keywords.length,
    totalArticles: result.output.totalArticles,
    jobId: result.jobId,
  });

  return { contentMap: result.output, jobId: result.jobId, isMock: result.isMock };
}
