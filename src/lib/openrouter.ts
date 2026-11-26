/**
 * OpenRouter — ทางผ่าน AI กลางของทั้งระบบ (key เดียว: OPENROUTER_API_KEY)
 *
 * นโยบาย model (override ได้ทาง env):
 *   เขียนบทความทั้งระบบ  → OPENROUTER_MODEL_WRITER  (default: openai/gpt-5.6-sol)
 *   keyword research     → OPENROUTER_MODEL_KEYWORD (default: openai/gpt-5.6-sol — คำสั่งเจ้าของ 2026-09-15)
 *   สร้างรูปทั้งระบบ      → ล็อกตายที่ IMAGE_MODEL_LOCKED (ไม่รับ env override — คำสั่งเจ้าของ 2026-09-15)
 *   จุดอื่น ๆ ทั้งหมด     → OPENROUTER_MODEL_DEFAULT (default: google/gemini-3.7-flash)
 */

import { currentOrClient, OR_CLIENT_SYSTEM } from '@/lib/orClient'

const OR_URL = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * โมเดลสร้างรูป — ล็อกตัวเดียว ห้ามใช้โมเดลอื่น (คำสั่งเจ้าของ 2026-09-15: "GPT-5.5 Instant image เท่านั้น")
 * ในแอป ChatGPT ตัวเลือก "5.5 Instant" เป็นโมเดลแชท ส่วนภาพที่มันวาดมาจาก ChatGPT Images 2.5
 * (ออก 2026-09-08) ซึ่งบน API/OpenRouter คือ gpt-image-2.5 สองรุ่น: flare (ค่าเริ่มต้นของแอป ChatGPT,
 * เร็วกว่า) กับ sunburst (ละเอียดกว่า ช้ากว่า) — เลือก flare ให้ตรงกับที่แอปใช้
 * ตั้งใจไม่อ่าน OPENROUTER_MODEL_IMAGE จาก env เพื่อกันค่าเก่า (gpt-5-image) บน Vercel ทับล็อกนี้
 * writer/default ไม่เกี่ยว — ยังใช้โมเดลเดิมทุกจุด
 */
export const IMAGE_MODEL_LOCKED = 'openai/gpt-image-2.5-flare'

export const OR_MODELS = {
  writer: () => process.env.OPENROUTER_MODEL_WRITER || 'openai/gpt-5.6-sol',
  /** keyword research ทั้ง online/local (ทุก call ผ่าน src/lib/wordgod/gemini.ts) — แยกจาก default ตามคำสั่งเจ้าของ */
  keyword: () => process.env.OPENROUTER_MODEL_KEYWORD || 'openai/gpt-5.6-sol',
  image: () => IMAGE_MODEL_LOCKED,
  default: () => process.env.OPENROUTER_MODEL_DEFAULT || 'google/gemini-3.7-flash',
  /**
   * Upload Article > Translate (แปล + ตรวจคำแปล) — คำสั่งเจ้าของ 2026-11-26: ใช้ Gemini รุ่นล่าสุดเป็นค่าเริ่มต้น
   * gemini-4-neon คือ Gemini ตัวใหม่สุดในรายการของ OpenRouter ณ วันนั้น ($3 / $15 ต่อ 1M tokens)
   * เปลี่ยนรายโปรเจกต์ได้ที่ Content Engine > AI Model
   */
  translate: () => process.env.OPENROUTER_MODEL_TRANSLATE || 'google/gemini-4-neon',
}

/**
 * SOP §3 "Label Function usage" — ทุก request ที่ยิงออก OpenRouter ต้องติดป้ายกำกับ
 *   generation_name  = ชื่อฟังก์ชันที่เรียก (ขึ้นต้น marsos_ เสมอ) ใช้แยกต้นทุนรายฟีเจอร์
 *   environment      = 'production' เฉพาะตอนรันบน Vercel production เท่านั้น นอกนั้น 'develop'
 * ทำให้ dashboard แยกยอดของ prod กับของที่ทีมกดทดสอบเองออกจากกันได้
 */
export type ORTraceEnvironment = 'production' | 'develop'

export interface ORTrace {
  generation_name: string
  environment: ORTraceEnvironment
}

/** prefix ประจำระบบนี้ — ระบบอื่นของทีมใช้ prefix ของตัวเอง (เช่น mercy_) ห้ามปนกัน */
export const OR_TRACE_PREFIX = 'mars'

export function orEnvironment(): ORTraceEnvironment {
  return process.env.VERCEL_ENV === 'production' ? 'production' : 'develop'
}

