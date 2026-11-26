// ─── Content Engine > AI Model — which OpenRouter model each scope uses ─────────
// One choice per Content Engine scope (a project, an Upload Article client, a PBN set, or
// Studio) for four kinds of work:
//   write       new articles, and the steps that produce an article from a source
//   regenerate  rewriting an article that already exists (Re-generate, revise by comment)
//   image       cover and in-article images
//   translate   Upload Article > Translate (translating and checking the translation)
// An empty choice means "the system default" (OR_MODELS), which is what every scope used
// before this setting existed. Scopes never share a choice.
//
// Pure functions only (no prisma, no fetch) — the database side is ce-ai-models-server.ts.

export type CeModelKind = 'write' | 'regenerate' | 'image' | 'translate'

export const CE_MODEL_KINDS: readonly CeModelKind[] = ['write', 'regenerate', 'image', 'translate']

/** '' = use the system default for that kind */
export interface CeAiModelChoice {
  write: string
  regenerate: string
  image: string
  translate: string
}

export const EMPTY_CE_AI_MODELS: CeAiModelChoice = { write: '', regenerate: '', image: '', translate: '' }

export const STUDIO_SCOPE_KEY = 'studio'

/** A project id / Upload client id, optionally followed by "~<PBN set id>", or "studio". */
const SCOPE_KEY_RE = /^[A-Za-z0-9_-]{1,64}(~[A-Za-z0-9_-]{1,64})?$/

export function isValidScopeKey(key: unknown): key is string {
  return typeof key === 'string' && SCOPE_KEY_RE.test(key)
}

/** The scope key of a Content Engine scope as the settings UI knows it. */
export function ceScopeKey(scope: { projectId: string } | 'studio' | string | null | undefined): string {
  if (!scope || scope === 'studio') return STUDIO_SCOPE_KEY
  return typeof scope === 'string' ? scope : scope.projectId
}

/** The id that owns the scope: the part before "~" (a PBN set belongs to its Upload client). */
export function scopeOwnerId(scopeKey: string): string {
  return scopeKey.split('~')[0]
}

/** AppSetting has no organization column, so the organization is part of the key. */
export function ceAiModelsSettingKey(orgId: string, scopeKey: string): string {
  return `ce_ai_models:${orgId}:${scopeKey}`
}

/** "vendor/model" as OpenRouter writes it, with an optional ":variant" (":free", ":nitro"). */
const MODEL_ID_RE = /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*(:[A-Za-z0-9._-]+)?$/
export const MAX_MODEL_ID_CHARS = 120

export function isModelIdSyntax(id: unknown): boolean {
  return typeof id === 'string' && id.length <= MAX_MODEL_ID_CHARS && MODEL_ID_RE.test(id)
}

/** Read a stored value. Anything unreadable or malformed counts as "not chosen". */
export function parseCeAiModels(raw: string | null | undefined): CeAiModelChoice {
  if (!raw) return { ...EMPTY_CE_AI_MODELS }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ...EMPTY_CE_AI_MODELS }
  }
  const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const out = { ...EMPTY_CE_AI_MODELS }
  for (const kind of CE_MODEL_KINDS) {
    const v = obj[kind]
    if (typeof v === 'string' && isModelIdSyntax(v)) out[kind] = v
  }
  return out
}

export interface KnownModelIds {
  /** ids that produce text (write, regenerate, translate) */
  text: ReadonlySet<string>
  /** ids that work with the image endpoint the system uses */
  image: ReadonlySet<string>
}

const KIND_THAI: Record<CeModelKind, string> = {
  write: 'เขียนบทความใหม่',
  regenerate: 'Re-generate',
  image: 'รูปภาพ',
  translate: 'Translate',
}

/**
 * Check what the settings page sent. Every kind must be present as a string: '' (system
 * default) or a model id. When the OpenRouter list is known, an id that is not on it — or is
 * on the wrong list (a text model for images) — is refused, so a typo is caught here and not
 * when someone presses Generate.
 */
export function readCeAiModelsInput(
  body: unknown,
  known: KnownModelIds | null,
): { ok: true; value: CeAiModelChoice } | { ok: false; error: string } {
  const obj = (body && typeof body === 'object' ? body : null) as Record<string, unknown> | null
  if (!obj) return { ok: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง' }
  const value = { ...EMPTY_CE_AI_MODELS }
  for (const kind of CE_MODEL_KINDS) {
    const raw = obj[kind]
    if (typeof raw !== 'string') return { ok: false, error: `ไม่พบค่าโมเดลของ "${KIND_THAI[kind]}"` }
    const id = raw.trim()
    if (!id) continue
    if (!isModelIdSyntax(id)) return { ok: false, error: `ชื่อโมเดลของ "${KIND_THAI[kind]}" ไม่ถูกรูปแบบ: ${id.slice(0, 80)}` }
    if (known) {
      const list = kind === 'image' ? known.image : known.text
      if (!list.has(id)) {
        return {
          ok: false,
          error: kind === 'image'
            ? `โมเดล ${id} ไม่อยู่ในรายการโมเดลสร้างรูปที่ระบบใช้ได้ (ต้องเป็นโมเดลของ OpenRouter ที่รับภาพอ้างอิงได้)`
            : `โมเดล ${id} ไม่อยู่ในรายการโมเดลเขียนข้อความของ OpenRouter`,
        }
      }
    }
    value[kind] = id
  }
  return { ok: true, value }
}
