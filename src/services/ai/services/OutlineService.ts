import { prisma } from "@/lib/prisma";
import { runAIJob, logActivity, snapshotArticleVersion } from "../runner";
import { assertCanRunJob } from "../permissions";
import { mockOutline } from "../mock";
import { AINoDataError } from "../errors";
import { safeJson } from "@/lib/utils";
import { humanTitleSkillBlock } from "@/lib/article-human-voice-skill";
import { cleanGeneratedFields, cleanPlainText, keywordWarnings, tallyWarning } from "@/lib/ce-restrictions";
import { loadTitleRestrictions } from "@/lib/ce-restrictions-server";
import type { ArticleJobInput, OutlineOutput } from "../types";

export async function runOutline(input: ArticleJobInput) {
  const { organizationId, articleId, userId, userRole } = input;

  // 1. Permission check
  assertCanRunJob(userRole, "OUTLINE");

  // 2. Load article with related data
  const article = await prisma.article.findFirst({
    where: { id: articleId, project: { organizationId } },
    include: {
      project: { include: { defaultTemplate: true } },
      keyword: true,
    },
  });
  if (!article) throw new AINoDataError(`Article ${articleId}`);

  const kw = article.keyword?.keyword ?? article.title;
  const related = safeJson<string[]>(article.keyword?.relatedKeywords, []);

  // 3. Set status → OUTLINE_GENERATING
  await prisma.article.update({
    where: { id: articleId },
    data: { status: "OUTLINE_GENERATING" },
  });

  try {
    // ข้อจำกัดคำต้องห้ามของ Content Engine โปรเจกต์นี้ (ไม่มี/โหลดพัง = ไม่มีข้อจำกัด ไม่ทำให้งานล้ม)
    const tr = await loadTitleRestrictions(organizationId, { projectId: article.projectId });
    const restrictionTally = new Map<string, number>();

    // 4. Run AI job
    const result = await runAIJob<OutlineOutput>({
      organizationId,
      projectId:  article.projectId,
      articleId,
      jobType:    "OUTLINE",
      promptType: "OUTLINE_PROMPT",
      variables: {
        article_title:    article.title,
        main_keyword:     kw,
        related_keywords: related.join(", "),
        funnel_stage:     article.funnelStage,
        search_intent:    article.searchIntent,
        brand_voice:      article.project.defaultTemplate?.brandVoice ?? "ภาษาทางการ น่าเชื่อถือ เชี่ยวชาญ",
        language:         article.project.language,
        project_name:     article.project.name,
        // Data sources context injected when available
        competitor_urls:  (() => {
          try {
            const urls = JSON.parse((article as { competitorUrls?: string | null }).competitorUrls ?? "[]");
            return Array.isArray(urls) && urls.length ? `คู่แข่งที่ควรเขียนดีกว่า:\n${urls.map((u: string, i: number) => `${i+1}. ${u}`).join("\n")}` : "";
          } catch { return ""; }
        })(),
        data_brain_context: (article as { dataBrainContext?: string | null }).dataBrainContext ?? "",
        gsc_context:        (() => {
          try {
            const h = JSON.parse((article as { rankHistory?: string | null }).rankHistory ?? "[]");
            if (!Array.isArray(h) || !h.length) return "";
            const latest = h[h.length - 1];
            return `GSC data: position ${latest.position ?? "?"}, clicks ${latest.clicks ?? 0}/month`;
          } catch { return ""; }
        })(),
      },
      userId,
      mockFn: () => mockOutline(article.title, kw),
      // Mars Human Voice Skill — ให้ seoTitle อ่านเป็นภาษาคน (เจ้าของสั่ง 2026-09-28)
      appendPrompt: [humanTitleSkillBlock('th'), tr.block].filter(Boolean).join("\n\n"),
    });

    const output = result.output;

    // outline ถูกเก็บและใช้เป็นโครงให้ตัวเขียน — แทนคำต้องห้ามใน seoTitle/meta และหัวข้อทั้งหมด ก่อนบันทึก
    const cleanText = (s: string): string => {
      if (typeof s !== "string" || !s) return s;
      const r = cleanPlainText(s, tr.terms);
      for (const h of r.remaining) restrictionTally.set(h.term, (restrictionTally.get(h.term) ?? 0) + h.count);
      return r.text;
    };
    const cleanedMeta = cleanGeneratedFields(
      tr,
      { title: output.seoTitle, metaDescription: output.metaDescription },
      restrictionTally,
    );
    if (tr.terms.length) {
      output.title = cleanText(output.title);
      output.seoTitle = cleanedMeta.title ?? output.seoTitle;
      output.metaDescription = cleanedMeta.metaDescription ?? output.metaDescription;
      for (const s of output.sections ?? []) {
        s.h2 = cleanText(s.h2);
        if (Array.isArray(s.h3s)) s.h3s = s.h3s.map(cleanText);
        if (Array.isArray(s.keyPoints)) s.keyPoints = s.keyPoints.map(cleanText);
      }
      for (const f of output.faqItems ?? []) {
        f.question = cleanText(f.question);
        f.answer = cleanText(f.answer);
      }
    }

    // 5. Snapshot existing content before overwriting
    await snapshotArticleVersion(articleId, userId, "Before regenerating outline");

    // 6. Save outline + update status
    await prisma.article.update({
      where: { id: articleId },
      data: {
        outline:         JSON.stringify(output),
        seoTitle:        output.seoTitle,
        metaDescription: output.metaDescription,
        status:          "OUTLINE_DONE",
      },
    });

    // 7. Activity log
    await logActivity(organizationId, userId, "GENERATE_OUTLINE", "Article", articleId, {
      sections: output.sections.length,
      estimatedWords: output.estimatedWordCount,
      jobId: result.jobId,
    });

    const leftover = tallyWarning("คำต้องห้ามที่ยังเหลือใน outline/SEO title/meta", restrictionTally);
    const restrictionWarnings: string[] = [...(leftover ? [leftover] : []), ...keywordWarnings(kw, tr.terms)];

    return { outline: output, jobId: result.jobId, isMock: result.isMock, restrictionWarnings };

  } catch (err) {
    // Roll back status to ERROR on failure
    await prisma.article.update({
      where: { id: articleId },
      data: { status: "ERROR" },
    }).catch(() => {});
    throw err;
  }
}
