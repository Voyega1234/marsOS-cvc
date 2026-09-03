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

/**
 * ซ่อม JSON ที่ถูกตัดกลางทางเพราะชนเพดาน token — ตัดถึงสมาชิกตัวสุดท้ายที่ปิดครบ
 * แล้วปิดวงเล็บที่ค้างอยู่ ไม่เติมค่าใหม่เอง ใช้เฉพาะข้อมูลที่โมเดลส่งมาจริง
 */
function repairTruncatedJson(raw: string): string | null {
  const stack: string[] = []
  let inString = false
  let escaped = false
  let lastSafe = -1
  let stackAtSafe: string[] = []

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') {
      stack.pop()
      if (stack.length > 0) { lastSafe = i; stackAtSafe = [...stack] }
    }
  }
  if (lastSafe < 0) return null
  return raw.slice(0, lastSafe + 1) + stackAtSafe.reverse().join('')
}

/** ความล้มเหลวระดับการเชื่อมต่อ — ลองใหม่ได้เพราะยังไม่มีการนับโทเคน */
function isTransport(msg: string): boolean {
  return /fetch failed|aborted|timeout|timed out|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|502|503|504/i.test(msg)
}

export async function askJson<T>(params: {
  /** SOP §3: ชื่อฟังก์ชันที่เรียก (บังคับ) — ส่งต่อเป็น generation_name ของ OpenRouter */
  trace: string
  system: string
  user: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}): Promise<AICall<T>> {
  try {
    const res = await orChatWithRetry({
      trace: params.trace,
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
    const body = extractJson(res.text)
    try {
      return { data: JSON.parse(body) as T, usage: res.usage, error: null }
    } catch {
      const repaired = repairTruncatedJson(body)
      if (repaired) {
        try {
          return { data: JSON.parse(repaired) as T, usage: res.usage, error: 'AI ตอบกลับถูกตัดกลางทาง — ใช้เฉพาะส่วนที่อ่านได้' }
        } catch { /* ซ่อมไม่ขึ้น — ตกไปที่ error ด้านล่าง */ }
      }
      return { data: null, usage: res.usage, error: 'AI ตอบกลับไม่ใช่ JSON ที่อ่านได้' }
    }
  } catch (e) {
    const usage = (e as Error & { usage?: ORUsage }).usage ?? ZERO_USAGE
    return { data: null, usage, error: e instanceof Error ? e.message.slice(0, 200) : String(e) }
  }
}

/** เรียก OpenRouter โดยลองซ้ำได้ 1 ครั้งเมื่อสายหลุด/หมดเวลา (ไม่ลองซ้ำกับ error ฝั่งโมเดล) */
async function orChatWithRetry(args: Parameters<typeof orChat>[0]): Promise<Awaited<ReturnType<typeof orChat>>> {
  try {
    return await orChat(args)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!isTransport(msg)) throw e
    return await orChat(args)
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
