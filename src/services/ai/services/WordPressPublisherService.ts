import { prisma } from "@/lib/prisma";
import { runAIJob, logActivity } from "../runner";
import { assertCanRunJob } from "../permissions";
import { mockWordPressDraft } from "../mock";
import { AINoDataError, AIPreConditionError } from "../errors";
import type { ArticleJobInput, WordPressOutput } from "../types";

export async function runWordPressPublisher(input: ArticleJobInput) {
  const { organizationId, articleId, userId, userRole } = input;

  // 1. Permission check
  assertCanRunJob(userRole, "WORDPRESS_DRAFT");

  // 2. Load article with project + wordpress connection
  const article = await prisma.article.findFirst({
    where: { id: articleId, project: { organizationId } },
    include: {
      project: { include: { wordpressConnection: true } },
      keyword: true,
    },
  });
  if (!article) throw new AINoDataError(`Article ${articleId}`);

  if (!article.htmlContent) {
    throw new AIPreConditionError("ต้องสร้างบทความ (HTML) ก่อนถึงจะส่งไป WordPress ได้");
  }

  const wp = article.project.wordpressConnection;
  const siteUrl = wp?.siteUrl ?? "https://example.com";
  const kw = article.keyword?.keyword ?? article.title;

  try {
    // 3. Run AI job (generates slug, categories, tags)
    const result = await runAIJob<WordPressOutput>({
      organizationId,
      projectId:  article.projectId,
      articleId,
      jobType:    "WORDPRESS_DRAFT",
      promptType: "WORDPRESS_PUBLISH_PROMPT",
      variables: {
        article_title:    article.title,
        main_keyword:     kw,
        seo_title:        article.seoTitle        ?? article.title,
        meta_description: article.metaDescription ?? "",
        faq_schema:       article.faqSchema        ?? "",
        html_content:     (article.htmlContent ?? "").slice(0, 2000),
        site_url:         siteUrl,
        language:         article.project.language,
        project_name:     article.project.name,
      },
      userId,
      mockFn: () => mockWordPressDraft(article.title, article.slug, siteUrl, kw),
    });

    const output = result.output;

    // 4. Update article with WordPress info + status
    await prisma.article.update({
      where: { id: articleId },
      data: {
        wordpressUrl:    output.wordpressUrl,
        wordpressStatus: output.status,
        status:          "WORDPRESS_DRAFTED",
      },
    });

    // 5. Activity log
    await logActivity(organizationId, userId, "SEND_TO_WORDPRESS", "Article", articleId, {
      wordpressUrl: output.wordpressUrl,
      wordpressId:  output.wordpressId,
      jobId:        result.jobId,
    });

    return { wordpressOutput: output, jobId: result.jobId, isMock: result.isMock };

  } catch (err) {
    await prisma.article.update({
      where: { id: articleId },
      data: { status: "ERROR" },
    }).catch(() => {});
    throw err;
  }
}