function snake(v: string): string {
  return v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/**
 * ชื่อ generation ตามรูปแบบที่ตกลงไว้: mars_<client>_<action>
 * client ไม่ส่งมา = อ่านจากบริบท request ปัจจุบัน (orClient) ไม่มีบริบท = 'system'
 */
export function traceName(action: string, client?: string): string {
  const c = snake(client ?? currentOrClient()) || OR_CLIENT_SYSTEM
  const a = snake(action) || 'unlabeled'
  return `${OR_TRACE_PREFIX}_${c}_${a}`
}

export function orTrace(action: string, client?: string): ORTrace {
  return { generation_name: traceName(action, client), environment: orEnvironment() }
}

/**
 * ฟิลด์ป้ายกำกับที่ OpenRouter "เก็บจริง"
 *
 * ตรวจกับ API แล้ว (2026-09-03): ยิง trace + metadata + user + session_id พร้อมกัน
 * แล้วอ่าน GET /api/v1/generation กลับมา — trace กับ metadata หายเกลี้ยง ไม่มีในเรคอร์ด
 * เหลือแค่ user (โผล่เป็น external_user) และ session_id เท่านั้นที่ค้นย้อนหลังได้
 * จึงต้องส่งชื่อ generation ลงช่อง user และเอา environment ไปไว้ที่ session_id
 * ส่วน trace ยังส่งต่อไปตาม SOP เผื่อวันหนึ่ง OpenRouter รองรับ (ส่งเกินไม่เสียหาย)
 */
function labelFields(action: string, client?: string): Record<string, unknown> {
  return {
    trace: orTrace(action, client),
    user: traceName(action, client),
    session_id: orEnvironment(),
  }
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

/**
 * SOP §4 "Request Protection" — กันยิงถล่ม OpenRouter จาก instance เดียว
 *   OPENROUTER_MAX_CONCURRENCY  จำนวน request พร้อมกันสูงสุดต่อ instance (default 12)
 *   OPENROUTER_MIN_INTERVAL_MS  เว้นระยะระหว่างการยิงแต่ละครั้ง (default 0 = ปิด)
 * ตัว stream ถือ slot ไว้จนอ่านจบ เพราะสายยังเปิดค้างและนับเป็น request ที่ปลายทางจริง
 * (timeout อยู่ที่ params.timeoutMs ของแต่ละฟังก์ชัน, retry เป็นหน้าที่ของผู้เรียก)
 */
const MAX_CONCURRENCY = Math.max(1, Number(process.env.OPENROUTER_MAX_CONCURRENCY ?? 12) || 12)
const MIN_INTERVAL_MS = Math.max(0, Number(process.env.OPENROUTER_MIN_INTERVAL_MS ?? 0) || 0)

let inFlight = 0
let lastStart = 0
const waiting: Array<() => void> = []

function releaseSlot(): void {
  inFlight--
  const next = waiting.shift()
  if (next) next()
}

async function acquireSlot(): Promise<void> {
  if (inFlight >= MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  inFlight++
  if (MIN_INTERVAL_MS > 0) {
    const wait = lastStart + MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastStart = Date.now()
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
  citations: Array<{ url: string; title: string; content?: string }>
}

function parseUsage(u: Record<string, unknown> | undefined): ORUsage {
  const input = Number(u?.prompt_tokens ?? 0)
  const output = Number(u?.completion_tokens ?? 0)
  return { inputTokens: input, outputTokens: output, totalTokens: input + output, costUsd: Number(u?.cost ?? 0) }
}

/** content แบบ multimodal (ข้อความ + ภาพ + ไฟล์ PDF) ตามรูปแบบ chat completions ของ OpenRouter */
export type ORContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  /** ไฟล์ PDF: file_data เป็น data URL (data:application/pdf;base64,...) */
  | { type: 'file'; file: { filename: string; file_data: string } }

export async function orChat(params: {
  /** SOP §3: action ที่กำลังทำ เช่น 'article_review' — ได้ชื่อจริงเป็น mars_<client>_<action> (บังคับ) */
  trace: string
  /** ลูกค้าเจ้าของงาน — ไม่ส่ง = อ่านจากบริบท request (withOrClient) */
  client?: string
  prompt?: string
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string | ORContentPart[] }>
  model?: string
  maxTokens?: number
  temperature?: number
  /** เปิด web search plugin (แทน Google Search grounding ของ Gemini เดิม) */
  webSearch?: boolean
  /** ใช้คู่กับ webSearch: จำกัดโดเมน/จำนวนผล ไม่ส่ง = ค่าเดิม */
  webSearchOptions?: { engine?: 'exa'; maxResults?: number; includeDomains?: string[] }
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
    ...labelFields(params.trace, params.client),
  }
  if (params.maxTokens) body.max_tokens = params.maxTokens
  if (typeof params.temperature === 'number') body.temperature = params.temperature
  if (params.webSearch) {
    const o = params.webSearchOptions
    body.plugins = [{
      id: 'web',
      ...(o?.engine ? { engine: o.engine } : {}),
      max_results: o?.maxResults ?? 8,
      ...(o?.includeDomains?.length ? { include_domains: o.includeDomains } : {}),
    }]
  }
  // json_object ใช้ร่วมกับ web plugin ไม่ได้ — gemini จะคืน finish_reason=error content ว่างทุกครั้ง
  // (ทดสอบแล้ว: ws อย่างเดียว = STOP ปกติ, ws+json = error 2/2) จึงยอมถอย jsonMode ให้ web search
  if (params.jsonMode && !params.webSearch) body.response_format = { type: 'json_object' }

  await acquireSlot()
  let res: Response
  try {
    res = await fetch(OR_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(params.timeoutMs ?? 240_000),
    })
  } finally {
    releaseSlot()
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`OpenRouter ${res.status}: ${detail.slice(0, 300)}`)
  }
  const data = await res.json()
  if (data.error) throw new Error(`OpenRouter error: ${JSON.stringify(data.error).slice(0, 300)}`)
  const msg = data.choices?.[0]?.message
  const annotations: Array<{ type?: string; url_citation?: { url?: string; title?: string; content?: string } }> = msg?.annotations ?? []
  const citations = annotations
    .filter((a) => a.url_citation?.url)
    .map((a) => ({
      url: String(a.url_citation!.url),
      title: String(a.url_citation!.title ?? ''),
      ...(typeof a.url_citation!.content === 'string' ? { content: a.url_citation!.content } : {}),
    }))
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

const OR_RESPONSES_URL = 'https://openrouter.ai/api/v1/responses'

export interface ORResponsesResult extends ORChatResult {
  /** what the model typed into its web search, in order, de-duplicated */
  searchQueries: string[]
  /** true when the answer stopped at the output-token cap */
  truncated: boolean
}

/** Cleaned, de-duplicated search queries from the `output[]` items of a Responses API reply */
export function extractSearchQueries(output: unknown, max = 20, maxLen = 300): string[] {
  if (!Array.isArray(output)) return []
  const out: string[] = []
  const seen = new Set<string>()
  const add = (v: unknown) => {
    if (typeof v !== 'string') return
    const q = v.replace(/\s+/g, ' ').trim().slice(0, maxLen)
    if (!q) return
    const k = q.toLowerCase()
    if (seen.has(k) || out.length >= max) return
    seen.add(k)
    out.push(q)
  }
  for (const item of output) {
    const action = (item as { action?: { type?: unknown; query?: unknown; queries?: unknown } } | null)?.action
    if (!action || action.type !== 'search') continue
    // OpenAI sends `queries: string[]` (and repeats the first one in `query`); Anthropic sends `query` only
    if (Array.isArray(action.queries) && action.queries.length) action.queries.forEach(add)
    else add(action.query)
  }
  return out
}

/**
 * OpenRouter Responses API (`/api/v1/responses`) with the web plugin.
 * Same labels, slot limit and error style as orChat. Used where the caller needs the search queries the model ran:
 * chat completions only return a count, the Responses API returns each `web_search_call` (checked 2026-11-18:
 * OpenAI and Anthropic models return them; Gemini and DeepSeek do not).
 */
export async function orResponses(params: {
  /** action name, becomes mars_<client>_<action> */
  trace: string
  client?: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model: string
  maxOutputTokens?: number
  /** web plugin results per search; omit to call without web search */
  webMaxResults?: number
  timeoutMs?: number
}): Promise<ORResponsesResult> {
  const body: Record<string, unknown> = {
    model: params.model,
    input: params.messages,
    ...labelFields(params.trace, params.client),
  }
  if (params.maxOutputTokens) body.max_output_tokens = params.maxOutputTokens
  if (params.webMaxResults) body.plugins = [{ id: 'web', max_results: params.webMaxResults }]

  await acquireSlot()
  let res: Response
  try {
    res = await fetch(OR_RESPONSES_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(params.timeoutMs ?? 240_000),
    })
  } finally {
    releaseSlot()
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const err = new Error(`OpenRouter ${res.status}: ${detail.slice(0, 300)}`)
    ;(err as Error & { httpStatus?: number }).httpStatus = res.status
    throw err
  }
  const data = await res.json()
  if (data.error) throw new Error(`OpenRouter error: ${JSON.stringify(data.error).slice(0, 300)}`)

  const output: unknown[] = Array.isArray(data.output) ? data.output : []
  let text = ''
  const citations: ORChatResult['citations'] = []
  const seenUrl = new Set<string>()
  for (const item of output) {
    const it = item as { type?: string; content?: unknown }
    if (it?.type !== 'message' || !Array.isArray(it.content)) continue
    for (const part of it.content as Array<{ type?: string; text?: unknown; annotations?: unknown }>) {
      if (part?.type !== 'output_text') continue
      if (typeof part.text === 'string') text += part.text
      if (!Array.isArray(part.annotations)) continue
      for (const a of part.annotations as Array<{ type?: string; url?: unknown; title?: unknown; content?: unknown }>) {
        if (a?.type !== 'url_citation' || typeof a.url !== 'string' || !a.url || seenUrl.has(a.url)) continue
        seenUrl.add(a.url)
        citations.push({
          url: a.url,
          title: typeof a.title === 'string' ? a.title : '',
          ...(typeof a.content === 'string' ? { content: a.content } : {}),
        })
      }
    }
  }
  const u = (data.usage ?? {}) as Record<string, unknown>
  const input = Number(u.input_tokens ?? 0)
  const outTok = Number(u.output_tokens ?? 0)
  const usage: ORUsage = { inputTokens: input, outputTokens: outTok, totalTokens: input + outTok, costUsd: Number(u.cost ?? 0) }
  if (!text.trim()) {
    const reason = data.incomplete_details?.reason ?? data.status ?? 'unknown'
    const err = new Error(`OpenRouter ตอบว่าง (status=${reason}, output_tokens=${usage.outputTokens})`)
    // a failed call is still billed for its input: hand the usage to the caller
    ;(err as Error & { usage?: ORUsage }).usage = usage
    throw err
  }
  return { text, usage, citations, searchQueries: extractSearchQueries(output), truncated: data.status === 'incomplete' }
}

/** stream แบบ SSE — คืน ReadableStream ของ text delta + promise ของ usage ตอนจบ */
export async function orChatStream(params: {
  /** SOP §3: action ที่กำลังทำ — ได้ชื่อจริงเป็น mars_<client>_<action> (บังคับ) */
  trace: string
  /** ลูกค้าเจ้าของงาน — ไม่ส่ง = อ่านจากบริบท request (withOrClient) */
  client?: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model?: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  onDelta: (text: string) => void
}): Promise<{ text: string; usage: ORUsage; finishReason: string }> {
  const body: Record<string, unknown> = {
    model: params.model || OR_MODELS.writer(),
    messages: params.messages,
    stream: true,
    usage: { include: true },
    ...labelFields(params.trace, params.client),
  }
  if (params.maxTokens) body.max_tokens = params.maxTokens
  if (typeof params.temperature === 'number') body.temperature = params.temperature

  await acquireSlot()
  let res: Response
  try {
    res = await fetch(OR_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(params.timeoutMs ?? 600_000),
    })
  } catch (e) {
    releaseSlot()
    throw e
  }
  if (!res.ok || !res.body) {
    releaseSlot()
    const detail = await res.text().catch(() => '')
    throw new Error(`OpenRouter ${res.status}: ${detail.slice(0, 300)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let usage: ORUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 }
  // เหตุที่สตรีมจบ — 'length' = ชน max_tokens (เนื้อหาถูกตัดกลางทาง) ให้ผู้เรียกเขียนต่อเองได้
  let finishReason = ''
  try {
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
        const finish = chunk.choices?.[0]?.finish_reason
        if (typeof finish === 'string' && finish) finishReason = finish
        if (chunk.usage) usage = parseUsage(chunk.usage)
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('OpenRouter stream error')) throw e
        /* keep-alive/comment — ข้าม */
      }
    }
  }
  } finally {
    releaseSlot()
  }
  if (!full.trim()) {
    // สตรีมจบแบบไม่มีเนื้อหาเลย — ถือว่าล้มเหลว ไม่ปล่อยค่าว่างไปให้ pipeline ทำต่อ
    throw new Error(`OpenRouter คืนคำตอบว่าง (model: ${String(body.model)}, output tokens: ${usage.outputTokens})`)
  }
  return { text: full, usage, finishReason }
}

export interface ORImageResult {
  base64: string
  mimeType: string
  usage: ORUsage
}

/**
 * ยิง POST /api/v1/images ตัวจริง — ใช้ร่วมกันระหว่าง orImage (ไม่มีภาพอ้างอิง)
 * กับ orImageWithRefs (มีภาพอ้างอิง ผ่าน input_references)
 */
async function postImageRequest(
  body: Record<string, unknown>,
  timeoutMs: number,
  label: string
): Promise<ORImageResult> {
  await acquireSlot()
  let res: Response
  try {
    res = await fetch('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } finally {
    releaseSlot()
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`OpenRouter ${label} ${res.status}: ${detail.slice(0, 300)}`)
  }
  const data = await res.json()
  if (data.error) throw new Error(`OpenRouter ${label} error: ${JSON.stringify(data.error).slice(0, 300)}`)
  const img: { b64_json?: string; media_type?: string } | undefined = data.data?.[0]
  if (!img?.b64_json) throw new Error(`OpenRouter ${label}: no image returned (${JSON.stringify(data).slice(0, 120)})`)
  return { base64: img.b64_json, mimeType: img.media_type || 'image/png', usage: parseUsage(data.usage) }
}

/** สร้างรูปผ่าน Image API เฉพาะทางของ OpenRouter — คืน base64 */
export async function orImage(params: {
  /** SOP §3: action ที่กำลังทำ — ได้ชื่อจริงเป็น mars_<client>_<action> (บังคับ) */
  trace: string
  /** ลูกค้าเจ้าของงาน — ไม่ส่ง = อ่านจากบริบท request (withOrClient) */
  client?: string
  prompt: string
  model?: string
  timeoutMs?: number
  /** สัดส่วนที่โมเดลรองรับ (gpt-5-image: '1:1' | '3:2' | '2:3') — ใกล้เคียงเป้าหมายที่สุด
   *  แล้วค่อย crop ปลายทาง เพื่อลดการตัดตัวหนังสือ/องค์ประกอบ */
  aspectRatio?: '1:1' | '3:2' | '2:3'
}): Promise<ORImageResult> {
  return postImageRequest(
    {
      model: params.model || OR_MODELS.image(),
      prompt: params.prompt,
      ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
      ...labelFields(params.trace, params.client),
    },
    params.timeoutMs ?? 300_000,
    'image'
  )
}

/**
 * สร้างรูปโดยมีภาพอ้างอิง (reference/logo) ประกอบ — ใช้ Content Engine Image Prompt
 * ที่แนบ referenceImages/logoImage (คำสั่งเจ้าของ — Image Prompt item 3)
 *
 * ตรวจกับ OpenRouter docs แล้ว (2026-09-14, /docs/features/multimodal/image-generation):
 * Image API เฉพาะทาง (POST /api/v1/images ตัวเดียวกับ orImage) รับพารามิเตอร์
 * `input_references` ตรงๆ อยู่แล้ว (array ของ {type:'image_url', image_url:{url}})
 * โมเดล openai/gpt-5-image ที่ตั้งเป็นค่า default (OR_MODELS.image) รองรับ
 * input_references 0-16 ภาพ (เช็คจาก GET /api/v1/images/models) — จึงไม่ต้องสลับไปใช้
 * chat completions endpoint แบบ multimodal ตามที่คาดไว้แต่แรก ใช้ endpoint เดิมของ
 * orImage ได้เลย แค่เพิ่มพารามิเตอร์นี้เข้าไป (เอาต์พุตยังเป็น data[0].b64_json เหมือนเดิม)
 */
export async function orImageWithRefs(params: {
  /** SOP §3: action ที่กำลังทำ — ได้ชื่อจริงเป็น mars_<client>_<action> (บังคับ) */
  trace: string
  /** ลูกค้าเจ้าของงาน — ไม่ส่ง = อ่านจากบริบท request (withOrClient) */
  client?: string
  prompt: string
  /** ภาพอ้างอิง (data URL หรือ https URL) — ภาพสุดท้ายมักเป็นโลโก้เมื่อผู้เรียกแนบมา */
  images: string[]
  model?: string
  timeoutMs?: number
  aspectRatio?: '1:1' | '3:2' | '2:3'
}): Promise<ORImageResult> {
  if (!params.images.length) throw new Error('orImageWithRefs: ต้องมีภาพอ้างอิงอย่างน้อย 1 ภาพ — ไม่งั้นใช้ orImage')
  return postImageRequest(
    {
      model: params.model || OR_MODELS.image(),
      prompt: params.prompt,
      input_references: params.images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
      ...labelFields(params.trace, params.client),
    },
    params.timeoutMs ?? 300_000,
    'image (refs)'
  )
}
