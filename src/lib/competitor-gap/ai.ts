/**
 * Competitor Gap — ทางผ่าน AI (OpenRouter เท่านั้น ตามนโยบายระบบ)
 * ทุกครั้งที่เรียกจะคืน usage จริงของ OpenRouter เพื่อบันทึกต้นทุนแบบไม่ประมาณเอง
 */

import { OR_MODELS, orChat, type ORUsage } from '@/lib/openrouter'

export interface AICall<T> {
  data: T | null
  usage: ORUsage
  error: string | null
}

const ZERO_USAGE: ORUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 }

function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const body = fenced ? fenced[1] : text
  const start = body.search(/[[{]/)
  if (start < 0) return body.trim()
  const opener = body[start]
  const closer = opener === '{' ? '}' : ']'
  const end = body.lastIndexOf(closer)
  return end > start ? body.slice(start, end + 1) : body.slice(start)
}

export async function askJson<T>(params: {
  system: string
  user: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}): Promise<AICall<T>> {
  try {
    const res = await orChat({
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
      model: OR_MODELS.default(),
      maxTokens: params.maxTokens ?? 4000,
      temperature: params.temperature ?? 0.2,
      jsonMode: true,
      timeoutMs: params.timeoutMs ?? 120_000,
    })
    try {
      return { data: JSON.parse(extractJson(res.text)) as T, usage: res.usage, error: null }
    } catch {
      return { data: null, usage: res.usage, error: 'AI ตอบกลับไม่ใช่ JSON ที่อ่านได้' }
    }
  } catch (e) {
    const usage = (e as Error & { usage?: ORUsage }).usage ?? ZERO_USAGE
    return { data: null, usage, error: e instanceof Error ? e.message.slice(0, 200) : String(e) }
  }
}

export function emptyUsage(): ORUsage {
  return { ...ZERO_USAGE }
}

export function addUsage(a: ORUsage, b: ORUsage): ORUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    costUsd: a.costUsd + b.costUsd,
  }
}
