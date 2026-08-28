/**
 * OpenRouter — ทางผ่าน AI กลางของทั้งระบบ (key เดียว: OPENROUTER_API_KEY)
 *
 * นโยบาย model (override ได้ทาง env):
 *   เขียนบทความทั้งระบบ  → OPENROUTER_MODEL_WRITER  (default: openai/gpt-5.6-sol)
 *   สร้างรูปทั้งระบบ      → OPENROUTER_MODEL_IMAGE   (default: openai/gpt-5-image — ผู้ใช้เลือกเอง 2026-08-19)
 *   จุดอื่น ๆ ทั้งหมด     → OPENROUTER_MODEL_DEFAULT (default: google/gemini-3.7-flash)
 */

const OR_URL = 'https://openrouter.ai/api/v1/chat/completions'

export const OR_MODELS = {
  writer: () => process.env.OPENROUTER_MODEL_WRITER || 'openai/gpt-5.6-sol',
  image: () => process.env.OPENROUTER_MODEL_IMAGE || 'openai/gpt-5-image',
  default: () => process.env.OPENROUTER_MODEL_DEFAULT || 'google/gemini-3.7-flash',
}

function requireKey(): string {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY is not set — ใส่ key ใน .env.development.local (local) และ Vercel env (prod)')
  return key
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${requireKey()}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://convertcake.com',
    'X-Title': 'MarsOS',
  }
}

export interface ORUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
}

export interface ORChatResult {
  text: string
  usage: ORUsage
  /** ลิงก์อ้างอิงจาก web search (เมื่อเปิด webSearch) */
  citations: Array<{ url: string; title: string }>
}

function parseUsage(u: Record<string, unknown> | undefined): ORUsage {
  const input = Number(u?.prompt_tokens ?? 0)
  const output = Number(u?.completion_tokens ?? 0)
  return { inputTokens: input, outputTokens: output, totalTokens: input + output, costUsd: Number(u?.cost ?? 0) }
}

export async function orChat(params: {
  prompt?: string
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model?: string
  maxTokens?: number
  temperature?: number
  /** เปิด web search plugin (แทน Google Search grounding ของ Gemini เดิม) */
  webSearch?: boolean
  /**
   * บังคับให้โมเดลตอบเป็น JSON object
   * จำเป็นกับ gemini ผ่าน OpenRouter: โหมดปกติจะคืน finish_reason=error /
   * MALFORMED_FUNCTION_CALL พร้อม content ว่าง (output 0 token) เป็นระยะ
   * เปิดโหมดนี้แล้วตอบครบทุกครั้ง — ใช้กับ call ที่ปลายทาง parse JSON เท่านั้น
   */
  jsonMode?: boolean
  timeoutMs?: number
}): Promise<ORChatResult> {
  const messages = params.messages ?? [{ role: 'user' as const, content: params.prompt ?? '' }]
  const body: Record<string, unknown> = {
    model: params.model || OR_MODELS.default(),
    messages,
    usage: { include: true },
  }
  if (params.maxTokens) body.max_tokens = params.maxTokens
  if (typeof params.temperature === 'number') body.temperature = params.temperature
  if (params.webSearch) body.plugins = [{ id: 'web', max_results: 8 }]
  // json_object ใช้ร่วมกับ web plugin ไม่ได้ — gemini จะคืน finish_reason=error content ว่างทุกครั้ง
  // (ทดสอบแล้ว: ws อย่างเดียว = STOP ปกติ, ws+json = error 2/2) จึงยอมถอย jsonMode ให้ web search
  if (params.jsonMode && !params.webSearch) body.response_format = { type: 'json_object' }

  const res = await fetch(OR_URL, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(params.timeoutMs ?? 240_000),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`OpenRouter ${res.status}: ${detail.slice(0, 300)}`)
  }
  const data = await res.json()
  if (data.error) throw new Error(`OpenRouter error: ${JSON.stringify(data.error).slice(0, 300)}`)
  const msg = data.choices?.[0]?.message
  const annotations: Array<{ type?: string; url_citation?: { url?: string; title?: string } }> = msg?.annotations ?? []
  const citations = annotations
    .filter((a) => a.url_citation?.url)
    .map((a) => ({ url: String(a.url_citation!.url), title: String(a.url_citation!.title ?? '') }))
  // บาง provider คืน content เป็น array ของ content part — กันไว้ไม่ให้ .trim() ระเบิดเป็น TypeError
  const text: string = typeof msg?.content === 'string' ? msg.content : ''
  const usage = parseUsage(data.usage)
  // content ว่างเปล่ามีค่าเท่ากับล้มเหลว — โยนออกไปให้ withRetry ยิงใหม่ พร้อมบอกสาเหตุจริง
  // (เคยเงียบ ๆ กลายเป็น "AI response is not JSON:" ทำให้ไล่ต้นตอไม่เจอ)
  if (!text.trim()) {
    const finish = data.choices?.[0]?.finish_reason ?? data.choices?.[0]?.native_finish_reason ?? 'unknown'
    const err = new Error(`OpenRouter ตอบว่าง (finish_reason=${finish}, output_tokens=${usage.outputTokens})`)
    // call ที่ล้มก็ถูกเรียกเก็บเงินค่า input — แนบ usage ไปให้ผู้เรียกบันทึกต้นทุนได้ครบ
    ;(err as Error & { usage?: ORUsage }).usage = usage
    throw err
  }
  return { text, usage, citations }
}

