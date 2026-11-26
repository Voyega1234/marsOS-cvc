// ─── The list of models OpenRouter offers, for the Content Engine > AI Model pickers ────
// Two public endpoints (no API key is sent):
//   GET /api/v1/models          models that write text, with price and limits
//   GET /api/v1/images/models   models of the Images API — the endpoint orImage calls
// The list changes rarely, so it is kept in memory for an hour. When OpenRouter cannot be
// reached the last good list is served; with no list at all the caller gets null.

const TEXT_MODELS_URL = 'https://openrouter.ai/api/v1/models'
const IMAGE_MODELS_URL = 'https://openrouter.ai/api/v1/images/models'
const CACHE_MS = 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 15_000

/** Every image the system asks for uses one of these shapes (covers 3:2, squares, portraits). */
export const REQUIRED_IMAGE_RATIOS = ['1:1', '3:2', '2:3'] as const

export interface OrModelOption {
  id: string
  name: string
  /** text models: context window in tokens */
  contextLength?: number
  /** text models: longest answer the main provider allows, in tokens */
  maxOutput?: number
  /** text models: US dollars per 1 million tokens */
  promptPerM?: number
  completionPerM?: number
  /** image models: accepts reference images (needed for covers drawn from a reference) */
  imageInput?: boolean
}

export interface OrModelLists {
  text: OrModelOption[]
  image: OrModelOption[]
  fetchedAt: string
}

type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const posInt = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined)

/** "0.000004" dollars per token → 4 dollars per million tokens */
function perMillion(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.round(n * 1_000_000 * 10_000) / 10_000
}

function rows(json: unknown): Json[] {
  const data = isObj(json) ? json.data : null
  return Array.isArray(data) ? data.filter(isObj) : []
}

function byName(a: OrModelOption, b: OrModelOption): number {
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
}

/** Models whose output is text only (image and audio generators are left out). */
export function toTextModelOptions(json: unknown): OrModelOption[] {
  const out: OrModelOption[] = []
  for (const m of rows(json)) {
    if (typeof m.id !== 'string' || !m.id) continue
    const arch = isObj(m.architecture) ? m.architecture : {}
    const outputs = strList(arch.output_modalities)
    if (outputs.length !== 1 || outputs[0] !== 'text') continue
    const pricing = isObj(m.pricing) ? m.pricing : {}
    const top = isObj(m.top_provider) ? m.top_provider : {}
    out.push({
      id: m.id,
      name: typeof m.name === 'string' && m.name ? m.name : m.id,
      contextLength: posInt(m.context_length),
      maxOutput: posInt(top.max_completion_tokens),
      promptPerM: perMillion(pricing.prompt),
      completionPerM: perMillion(pricing.completion),
    })
  }
  return out.sort(byName)
}

/**
 * Image models that can draw every shape the system asks for. A model without one of
 * REQUIRED_IMAGE_RATIOS would fail (or return a square) on covers, so it is not offered.
 */
export function toImageModelOptions(json: unknown): OrModelOption[] {
  const out: OrModelOption[] = []
  for (const m of rows(json)) {
    if (typeof m.id !== 'string' || !m.id) continue
    const arch = isObj(m.architecture) ? m.architecture : {}
    if (!strList(arch.output_modalities).includes('image')) continue
    const params = isObj(m.supported_parameters) ? m.supported_parameters : {}
    const ratios = strList(isObj(params.aspect_ratio) ? params.aspect_ratio.values : null)
    if (!REQUIRED_IMAGE_RATIOS.every((r) => ratios.includes(r))) continue
    out.push({
      id: m.id,
      name: typeof m.name === 'string' && m.name ? m.name : m.id,
      imageInput: strList(arch.input_modalities).includes('image'),
    })
  }
  return out.sort(byName)
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' })
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`)
  return res.json()
}

let cached: { lists: OrModelLists; at: number } | null = null
let inFlight: Promise<OrModelLists | null> | null = null

async function load(): Promise<OrModelLists | null> {
  try {
    const [textJson, imageJson] = await Promise.all([fetchJson(TEXT_MODELS_URL), fetchJson(IMAGE_MODELS_URL)])
    const text = toTextModelOptions(textJson)
    const image = toImageModelOptions(imageJson)
    // An empty list means the answer was not what we expect: keep what we had.
    if (text.length === 0 || image.length === 0) throw new Error('empty model list')
    cached = { lists: { text, image, fetchedAt: new Date().toISOString() }, at: Date.now() }
    return cached.lists
  } catch (e) {
    console.error('[openrouter-models] list failed:', e instanceof Error ? e.message : e)
    return cached?.lists ?? null
  }
}

/** The model lists, at most an hour old. null = OpenRouter unreachable and nothing cached. */
export async function listOrModels(): Promise<OrModelLists | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.lists
  if (!inFlight) {
    inFlight = load().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}
