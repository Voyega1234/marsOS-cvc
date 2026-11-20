// A project's logo, shown instead of the initials on the Projects board.
//
// The browser shrinks the picked image to a small square before upload (ProjectLogoField),
// so the stored value is a short data URI. It lives in one lt_project_connection row of type
// PROJECT_LOGO that stays NOT_CONNECTED, like OVERVIEW_SETTINGS: no new table or column, and
// the setup checklist (which counts CONNECTED rows of the connector types) is unaffected.

export const PROJECT_LOGO_TYPE = "PROJECT_LOGO";

/** Longest data URI accepted (characters). A 256 px WebP/PNG logo is far below this. */
export const PROJECT_LOGO_MAX_CHARS = 300_000;

/** Raster formats only: an SVG can carry script and is refused. */
const DATA_URI = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export type ProjectLogoError = "invalid" | "too_big";

export const PROJECT_LOGO_ERROR_TEXT: Record<ProjectLogoError, string> = {
  invalid: "ไฟล์โลโก้ไม่ถูกต้อง ใช้รูป PNG, JPG หรือ WebP",
  too_big: "โลโก้ใหญ่เกินไป ลองใช้รูปที่เล็กลง",
};

export function parseProjectLogo(input: unknown): { ok: true; dataUri: string } | { ok: false; code: ProjectLogoError } {
  if (typeof input !== "string" || !input) return { ok: false, code: "invalid" };
  if (input.length > PROJECT_LOGO_MAX_CHARS) return { ok: false, code: "too_big" };
  if (!DATA_URI.test(input)) return { ok: false, code: "invalid" };
  return { ok: true, dataUri: input };
}

/** Reads the stored row's configJson. Anything unexpected reads as "no logo". */
export function logoFromConfig(configJson: string | null | undefined): string | null {
  if (!configJson) return null;
  try {
    const value = (JSON.parse(configJson) as { dataUri?: unknown }).dataUri;
    const parsed = parseProjectLogo(value);
    return parsed.ok ? parsed.dataUri : null;
  } catch {
    return null;
  }
}
