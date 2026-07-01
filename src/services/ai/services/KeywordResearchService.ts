import { prisma } from "@/lib/prisma";
import { runAIJob, logActivity } from "../runner";
import { assertCanRunJob } from "../permissions";
import { mockKeywordResearch } from "../mock";
import { AINoDataError } from "../errors";
import type { KeywordResearchInput, KeywordOutput } from "../types";

export async function runKeywordResearch(input: KeywordResearchInput) {
  const { organizationId, projectId, seedKeyword, userId, userRole } = input;

  // 1. Permission check
  assertCanRunJob(userRole, "KEYWORD_RESEARCH");

  // 2. Load project (org-scoped)
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
  });
  if (!project) throw new AINoDataError(`Project ${projectId}`);

  // 3. Run job
  const result = await runAIJob<KeywordOutput>({
    organizationId,
    projectId,
    jobType:    "KEYWORD_RESEARCH",
    promptType: "KEYWORD_RESEARCH_PROMPT",
    variables: {
      project_name:    project.name,
      website:         project.website,
      business_type:   project.businessType,
      target_audience: project.targetAudience,
      language:        project.language,
      seed_keyword:    seedKeyword,
    },
    userId,
    mockFn: () => mockKeywordResearch(seedKeyword, project.language),
  });

  const output = result.output;

  // 4. Save keyword to DB
  const keyword = await prisma.keyword.create({
    data: {
      projectId,
      seedKeyword,
      keyword:         output.mainKeyword,
      relatedKeywords: JSON.stringify(output.relatedKeywords),
      intent:          output.intent,
      funnelStage:     output.funnelStage,
      volume:          output.estimatedVolume,
      difficulty:      output.difficulty,
    },
  });

  // 5. Activity log
  await logActivity(organizationId, userId, "KEYWORD_RESEARCH", "Keyword", keyword.id, {
    seedKeyword,
    mainKeyword: output.mainKeyword,
    jobId: result.jobId,
  });

  return { keyword, output, jobId: result.jobId, isMock: result.isMock };
}
