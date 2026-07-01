import { prisma } from "@/lib/prisma";
import { runAIJob, logActivity } from "../runner";
import { assertCanRunJob } from "../permissions";
import { mockImagePrompt } from "../mock";
import { AINoDataError } from "../errors";
import type { ArticleJobInput, ImagePromptOutput } from "../types";

export async function runImagePrompt(input: ArticleJobInput) {
  const { organizationId, articleId, userId, userRole } = input;

  // 1. Permission check
  assertCanRunJob(userRole, "IMAGE_PROMPT");

  // 2. Load article with keyword
  const article = await prisma.article.findFirst({
    where: { id: articleId, project: { organizationId } },
    include: {
      project: { include: { defaultTemplate: true } },
      keyword: true,
    },
  });
  if (!article) throw new AINoDataError(`Article ${articleId}`);

  const template = article.project.defaultTemplate;
  const kw = article.keyword?.keyword ?? article.title;

  try {
    // 3. Run AI job
    const result = await runAIJob<ImagePromptOutput>({
      organizationId,
      projectId:  article.projectId,
      articleId,
      jobType:    "IMAGE_PROMPT",
      promptType: "IMAGE_PROMPT_GENERATOR",
      variables: {
        article_title:   article.title,
        main_keyword:    kw,
        business_type:   article.project.businessType,
        target_audience: article.project.targetAudience,
        brand_voice:     template?.brandVoice  ?? "professional, trustworthy, muted green",
        image_style:     template?.imageStyle  ?? "photorealistic, professional",
        color_theme:     template?.colorTheme  ?? "muted green and white",
        language:        article.project.language,
        project_name:    article.project.name,
      },
      userId,
      mockFn: () => mockImagePrompt(article.title, template?.brandVoice ?? undefined),
    });

    const output = result.output;

    // 4. Save image prompt to article + update status
    await prisma.article.update({
      where: { id: articleId },
      data: {
        imagePrompt: JSON.stringify(output),
        status:      "IMAGE_PROMPT_DONE",
      },
    });

    // 5. Activity log
    await logActivity(organizationId, userId, "GENERATE_IMAGE_PROMPT", "Article", articleId, {
      jobId: result.jobId,
    });

    return { imagePrompt: output, jobId: result.jobId, isMock: result.isMock };

  } catch (err) {
    await prisma.article.update({
      where: { id: articleId },
      data: { status: "ERROR" },
    }).catch(() => {});
    throw err;
  }
}