/** stream แบบ SSE — คืน ReadableStream ของ text delta + promise ของ usage ตอนจบ */
export async function orChatStream(params: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model?: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  onDelta: (text: string) => void
}): Promise<{ text: string; usage: ORUsage }> {
  const body: Record<string, unknown> = {
    model: params.model || OR_MODELS.writer(),
    messages: params.messages,
    stream: true,
    usage: { include: true },
  }
  if (params.maxTokens) body.max_tokens = params.maxTokens
  if (typeof params.temperature === 'number') body.temperature = params.temperature

  const res = await fetch(OR_URL, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(params.timeoutMs ?? 600_000),
  })
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`OpenRouter ${res.status}: ${detail.slice(0, 300)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let usage: ORUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (payload === '[DONE]') continue
      try {
        const chunk = JSON.parse(payload)
        // OpenRouter ส่ง error กลางสตรีมมากับ HTTP 200 ได้ — ห้ามกลืน
        if (chunk.error) {
          throw new Error(`OpenRouter stream error: ${JSON.stringify(chunk.error).slice(0, 300)}`)
        }
        const delta: string = chunk.choices?.[0]?.delta?.content ?? ''
        if (delta) { full += delta; params.onDelta(delta) }
        if (chunk.usage) usage = parseUsage(chunk.usage)
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('OpenRouter stream error')) throw e
        /* keep-alive/comment — ข้าม */
      }
    }
  }
  if (!full.trim()) {
    // สตรีมจบแบบไม่มีเนื้อหาเลย — ถือว่าล้มเหลว ไม่ปล่อยค่าว่างไปให้ pipeline ทำต่อ
    throw new Error(`OpenRouter คืนคำตอบว่าง (model: ${String(body.model)}, output tokens: ${usage.outputTokens})`)
  }
  return { text: full, usage }
}

export interface ORImageResult {
  base64: string
  mimeType: string
  usage: ORUsage
}

/** สร้างรูปผ่าน chat completions + modalities image — คืน base64 */
export async function orImage(params: {
  prompt: string
  model?: string
  timeoutMs?: number
  /** สัดส่วนที่โมเดลรองรับ (gpt-5-image: '1:1' | '3:2' | '2:3') — ใกล้เคียงเป้าหมายที่สุด
   *  แล้วค่อย crop ปลายทาง เพื่อลดการตัดตัวหนังสือ/องค์ประกอบ */
  aspectRatio?: '1:1' | '3:2' | '2:3'
}): Promise<ORImageResult> {
  // ใช้ Image API เฉพาะทางของ OpenRouter — chat completions ไม่รับพารามิเตอร์ขนาดภาพ
  const res = await fetch('https://openrouter.ai/api/v1/images', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: params.model || OR_MODELS.image(),
      prompt: params.prompt,
      ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
    }),
    signal: AbortSignal.timeout(params.timeoutMs ?? 300_000),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`OpenRouter image ${res.status}: ${detail.slice(0, 300)}`)
  }
  const data = await res.json()
  if (data.error) throw new Error(`OpenRouter image error: ${JSON.stringify(data.error).slice(0, 300)}`)
  const img: { b64_json?: string; media_type?: string } | undefined = data.data?.[0]
  if (!img?.b64_json) throw new Error(`OpenRouter image: no image returned (${JSON.stringify(data).slice(0, 120)})`)
  return { base64: img.b64_json, mimeType: img.media_type || 'image/png', usage: parseUsage(data.usage) }
}
