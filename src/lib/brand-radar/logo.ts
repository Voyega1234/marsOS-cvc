// Brand logo helpers that are safe to import anywhere (no database, no Buffer).

export const BRAND_LOGO_ROUTE = '/api/brand-radar/logo'

/** Same-origin path of a brand's logo. The version changes whenever the logo does, so the browser cache stays correct. */
export function brandLogoPath(projectId: string, version: Date | number): string {
  const ms = version instanceof Date ? version.getTime() : version
  return `${BRAND_LOGO_ROUTE}?projectId=${encodeURIComponent(projectId)}&v=${ms.toString(36)}`
}

const DATA_URL = /^data:(image\/(?:webp|png|jpeg));base64,([A-Za-z0-9+/=]+)$/

/** Splits a stored logo data URL into its mime type and base64 payload. Only raster formats are accepted (never SVG). */
export function decodeLogoDataUrl(dataUrl: string): { mime: 'image/webp' | 'image/png' | 'image/jpeg'; base64: string } | null {
  const m = DATA_URL.exec(dataUrl)
  if (!m) return null
  return { mime: m[1] as 'image/webp' | 'image/png' | 'image/jpeg', base64: m[2] }
}
