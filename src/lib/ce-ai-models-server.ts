// ─── Content Engine > AI Model — database side ─────────────────────────────────
// Stored in AppSetting (key ce_ai_models:<orgId>:<scopeKey>), so no new table or column.
import { prisma } from '@/lib/prisma'
import { OR_MODELS } from '@/lib/openrouter'
import {
  EMPTY_CE_AI_MODELS,
  STUDIO_SCOPE_KEY,
  ceAiModelsSettingKey,
  isValidScopeKey,
  parseCeAiModels,
  scopeOwnerId,
  type CeAiModelChoice,
  type CeModelKind,
} from '@/lib/ce-ai-models'

/**
 * What a scope uses when nothing is chosen: the models every scope used before this setting,
 * and the newest Gemini for translation.
 */
export function defaultCeModel(kind: CeModelKind): string {
  if (kind === 'image') return OR_MODELS.image()
  if (kind === 'translate') return OR_MODELS.translate()
  return OR_MODELS.writer()
}

export function defaultCeModels(): CeAiModelChoice {
  return {
    write: defaultCeModel('write'),
    regenerate: defaultCeModel('regenerate'),
    image: defaultCeModel('image'),
    translate: defaultCeModel('translate'),
  }
}

/** The stored choice of one scope ('' = not chosen). Throws when the database cannot be read. */
export async function readCeAiModels(orgId: string, scopeKey: string): Promise<CeAiModelChoice> {
  if (!orgId || !isValidScopeKey(scopeKey)) return { ...EMPTY_CE_AI_MODELS }
  const row = await prisma.appSetting.findUnique({ where: { key: ceAiModelsSettingKey(orgId, scopeKey) } })
  return parseCeAiModels(row?.value)
}

export async function saveCeAiModels(orgId: string, scopeKey: string, value: CeAiModelChoice): Promise<void> {
  const key = ceAiModelsSettingKey(orgId, scopeKey)
  const json = JSON.stringify({ write: value.write, regenerate: value.regenerate, image: value.image, translate: value.translate })
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } })
}

/**
 * The model one piece of work must use: the scope's choice, or the system default when the
 * scope has none. A scope key that is missing or malformed gets the default too.
 *
 * A failed read is not turned into the default: the caller's request fails instead, the same
 * way it would for any other database error. Quietly writing with a different model than the
 * team chose would be worse than asking them to press the button again.
 */
export async function resolveCeModel(
  orgId: string,
  scopeKey: string | null | undefined,
  kind: CeModelKind,
): Promise<string> {
  if (!scopeKey || !isValidScopeKey(scopeKey)) return defaultCeModel(kind)
  const chosen = await readCeAiModels(orgId, scopeKey)
  return chosen[kind] || defaultCeModel(kind)
}

/** True when the scope is Studio or names a project / Upload Article client of this organization. */
export async function ceScopeBelongsToOrg(orgId: string, scopeKey: string): Promise<boolean> {
  if (!isValidScopeKey(scopeKey)) return false
  if (scopeKey === STUDIO_SCOPE_KEY) return true
  const ownerId = scopeOwnerId(scopeKey)
  const [project, uploadClient] = await Promise.all([
    // A PBN set id ("client~set") is only ever an Upload client's.
    scopeKey === ownerId
      ? prisma.project.findFirst({ where: { id: ownerId, organizationId: orgId }, select: { id: true } })
      : null,
    prisma.uploadClient.findFirst({ where: { id: ownerId, organizationId: orgId }, select: { id: true } }),
  ])
  return !!(project || uploadClient)
}
