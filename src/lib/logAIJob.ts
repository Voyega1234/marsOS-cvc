/**
 * logAIJob — lightweight helper to record any AI/API call into the AIJob table.
 * Used by routes that call Gemini, DataForSEO, or other external services
 * directly (not via the full runAIJob pipeline).
 */
import { prisma } from '@/lib/prisma'

export interface LogAIJobInput {
  organizationId: string
  projectId?: string | null
  articleId?: string | null
  jobType: string
  modelProvider: string
  modelName: string
  status: 'SUCCESS' | 'FAILED'
  tokenUsed?: number
  estimatedCost?: number
  externalCost?: number
  externalCalls?: number
  externalApi?: string
  errorMessage?: string
  createdById: string
  inputSummary?: string
}

// Gemini 3.5 Flash pricing (USD per token, as of 2025)
// Input: $0.075/1M tokens, Output: $0.30/1M tokens — blended ~$0.15/1M
const GEMINI_FLASH_COST_PER_TOKEN = 0.00000015

// DataForSEO Google Ads search volume: ~$0.003 per keyword
export const DFS_COST_PER_KEYWORD = 0.003

export function estimateGeminiCost(tokens: number): number {
  return tokens * GEMINI_FLASH_COST_PER_TOKEN
}

export async function logAIJob(input: LogAIJobInput): Promise<void> {
  try {
    await prisma.aIJob.create({
      data: {
        organizationId: input.organizationId,
        projectId:      input.projectId ?? null,
        articleId:      input.articleId ?? null,
        jobType:        input.jobType,
        status:         input.status,
        modelProvider:  input.modelProvider,
        modelName:      input.modelName,
        tokenUsed:      input.tokenUsed ?? null,
        estimatedCost:  input.estimatedCost ?? null,
        externalCost:   input.externalCost ?? 0,
        externalCalls:  input.externalCalls ?? 0,
        externalApi:    input.externalApi ?? null,
        errorMessage:   input.errorMessage?.slice(0, 500) ?? null,
        createdById:    input.createdById,
        input:          input.inputSummary?.slice(0, 3000) ?? null,
      },
    })
  } catch (err) {
    // non-fatal — never let logging break the main flow
    console.error('[logAIJob] failed to write AIJob:', err)
  }
}

/**
 * startAIJob — create the cost row up front with status RUNNING and return its id (null on error, never throws).
 * Pair with updateAIJob so a run killed by the platform still leaves a row with the cost spent so far.
 */
export async function startAIJob(input: Omit<LogAIJobInput, 'status'>): Promise<string | null> {
  try {
    const row = await prisma.aIJob.create({
      data: {
        organizationId: input.organizationId,
        projectId:      input.projectId ?? null,
        articleId:      input.articleId ?? null,
        jobType:        input.jobType,
        status:         'RUNNING',
        modelProvider:  input.modelProvider,
        modelName:      input.modelName,
        tokenUsed:      input.tokenUsed ?? null,
        estimatedCost:  input.estimatedCost ?? null,
        externalCost:   input.externalCost ?? 0,
        externalCalls:  input.externalCalls ?? 0,
        externalApi:    input.externalApi ?? null,
        errorMessage:   input.errorMessage?.slice(0, 500) ?? null,
        createdById:    input.createdById,
        input:          input.inputSummary?.slice(0, 3000) ?? null,
      },
      select: { id: true },
    })
    return row.id
  } catch (err) {
    console.error('[startAIJob] failed to write AIJob:', err)
    return null
  }
}

export interface AIJobPatch {
  status?: 'RUNNING' | 'SUCCESS' | 'FAILED'
  tokenUsed?: number
  estimatedCost?: number
  externalCost?: number
  errorMessage?: string
}

/** updateAIJob — patch a row created by startAIJob. Never throws. */
export async function updateAIJob(id: string, patch: AIJobPatch): Promise<void> {
  try {
    await prisma.aIJob.update({
      where: { id },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.tokenUsed !== undefined ? { tokenUsed: patch.tokenUsed } : {}),
        ...(patch.estimatedCost !== undefined ? { estimatedCost: patch.estimatedCost } : {}),
        ...(patch.externalCost !== undefined ? { externalCost: patch.externalCost } : {}),
        ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage.slice(0, 500) } : {}),
      },
    })
  } catch (err) {
    console.error('[updateAIJob] failed to update AIJob:', err)
  }
}

/**
 * Ordered update queue: patches are written one at a time, in the order queued, without the caller awaiting
 * them on the hot path. `flush()` resolves once everything queued so far has been written. Never rejects.
 */
export function createAIJobUpdateQueue(write: (patch: AIJobPatch) => Promise<void>) {
  let chain: Promise<void> = Promise.resolve()
  return {
    push(patch: AIJobPatch): void {
      chain = chain.then(() => write(patch)).catch(() => {})
    },
    flush(): Promise<void> {
      return chain
    },
  }
}
