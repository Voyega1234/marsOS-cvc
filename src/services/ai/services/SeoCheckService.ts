import { prisma } from "@/lib/prisma";
import { runAIJob, logActivity } from "../runner";
import { assertCanRunJob } from "../permissions";
import { mockSeoCheck, mockSeoMetadata } from "../mock";
import { AINoDataError, AIPreConditionError } from "../errors";
import { humanTitleSkillBlock } from "@/lib/article-human-voice-skill";
import { cleanGeneratedFields, cleanPlainText, tallyWarning } from "@/lib/ce-restrictions";
import { loadTitleRestrictions } from "@/lib/ce-restrictions-server";
import type { TitleRestrictions } from "@/lib/ce-restrictions";
import type { ArticleJobInput, SeoCheckOutput } from "../types";

/**
 * faqSchema เป็น JSON-LD ที่เก็บเป็นสตริง — แทนคำต้องห้ามในทุกค่าข้อความ (question/answer/name/text ฯลฯ)
 * ยกเว้น key ที่ขึ้นต้นด้วย "@" (@type/@context) · parse ไม่ได้ = คืนสตริงเดิม ไม่แตะ
 */
function cleanFaqSchema(raw: string, tr: TitleRestrictions, tally: Map<string, number>): string {
  if (!raw || !tr.terms.length) return raw;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return raw;
  }
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const r = cleanPlainText(v, tr.terms);
      for (const h of r.remaining) tally.set(h.term, (tally.get(h.term) ?? 0) + h.count);
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = k.startsWith("@") ? val : walk(val);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(data));
}

export async function runSeoCheck(input: ArticleJobInput) {
  const { organizationId, articleId, userId, userRole } = input;

  // 1. Permission check
  assertCanRunJob(userRole, "SEO_CHECK");

  // 2. Load article
  const article = await prisma.article.findFirst({
    where: { id: articleId, project: { organizationId } },
    include: {
      project: { include: { defaultTemplate: true } },
      keyword: true,
    },
  });
  if (!article) throw new AINoDataError(`Article ${articleId}`);

  if (!article.htmlContent) {
    throw new AIPreConditionError("ต้องสร้างบทความก่อนถึงจะรัน SEO Check ได้");
  }

  const kw = article.keyword?.keyword ?? article.title;
  const template = article.project.defaultTemplate;

  // 3. Set status → SEO_REVIEW
  await prisma.article.update({
    where: { id: articleId },
    data: { status: "SEO_REVIEW" },
  });

  try {
    // 4. Run SEO check AI job
    const checkResult = await runAIJob<SeoCheckOutput>({
      organizationId,
      projectId:  article.projectId,
      articleId,
      jobType:    "SEO_CHECK",
      promptType: "SEO_CHECK_PROMPT",
      variables: {
        article_title:    article.title,
        main_keyword:     kw,
        search_intent:    article.searchIntent,
        funnel_stage:     article.funnelStage,
        html_content:     (article.htmlContent ?? "").slice(0, 4000),
        seo_title:        article.seoTitle         ?? "",
        meta_description: article.metaDescription  ?? "",
        language:         article.project.language,
      },
      userId,
      mockFn: () => mockSeoCheck(article.title, kw),
    });

    const seoOutput = checkResult.output;
    // normalize: new prompt uses recommendations, legacy mock uses suggestions
    const allSuggestions = seoOutput.recommendations ?? seoOutput.suggestions ?? [];
    // normalize: derive passed from approvalRecommendation or score
    const passed = seoOutput.approvalRecommendation
      ? seoOutput.approvalRecommendation === "APPROVE"
      : (seoOutput.passed ?? seoOutput.seoScore >= 70);

    // ข้อจำกัดคำต้องห้ามของ Content Engine โปรเจกต์นี้ (ไม่มี/โหลดพัง = ไม่มีข้อจำกัด ไม่ทำให้งานล้ม)
    const tr = await loadTitleRestrictions(organizationId, { projectId: article.projectId });
    const restrictionTally = new Map<string, number>();

    // 5. Generate SEO metadata using mock (or real provider via SEO_METADATA job)
    const metaResult = await runAIJob<{ seoTitle: string; metaDescription: string; faqSchema: string }>({
      organizationId,
      projectId:  article.projectId,
      articleId,
      jobType:    "SEO_METADATA",
      promptType: "SEO_CHECK_PROMPT",
      variables: {
        article_title:    article.title,
        main_keyword:     kw,
        brand_name:       template?.brandName ?? article.project.name,
        language:         article.project.language,
      },
      userId,
      mockFn: () => mockSeoMetadata(article.title, kw, template?.brandName ?? article.project.name),
      // Mars Human Voice Skill — ให้ meta title/description อ่านเป็นภาษาคน (เจ้าของสั่ง 2026-09-28)
      appendPrompt: [humanTitleSkillBlock('th'), tr.block].filter(Boolean).join("\n\n"),
    });

    // seoTitle / metaDescription / faqSchema ถูกบันทึกและ push เป็นของจริง — แทนคำต้องห้ามก่อนลง DB
    const cleaned = cleanGeneratedFields(
      tr,
      { title: metaResult.output.seoTitle, metaDescription: metaResult.output.metaDescription },
      restrictionTally,
    );
    const metaOutput = {
      ...metaResult.output,
      seoTitle:        cleaned.title ?? metaResult.output.seoTitle,
      metaDescription: cleaned.metaDescription ?? metaResult.output.metaDescription,
      faqSchema:       cleanFaqSchema(metaResult.output.faqSchema, tr, restrictionTally),
    };

    // 6. Save Review record
    const review = await prisma.review.create({
      data: {
        articleId,
        reviewerId:      userId,
        status:          "PENDING",
        seoScore:        seoOutput.seoScore,
        aeoScore:        seoOutput.aeoScore,
        conversionScore: seoOutput.conversionScore,
        riskLevel:       seoOutput.riskLevel,
        notes:           JSON.stringify({
          summary:         seoOutput.summary,
          issues:          seoOutput.issues,
          recommendations: allSuggestions,
          approvalRecommendation: seoOutput.approvalRecommendation,
        }),
      },
    });

    // 7. Update article with SEO metadata + status
    await prisma.article.update({
      where: { id: articleId },
      data: {
        seoTitle:        metaOutput.seoTitle,
        metaDescription: metaOutput.metaDescription,
        faqSchema:       metaOutput.faqSchema,
        status:          passed ? "SEO_DONE" : "SEO_NEEDS_REVISION",
      },
    });

    // 8. Activity log
    await logActivity(organizationId, userId, "RUN_SEO_CHECK", "Article", articleId, {
      seoScore:               seoOutput.seoScore,
      aeoScore:               seoOutput.aeoScore,
      passed,
      approvalRecommendation: seoOutput.approvalRecommendation,
      reviewId:               review.id,
      jobId:                  checkResult.jobId,
    });

    const leftover = tallyWarning("คำต้องห้ามที่ยังเหลือใน SEO title/meta/FAQ", restrictionTally);
    const restrictionWarnings: string[] = leftover ? [leftover] : [];

    return { review, seoOutput, metaOutput, passed, jobId: checkResult.jobId, isMock: checkResult.isMock, restrictionWarnings };

  } catch (err) {
    await prisma.article.update({
      where: { id: articleId },
      data: { status: "ERROR" },
    }).catch(() => {});
    throw err;
  }
}
