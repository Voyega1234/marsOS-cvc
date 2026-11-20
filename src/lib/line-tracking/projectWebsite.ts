// Checks the website link typed on a project's Settings page.
//
// The link is where the setup wizard's "Test" button looks for the tracking script, and
// where the LINE success page and /t/<slug> send a visitor back. It is not part of
// tracking itself: the embed snippet and tracking links are keyed by the project slug,
// so changing the link never breaks data already collected.

export const PROJECT_WEBSITE_MAX = 500;

export type ProjectWebsiteError = "invalid" | "too_long";

export type ProjectWebsitePlan =
  | { kind: "error"; code: ProjectWebsiteError }
  | { kind: "unchanged" }
  | { kind: "set"; url: string | null };

export const PROJECT_WEBSITE_ERROR_TEXT: Record<ProjectWebsiteError, string> = {
  invalid: "ลิงก์เว็บไม่ถูกต้อง ใส่แบบ https://www.example.com",
  too_long: `ลิงก์เว็บยาวเกิน ${PROJECT_WEBSITE_MAX} ตัวอักษร`,
};

/** Empty input clears the link. A link typed without http(s):// gets https:// in front. */
export function normalizeProjectWebsite(input: unknown): { ok: true; url: string | null } | { ok: false; code: ProjectWebsiteError } {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return { ok: true, url: null };
  if (raw.length > PROJECT_WEBSITE_MAX) return { ok: false, code: "too_long" };
  if (/\s/.test(raw)) return { ok: false, code: "invalid" };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, code: "invalid" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, code: "invalid" };
  // A real site has a dotted host name; this also refuses "https://localhost" and typos like "https://vaanaa".
  if (!parsed.hostname.includes(".") || parsed.username || parsed.password) return { ok: false, code: "invalid" };
  if (withScheme.length > PROJECT_WEBSITE_MAX) return { ok: false, code: "too_long" };
  return { ok: true, url: withScheme };
}

export function planProjectWebsite(current: string | null | undefined, input: unknown): ProjectWebsitePlan {
  const result = normalizeProjectWebsite(input);
  if (!result.ok) return { kind: "error", code: result.code };
  if ((current?.trim() || null) === result.url) return { kind: "unchanged" };
  return { kind: "set", url: result.url };
}
