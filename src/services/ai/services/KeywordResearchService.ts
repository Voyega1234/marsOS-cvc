import { prisma } from "@/lib/prisma";
import { runAIJob, logActivity } from "../runner";
import { assertCanRunJob } from "../permissions";
import { mockKeywordResearch } from "../mock";
import { AINoDataError } from "../errors";
import { humanTitleSkillBlock } from "@/lib/article-human-voice-skill";
import { keywordWarnings } from "@/lib/ce-restrictions";
import { loadTitleRestrictions } from "@/lib/ce-restrictions-server";
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

  // ข้อจำกัดคำต้องห้ามของ Content Engine โปรเจกต์นี้ (ไม่มี/โหลดพัง = ไม่มีข้อจำกัด ไม่ทำให้งานล้ม)
  const tr = await loadTitleRestrictions(organizationId, { projectId });

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
    // Mars Human Voice Skill — ให้ ไอเดียหัวข้อบทความ อ่านเป็นภาษาคน (เจ้าของสั่ง 2026-09-28)
    appendPrompt: [humanTitleSkillBlock(project.language === 'en' ? 'en' : 'th'), tr.block].filter(Boolean).join("\n\n"),
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

  // keyword ไม่แก้/ไม่ตัดทิ้ง (นโยบาย: เตือนอย่างเดียว) — มีคำต้องห้ามใน main/related แจ้งทีมให้ตัดสินใจเอง
  const restrictionWarnings = Array.from(
    new Set([output.mainKeyword, ...(output.relatedKeywords ?? [])].flatMap((k) => (typeof k === "string" ? keywordWarnings(k, tr.terms) : []))),
  );

  return { keyword, output, jobId: result.jobId, isMock: result.isMock, restrictionWarnings };
}
