// ─── Upload Article: source articles that exist only to be translated ──────────────────────────
// A source imported in the Translate tab (or translated before it was ever generated) is not an
// article the team reviews or pushes: only its translation is. Their ids live in
// pushPrefs.translateSources (no schema change). Review and Push hide such a row while it is still
// IMPORTED; once the team runs Generate on it, it is a normal article again and shows up.

export const TRANSLATE_SOURCES_KEY = 'translateSources'
/** Newest first; older ids drop off (a dropped id only means the row shows in Review again). */
export const MAX_TRANSLATE_SOURCES = 1000

/** Keep only non-empty string ids, without duplicates, at most MAX_TRANSLATE_SOURCES. */
export function readTranslateSources(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const id = v.trim()
    if (!id || id.length > 64 || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= MAX_TRANSLATE_SOURCES) break
  }
  return out
}

/** Put `ids` in front of the stored list (newest first). */
export function addTranslateSources(current: unknown, ids: string[]): string[] {
  return readTranslateSources([...ids, ...readTranslateSources(current)])
}

/** Ids of the rows Review and Push must not list: marked as a translation source and never generated. */
export function hiddenTranslateSourceIds(
  articles: ReadonlyArray<{ id: string; status: string }>,
  sources: readonly string[] | undefined,
): Set<string> {
  const out = new Set<string>()
  if (!sources || sources.length === 0) return out
  const marked = new Set(sources)
  for (const a of articles) {
    if (a.status === 'IMPORTED' && marked.has(a.id)) out.add(a.id)
  }
  return out
}
