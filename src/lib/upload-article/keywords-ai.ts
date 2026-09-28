// ─── Upload Article — AI ช่วยตั้งชื่อ/slug/intent/ประเภทบทความ ให้ keyword แต่ละคำ ───
// เรียก OpenRouter ตรง ๆ (ไม่ผ่าน askJson เพราะต้องล็อกโมเดล OR_MODELS.keyword() ตามสเปก)

import { OR_MODELS, orChat, type ORUsage } from '@/lib/openrouter'
import type { UploadKeywordIntent } from './types'
import { humanTitleRulesBlock, titleLooksMachineWritten } from './human-voice'

const VALID_INTENTS: UploadKeywordIntent[] = ['informational', 'educational', 'commercial', 'transactional', 'navigational']

export const KEYWORD_AI_BATCH_SIZE = 20

export interface KeywordAiInput {
  id: string
  keyword: string
  volume?: number | null
  /** title ที่ทีมตั้งมาแล้ว (เช่นมากับไฟล์) — AI ต้องใช้ตามนี้ ห้ามแก้ แล้วตั้ง slug/intent/ประเภทจาก title นี้ */
  fixedTitle?: string
}

export interface KeywordAiItem {
  id: string
  title: string
  slug: string
  intent: UploadKeywordIntent | ''
  articleType: string
}

export interface KeywordAiResult {
  items: KeywordAiItem[]
  usage: ORUsage
  errors: string[]
}

const ZERO_USAGE: ORUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 }

