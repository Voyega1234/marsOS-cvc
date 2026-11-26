// Pure helpers for cost bookkeeping: read, sum and attach OpenRouter usage so that money spent
// on failed or retried calls is not lost. Never throws.
import type { ORUsage } from '@/lib/openrouter'

export function emptyUsage(): ORUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 }
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Read the `usage` that orChat/orResponses attach to the error they throw; null when absent. */
export function usageOfError(err: unknown): ORUsage | null {
  if (!err || typeof err !== 'object') return null
  const u = (err as { usage?: unknown }).usage
  if (!u || typeof u !== 'object') return null
  const r = u as Record<string, unknown>
  const input = num(r.inputTokens)
  const output = num(r.outputTokens)
  const total = num(r.totalTokens) || input + output
  const cost = num(r.costUsd)
  if (!total && !cost) return null
  return { inputTokens: input, outputTokens: output, totalTokens: total, costUsd: cost }
}

/** Sum any number of usages (null/undefined are skipped). */
export function sumUsage(...items: Array<Partial<ORUsage> | null | undefined>): ORUsage {
  const out = emptyUsage()
  for (const u of items) {
    if (!u) continue
    out.inputTokens += num(u.inputTokens)
    out.outputTokens += num(u.outputTokens)
    out.totalTokens += num(u.totalTokens)
    out.costUsd += num(u.costUsd)
  }
  out.costUsd = Number(out.costUsd.toFixed(6))
  return out
}

/** Attach usage to an error (same object, message unchanged), merging with usage already on it. */
export function attachUsage<E>(err: E, usage: ORUsage): E {
  if (err && typeof err === 'object') {
    try {
      ;(err as { usage?: ORUsage }).usage = sumUsage(usageOfError(err), usage)
    } catch { /* frozen error object — ignore */ }
  }
  return err
}
