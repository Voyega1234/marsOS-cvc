/**
 * Keep "which tab / section is open" in the page URL, so a browser refresh
 * reopens the same screen instead of the default tab.
 *
 * Pure helpers live here (tested in url-state.test.ts); the React hook is in
 * src/hooks/use-url-state.ts.
 */

/** A change set for query params: a string sets the param, null removes it. */
export type UrlParamChanges = Record<string, string | null | undefined>

/** Longest value we are willing to read back from a query param. */
const MAX_PARAM_LENGTH = 200

/**
 * Read one query param and accept it only if it is in the allowed list.
 * Without a list, any non-empty value up to 200 characters is accepted.
 */
export function readAllowedParam<T extends string = string>(
  search: string,
  key: string,
  allowed?: readonly T[],
): T | null {
  const value = new URLSearchParams(search).get(key)
  if (!value || value.length > MAX_PARAM_LENGTH) return null
  if (allowed && !(allowed as readonly string[]).includes(value)) return null
  return value as T
}

/**
 * Build "path?query#hash" with the given params set or removed.
 * Params not named in `changes` are kept as they are.
 */
export function buildUrlWithParams(
  pathname: string,
  search: string,
  hash: string,
  changes: UrlParamChanges,
): string {
  const params = new URLSearchParams(search)
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === '') params.delete(key)
    else params.set(key, value)
  }
  const qs = params.toString()
  return pathname + (qs ? `?${qs}` : '') + (hash || '')
}

/**
 * Rewrite the current URL in place (no navigation, no new history entry,
 * no server request). Safe to call on the server: it does nothing there.
 *
 * The state argument must stay `null`: Next.js patches replaceState and only
 * syncs its own router (useSearchParams, later router.refresh) when the state
 * is not its internal one. Passing window.history.state would skip that sync
 * and the router could later put the old URL back.
 */
export function replaceUrlParams(changes: UrlParamChanges): void {
  if (typeof window === 'undefined') return
  const { pathname, search, hash } = window.location
  const next = buildUrlWithParams(pathname, search, hash, changes)
  if (next === pathname + search + hash) return
  window.history.replaceState(null, '', next)
}
