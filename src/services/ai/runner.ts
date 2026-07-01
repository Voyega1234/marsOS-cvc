/**
 * Generic AI job runner.
 * Handles the full AIJob lifecycle: PENDING → RUNNING → SUCCESS | FAILED.
 * Every service calls this instead of touching Prisma or the AI provider directly.
 */

import { prisma } from "@/lib/prisma";
import { compilePrompt } from "./compiler";
import { callAIProvider } from "./provider";
import { AINoPromptError, AIProviderError } from "./errors";
import { autoAssignArticle, checkCostAlert, notifyAIJobDone } from "@/services/notify";
import type { RunAIJobOptions, AIJobResult } from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function tryParseJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return raw; }
}

function safeStringify(value: unknown, maxLen = 8000): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.slice(0, maxLen);
}

// ── Active prompt loader ──────────────────────────────────────────────────────

export async function loadActivePrompt(organizationId: string, promptType: string) {
  const prompt = await prisma.promptTemplate.findFirst({
    where: { organizationId, type: promptType, isActive: true },
    orderBy: { version: "desc" },
  });
  if (!prompt) throw new AINoPromptError(promptType);
  return prompt;
}

// ── Activity log helper ───────────────────────────────────────────────────────

export async function logActivity(
  organizationId: string,
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  extra?: object
) {
  await prisma.activityLog.create({
    data: {
      organizationId,
      userId,
      action,
      entityType,
      entityId,
      newValue: extra ? JSON.stringify(extra) : undefined,
    },
  });
}

// ── Article version snapshot ──────────────────────────────────────────────────

export async function snapshotArticleVersion(articleId: string, userId: string, changeNote: string) {
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) return;
  // Only snapshot if there is meaningful content to preserve
  if (!article.outline && !article.htmlContent) return;

  const count = await prisma.articleVersion.count({ where: { articleId } });
  await prisma.articleVersion.create({
    data: {
      articleId,
      versionNumber: count + 1,
      title: article.title,
      outline: article.outline,
      htmlContent: article.htmlContent,
      seoTitle: article.seoTitle,
      metaDescription: article.metaDescription,
      faqSchema: article.faqSchema,
      changedById: userId,
      changeNote,
    },
  });
}

// ── The generic runner ────────────────────────────────────────────────────────

export async function runAIJob<T = unknown>(opts: RunAIJobOptions): Promise<AIJobResult<T>> {
  const { organizationId, projectId, articleId, jobType, promptType, variables, userId, mockFn } = opts;

  // 1. Load active prompt (throws AINoPromptError if missing)
  const prompt = await loadActivePrompt(organizationId, promptType);

  // 2. Compile the prompt text
  const compiled = compilePrompt(prompt.promptText, variables);

  // 3. Create AIJob as PENDING
  const job = await prisma.aIJob.create({
    data: {
      organizationId,
      projectId:    projectId ?? null,
      articleId:    articleId ?? null,
      jobType,
      status:       "PENDING",
      modelProvider: prompt.modelProvider,
      modelName:    prompt.modelName,
      input:        compiled.slice(0, 3000),
      createdById:  userId,
    },
  });

  // 4. Mark RUNNING
  await prisma.aIJob.update({ where: { id: job.id }, data: { status: "RUNNING" } });

  try {
    // 5. Call AI provider (mock or real)
    const aiResult = await callAIProvider({
      provider:    prompt.modelProvider as "CLAUDE" | "OPENAI" | "GEMINI" | "CUSTOM",
      model:       prompt.modelName,
      prompt:      compiled,
      temperature: prompt.temperature,
      maxTokens:   prompt.maxTokens,
    });

    const isMock = aiResult.content === "__MOCK__";

    // 6. Parse or generate output
    const rawOutput = isMock ? mockFn(compiled) : tryParseJson(aiResult.content);
    const output = rawOutput as T;

    // 7. Update job to SUCCESS
    await prisma.aIJob.update({
      where: { id: job.id },
      data: {
        status:        "SUCCESS",
        output:        safeStringify(rawOutput),
        tokenUsed:     aiResult.tokensUsed,
        estimatedCost: aiResult.estimatedCost,
      },
    });

    // 8. Post-job hooks — notify, auto-assign, cost alert (non-blocking)
    notifyAIJobDone({ jobId: job.id, jobType, articleId: articleId ?? null, organizationId, userId }).catch(() => {});
    if (articleId) {
      autoAssignArticle(articleId, organizationId).catch(() => {});
    }
    if (projectId) {
      checkCostAlert(organizationId, projectId).catch(() => {});
    }

    return {
      jobId:         job.id,
      output,
      tokensUsed:    aiResult.tokensUsed,
      estimatedCost: aiResult.estimatedCost,
      isMock,
    };

  } catch (err) {
    // 8. Update job to FAILED
    const errorMessage = err instanceof Error ? err.message : String(err);
    await prisma.aIJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMessage: errorMessage.slice(0, 500) },
    }).catch(() => { /* don't mask original error */ });

    // Notify requester of failure (non-blocking)
    notifyAIJobDone({ jobId: job.id, jobType, articleId: articleId ?? null, organizationId, userId, failed: true, errorMessage }).catch(() => {});

    // Re-wrap as AIProviderError so the service layer knows the jobId
    throw new AIProviderError(errorMessage, job.id);
  }
}