/** slug ที่ AI ส่งมาอาจมีอักขระแปลกปน — เหลือ a-z0-9- ล้วน ตัดไม่เกิน 60 ตัว */
export function sanitizeSlugCandidate(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** ทำให้ slug ไม่ซ้ำกับที่มีอยู่แล้วในแผน — ชนก็ต่อท้าย -2, -3, ... */
export function uniqueSlug(base: string, taken: Set<string>): string {
  const root = base || 'keyword'
  if (!taken.has(root)) return root
  for (let i = 2; i < 1000; i++) {
    const suffix = `-${i}`
    const candidate = root.slice(0, 60 - suffix.length) + suffix
    if (!taken.has(candidate)) return candidate
  }
  return `${root.slice(0, 50)}-${Date.now()}`
}

export function normalizeIntent(raw: unknown): UploadKeywordIntent | '' {
  const v = String(raw || '').trim().toLowerCase()
  return (VALID_INTENTS as string[]).includes(v) ? (v as UploadKeywordIntent) : ''
}

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

interface RawAiItem {
  id?: string
  title?: string
  slug?: string
  intent?: string
  articleType?: string
}

/** เรียก AI ทีละ batch (≤20 คำ ต่อครั้ง) — คืนผลรวมทุก batch พร้อม usage สะสม */
export async function generateKeywordPlan(params: {
  items: KeywordAiInput[]
  clientName: string
  website: string
  language: 'th' | 'en'
}): Promise<KeywordAiResult> {
  const batches: KeywordAiInput[][] = []
  for (let i = 0; i < params.items.length; i += KEYWORD_AI_BATCH_SIZE) {
    batches.push(params.items.slice(i, i + KEYWORD_AI_BATCH_SIZE))
  }

  const results = await Promise.all(batches.map((batch) => runBatch(batch, params.clientName, params.website, params.language)))

  const items: KeywordAiItem[] = []
  const errors: string[] = []
  let usage: ORUsage = { ...ZERO_USAGE }
  for (const r of results) {
    items.push(...r.items)
    errors.push(...r.errors)
    usage = { inputTokens: usage.inputTokens + r.usage.inputTokens, outputTokens: usage.outputTokens + r.usage.outputTokens, totalTokens: usage.totalTokens + r.usage.totalTokens, costUsd: usage.costUsd + r.usage.costUsd }
  }
  return { items, usage, errors }
}

/** รอบแรกได้ title ที่ยังเหมือน AI (โคลอน/คำติดปาก AI) → ขอใหม่เฉพาะตัวนั้นอีก 1 รอบ */
async function runBatch(
  batch: KeywordAiInput[],
  clientName: string,
  website: string,
  language: 'th' | 'en',
): Promise<KeywordAiResult> {
  const first = await runBatchOnce(batch, clientName, website, language)
  const fixedIds = new Set(batch.filter((b) => b.fixedTitle).map((b) => b.id))
  const redo = first.items.filter((it) => !fixedIds.has(it.id) && titleLooksMachineWritten(it.title))
  if (redo.length === 0) return first
  const retryInput = batch
    .filter((b) => redo.some((r) => r.id === b.id))
    .map((b) => ({ ...b, rejectedTitle: redo.find((r) => r.id === b.id)?.title || '' }))
  const second = await runBatchOnce(retryInput, clientName, website, language)
  const fixed = new Map(second.items.filter((it) => it.title && !titleLooksMachineWritten(it.title)).map((it) => [it.id, it]))
  return {
    items: first.items.map((it) => {
      const f = fixed.get(it.id)
      return f ? { ...it, title: f.title, slug: f.slug || it.slug } : it
    }),
    usage: {
      inputTokens: first.usage.inputTokens + second.usage.inputTokens,
      outputTokens: first.usage.outputTokens + second.usage.outputTokens,
      totalTokens: first.usage.totalTokens + second.usage.totalTokens,
      costUsd: first.usage.costUsd + second.usage.costUsd,
    },
    errors: [...first.errors, ...second.errors],
  }
}

async function runBatchOnce(
  batch: (KeywordAiInput & { rejectedTitle?: string })[],
  clientName: string,
  website: string,
  language: 'th' | 'en',
): Promise<KeywordAiResult> {
  const system = `คุณคือนักวางแผนคอนเทนต์ SEO มืออาชีพ ตอบเป็น JSON เท่านั้น ไม่มีคำอธิบายอื่น
รูปแบบ: {"items": [{"id": string, "title": string, "slug": string, "intent": string, "articleType": string}]}
กติกา ต่อ 1 รายการ:
- title: ชื่อบทความ (H1) ที่ตรงกับ keyword ใช้ภาษาเดียวกับ keyword นั้น ความยาวไม่เกิน 65 ตัวอักษร ต้องอ่านแล้วเหมือนคนตั้ง ไม่ใช่ AI:
${humanTitleRulesBlock()}
- slug: คำภาษาอังกฤษล้วนจากความหมายของ title ตัวพิมพ์เล็ก คั่นด้วย - ความยาวไม่เกิน 60 ตัวอักษร ใช้ได้เฉพาะ a-z0-9-
- intent: เลือกค่าเดียวจาก informational | educational | commercial | transactional | navigational
- articleType: ป้ายสั้น ๆ ภาษาไทย เช่น "บทความให้ความรู้" | "How-to / ขั้นตอน" | "Listicle" | "เปรียบเทียบ" | "รีวิว/แนะนำสินค้า" | "หน้าขาย/บริการ"
ลูกค้า: ${clientName || '(ไม่ระบุ)'} เว็บไซต์: ${website || '(ไม่ระบุ)'} ภาษาเว็บไซต์หลัก: ${language === 'en' ? 'English' : 'ไทย'}
ถ้ารายการไหนมี fixedTitle = ทีมตั้ง title ไว้แล้ว ให้ตอบ title เป็น fixedTitle ตรงตัวอักษร ห้ามแก้ แล้วตั้ง slug/intent/articleType ให้เข้ากับ title นั้น
ต้องตอบครบทุก id ที่ส่งมา ตามลำดับเดิม ห้ามเว้น ห้ามเพิ่ม id ใหม่`

  const user = JSON.stringify({ keywords: batch.map((b) => ({
      id: b.id,
      keyword: b.keyword,
      volume: b.volume ?? null,
      ...(b.fixedTitle ? { fixedTitle: b.fixedTitle } : {}),
      ...(b.rejectedTitle ? { rejectedTitle: b.rejectedTitle, note: 'title เดิมอ่านแล้วเหมือน AI เขียน ห้ามใช้รูปแบบเดิม ตั้งใหม่ให้เป็นภาษาคน' } : {}),
    })) })

  try {
    const res = await orChat({
      trace: 'upload_article_keywords_ai',
      model: OR_MODELS.keyword(),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 4000,
      temperature: 0.4,
      jsonMode: true,
      timeoutMs: 120_000,
    })
    const parsed = JSON.parse(extractJson(res.text)) as { items?: RawAiItem[] }
    const rawItems = Array.isArray(parsed.items) ? parsed.items : []
    const byId = new Map(rawItems.map((it) => [String(it.id || ''), it]))
    const items: KeywordAiItem[] = batch.map((b) => {
      const it = byId.get(b.id)
      return {
        id: b.id,
        title: b.fixedTitle || (it?.title || '').trim().slice(0, 200),
        slug: sanitizeSlugCandidate(it?.slug || ''),
        intent: normalizeIntent(it?.intent),
        articleType: (it?.articleType || '').trim().slice(0, 100),
      }
    })
    return { items, usage: res.usage, errors: [] }
  } catch (e) {
    const usage = (e as Error & { usage?: ORUsage }).usage ?? ZERO_USAGE
    const msg = e instanceof Error ? e.message.slice(0, 200) : String(e)
    return { items: batch.map((b) => ({ id: b.id, title: '', slug: '', intent: '', articleType: '' })), usage, errors: [msg] }
  }
}
