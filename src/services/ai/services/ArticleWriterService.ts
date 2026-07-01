import { prisma } from "@/lib/prisma";
import { runAIJob, logActivity, snapshotArticleVersion } from "../runner";
import { assertCanRunJob } from "../permissions";
import { mockArticleHtml } from "../mock";
import { AINoDataError, AIPreConditionError } from "../errors";
import { safeJson } from "@/lib/utils";
import type { ArticleJobInput } from "../types";

export async function runArticleWriter(input: ArticleJobInput) {
  const { organizationId, articleId, userId, userRole } = input;

  // 1. Permission check
  assertCanRunJob(userRole, "ARTICLE_HTML");

  // 2. Load article with project + brand template + keyword
  const article = await prisma.article.findFirst({
    where: { id: articleId, project: { organizationId } },
    include: {
      project: { include: { defaultTemplate: true } },
      keyword: true,
    },
  });
  if (!article) throw new AINoDataError(`Article ${articleId}`);

  // 3. Require outline before writing
  if (!article.outline) {
    throw new AIPreConditionError("ต้องสร้าง Outline ก่อนถึงจะสร้างบทความได้");
  }

  const kw = article.keyword?.keyword ?? article.title;
  const related = safeJson<string[]>(article.keyword?.relatedKeywords, []);
  const template = article.project.defaultTemplate;

  // Format internal links as instruction text for the prompt
  const rawLinks = safeJson<{ keyword: string; url: string }[]>(
    (article.project as { internalLinks?: string }).internalLinks ?? "[]",
    []
  );
  const internalLinksText = rawLinks.length > 0
    ? rawLinks.map((l, i) => `${i + 1}. คีย์เวิร์ด: "${l.keyword}" → ${l.url}`).join("\n")
    : "ไม่มี internal link ที่กำหนดไว้";

  // 4. Set status → ARTICLE_GENERATING
  await prisma.article.update({
    where: { id: articleId },
    data: { status: "ARTICLE_GENERATING" },
  });

  try {
    // 5. Run AI job
    const result = await runAIJob<string>({
      organizationId,
      projectId:  article.projectId,
      articleId,
      jobType:    "ARTICLE_HTML",
      promptType: "ARTICLE_WRITER_PROMPT",
      variables: {
        article_title:            article.title,
        main_keyword:             kw,
        related_keywords:         related.join(", "),
        outline:                  article.outline ?? "",
        funnel_stage:             article.funnelStage,
        search_intent:            article.searchIntent,
        website:                  article.project.website,
        brand_name:               template?.brandName    ?? article.project.name,
        business_type:            article.project.businessType,
        target_audience:          article.project.targetAudience,
        language:                 article.project.language,
        project_name:             article.project.name,
        brand_voice:              template?.brandVoice      ?? "ภาษาทางการ น่าเชื่อถือ เชี่ยวชาญ",
        html_template:            template?.htmlStructure    ?? "",
        cta_text:                 template?.ctaText          ?? "ติดต่อทีมงานเพื่อรับคำปรึกษาฟรี",
        contact_block:            template?.contactBlock     ?? "",
        reference_rules:          template?.referenceRules   ?? "",
        forbidden_claims:         template?.forbiddenClaims  ?? "",
        compliance_notes:         template?.schemaRules      ?? "",
        internal_links:           internalLinksText,
        project_context:          (article.project as { projectContext?: string | null }).projectContext ?? "",
        writing_instructions:     (article.project as { writingPrompt?: string | null }).writingPrompt ?? "",
        industry:                 article.project.businessType,
        content_goal:             "",
        conversion_goal:          "",
        product_or_service:       "",
        unique_selling_points:    "",
        trust_signals:            "",
        author_profile:           "",
        reviewer_profile:         "",
        official_sources:         template?.referenceRules   ?? "",
        external_reference_rules: template?.referenceRules   ?? "",
      },
      userId,
      mockFn: () => mockArticleHtml(
        article.title,
        kw,
        template?.ctaText     ?? undefined,
        template?.contactBlock ?? undefined,
        template?.brandVoice   ?? undefined,
      ),
    });

    const htmlContent = typeof result.output === "string" ? result.output : JSON.stringify(result.output);

    // 6. Snapshot existing content before overwriting
    await snapshotArticleVersion(articleId, userId, "Before regenerating article");

    // 7. Save HTML + update status
    await prisma.article.update({
      where: { id: articleId },
      data: {
        htmlContent,
        status: "ARTICLE_DONE",
      },
    });

    // 8. Activity log
    await logActivity(organizationId, userId, "GENERATE_ARTICLE", "Article", articleId, {
      htmlLength: htmlContent.length,
      jobId: result.jobId,
    });

    return { htmlContent, jobId: result.jobId, isMock: result.isMock };

  } catch (err) {
    await prisma.article.update({
      where: { id: articleId },
      data: { status: "ERROR" },
    }).catch(() => {});
    throw err;
  }
}
