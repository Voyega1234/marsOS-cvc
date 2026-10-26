import { prisma } from "@/lib/prisma";
import { runAIJob, logActivity } from "../runner";
import { assertCanRunJob } from "../permissions";
import { mockContentMap } from "../mock";
import { AINoDataError } from "../errors";
import { humanTitleSkillBlock } from "@/lib/article-human-voice-skill";
import { cleanGeneratedFields, keywordWarnings, tallyWarning } from "@/lib/ce-restrictions";
import { loadTitleRestrictions } from "@/lib/ce-restrictions-server";
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

  // ข้อจำกัดคำต้องห้ามของ Content Engine โปรเจกต์นี้ (ไม่มี/โหลดพัง = ไม่มีข้อจำกัด ไม่ทำให้งานล้ม)
  const tr = await loadTitleRestrictions(organizationId, { projectId });
  const restrictionTally = new Map<string, number>();

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
    // Mars Human Voice Skill — ให้ proposedTitle อ่านเป็นภาษาคน (เจ้าของสั่ง 2026-09-28)
    appendPrompt: [humanTitleSkillBlock(project.language === 'en' ? 'en' : 'th'), tr.block].filter(Boolean).join("\n\n"),
  });

  // proposedTitle เป็นชื่อบทความที่ทีมจะเอาไปใช้ — แทนคำต้องห้ามก่อนคืนให้ผู้เรียก (keyword ไม่แก้ แค่เตือน)
  const output = result.output;
  if (tr.terms.length) {
    for (const tier of [output.tofu, output.mofu, output.bofu]) {
      if (!Array.isArray(tier)) continue;
      for (const entry of tier) {
        const slug = (entry as { slug?: string }).slug;
        const cleaned = cleanGeneratedFields(tr, { title: entry.proposedTitle, slug }, restrictionTally);
        if (cleaned.title !== undefined) entry.proposedTitle = cleaned.title;
        if (slug && cleaned.slug !== undefined) (entry as { slug?: string }).slug = cleaned.slug;
      }
    }
  }
  const leftover = tallyWarning("คำต้องห้ามที่ยังเหลือในชื่อบทความ", restrictionTally);
  const restrictionWarnings: string[] = [
    ...(leftover ? [leftover] : []),
    ...Array.from(new Set(keywords.flatMap((k) => keywordWarnings(k, tr.terms)))),
  ];

  // 4. Activity log
  await logActivity(organizationId, userId, "GENERATE_CONTENT_MAP", "Project", projectId, {
    keywordCount: keywords.length,
    totalArticles: output.totalArticles,
    jobId: result.jobId,
  });

  return { contentMap: output, jobId: result.jobId, isMock: result.isMock, restrictionWarnings };
}
