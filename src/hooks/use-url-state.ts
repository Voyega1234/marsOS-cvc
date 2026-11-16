'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { readAllowedParam, replaceUrlParams } from '@/lib/url-state'

/** useLayoutEffect in the browser (runs before paint), useEffect on the server. */
export const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * useState for a tab / section / view name that is also kept in the URL as
 * `?<key>=<value>`, so a browser refresh reopens the same tab.
 *
 * - First render always uses `defaultValue` (same on server and browser, so no
 *   hydration mismatch); the value from the URL is applied right after mount,
 *   before the browser paints.
 * - A value not in `allowed` is ignored.
 * - The param is removed from the URL when the value equals `defaultValue`.
 * - The URL is rewritten in place: no navigation, no history entry, no server request.
 *
 * Each key must be unique among the components visible on one page.
 * The setter takes a value only (no updater function).
 *
 * `enabled = false` turns the URL part off (plain useState): for a component
 * whose tab is controlled by a parent that already keeps it in the URL.
 */
export function useUrlState<T extends string>(
  key: string,
  defaultValue: T,
  allowed?: readonly T[],
  enabled = true,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(defaultValue)

  const allowedRef = useRef(allowed)
  allowedRef.current = allowed
  const defaultRef = useRef(defaultValue)
  defaultRef.current = defaultValue
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  useIsoLayoutEffect(() => {
    if (!enabledRef.current) return
    const fromUrl = readAllowedParam<T>(window.location.search, key, allowedRef.current)
    if (fromUrl !== null) setValue(fromUrl)
  }, [key])

  const set = useCallback((next: T) => {
    setValue(next)
    if (enabledRef.current) replaceUrlParams({ [key]: next === defaultRef.current ? null : next })
  }, [key])

  return [value, set]
}
