import { prisma } from "@/lib/prisma";
import { assertCanRunJob } from "../permissions";
import { AINoDataError, AIPreConditionError } from "../errors";
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

  // เส้นทางเขียนบทความชุดเก่า (ARTICLE_WRITER_PROMPT / writingPrompt / BrandTemplate)
  // ถูกปิดถาวร — กติการะบบ: prompt ต้องมาจาก Content Engine ของโปรเจกต์เท่านั้น
  // และ style ต้องมาจาก Article Lab → ใช้ปุ่มเขียนบทความในแท็บ Article ของ client แทน
  throw new AIPreConditionError(
    "เส้นทางเขียนบทความเก่าถูกปิดแล้ว — เขียนบทความผ่านแท็บ Article ของ client (ใช้ Content Engine + Article Lab จาก Project Settings)"
  );
}
