// Browser identifiers the ad platforms use to tie a server-sent conversion back to the
// visitor's web session: the GA4 client id and session id, Meta's _fbp / _fbc cookies,
// TikTok's _ttp cookie, Google's gbraid / wbraid click ids (iOS, from the landing URL),
// the LINE Tag click id and browser id, and Snapchat's _scid cookie.
//
// The LINE Tag names (landing URL parameter "ldtag_cl", cookie "__lt__cid") are an
// assumption: LINE's documentation does not state them.
//
// embed.js reads them from the customer's website (first-party cookies of that site) and
// posts them to the public /api/track endpoint. Everything here arrives from the open
// internet, so every value is checked against the shape the platform documents before it
// is stored or sent on. Pure functions only: no database, no network.

export interface BrowserIds {
  /** GA client id, the part of the _ga cookie after "GA1.1." (e.g. "1234567890.1700000000"). */
  gaClientId?: string;
  /** GA4 session id per stream, keyed by the measurement id without its "G-" prefix. */
  gaSessions?: Record<string, string>;
  /** Meta browser id (_fbp cookie). */
  fbp?: string;
  /** Meta click id cookie (_fbc), already in "fb.1.<ms>.<fbclid>" form. */
  fbc?: string;
  /** TikTok browser id (_ttp cookie). */
  ttp?: string;
  /** Google click id for iOS app-to-web traffic (gbraid URL parameter). */
  gbraid?: string;
  /** Google click id for iOS web-to-app traffic (wbraid URL parameter). */
  wbraid?: string;
  /** LINE Tag click id (landing URL parameter "ldtag_cl"; name assumed). */
  lineClickId?: string;
  /** LINE Tag browser id (cookie "__lt__cid"; name assumed). */
  lineBrowserId?: string;
  /** Snapchat pixel browser id (_scid cookie). */
  scid?: string;
}

/** A GA4 session is only joined to a Measurement Protocol event sent within this window. */
export const GA_SESSION_WINDOW_SECONDS = 24 * 60 * 60;

const MAX_GA_STREAMS = 5;

/** Accepts "1234567890.1700000000" or the whole cookie value "GA1.1.1234567890.1700000000". */
export function cleanGaClientId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const m = /^(?:GA\d\.\d\.)?(\d{1,20}\.\d{1,20})$/.exec(raw.trim());
  return m ? m[1] : undefined;
}

/**
 * Session id from the value of a _ga_<STREAM> cookie. Two formats are in the wild:
 *   GS1.1.1700000000.5.1.1700000100.60.0.0        (third field)
 *   GS2.1.s1746825440$o1$g0$t1746825440$j60$l0$h0  ("s" field)
 * The session id is the session start as Unix seconds.
 */
export function parseGaSessionCookie(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (value.length > 300) return undefined;
  let id: string | undefined;
  if (value.startsWith("GS1.")) {
    id = value.split(".")[2];
  } else if (value.startsWith("GS2.")) {
    const fields = value.split(".").slice(2).join(".").split("$");
    id = fields.find((f) => /^s\d+$/.test(f))?.slice(1);
  }
  return id && /^\d{9,11}$/.test(id) ? id : undefined;
}

/**
 * Sessions as embed.js sends them: "STREAM:cookieValue~STREAM:cookieValue".
 * Returns { STREAM: sessionId } for the entries that parse.
 */
export function parseGaSessions(raw: unknown): Record<string, string> | undefined {
  if (typeof raw !== "string" || !raw || raw.length > 1500) return undefined;
  const out: Record<string, string> = {};
  for (const entry of raw.split("~")) {
    const at = entry.indexOf(":");
    if (at < 1) continue;
    const stream = entry.slice(0, at).trim().toUpperCase();
    if (!/^[A-Z0-9]{4,20}$/.test(stream)) continue;
    const id = parseGaSessionCookie(entry.slice(at + 1));
    if (!id) continue;
    out[stream] = id;
    if (Object.keys(out).length >= MAX_GA_STREAMS) break;
  }
  return Object.keys(out).length ? out : undefined;
}

export function cleanFbp(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return v.length <= 100 && /^fb\.\d\.\d{10,16}\.\d{1,30}$/.test(v) ? v : undefined;
}

export function cleanFbc(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return v.length <= 600 && /^fb\.\d\.\d{10,16}\.[A-Za-z0-9_-]{8,}$/.test(v) ? v : undefined;
}

export function cleanTtp(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return /^[A-Za-z0-9_.-]{8,128}$/.test(v) ? v : undefined;
}

export function cleanGoogleBraid(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return /^[A-Za-z0-9_-]{8,512}$/.test(v) ? v : undefined;
}

export function cleanLineClickId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return /^[A-Za-z0-9._~=-]{4,512}$/.test(v) ? v : undefined;
}

export function cleanLineBrowserId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return /^[A-Za-z0-9._-]{4,128}$/.test(v) ? v : undefined;
}

export function cleanScid(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(v) ? v : undefined;
}

/** Field names embed.js uses, in the JSON body and in the lineclick query string alike. */
export function readBrowserIds(get: (name: string) => unknown): BrowserIds {
  const ids: BrowserIds = {};
  const gaClientId = cleanGaClientId(get("ga_client_id"));
  if (gaClientId) ids.gaClientId = gaClientId;
  const gaSessions = parseGaSessions(get("ga_sessions"));
  if (gaSessions) ids.gaSessions = gaSessions;
  const fbp = cleanFbp(get("fbp"));
  if (fbp) ids.fbp = fbp;
  const fbc = cleanFbc(get("fbc"));
  if (fbc) ids.fbc = fbc;
  const ttp = cleanTtp(get("ttp"));
  if (ttp) ids.ttp = ttp;
  const gbraid = cleanGoogleBraid(get("gbraid"));
  if (gbraid) ids.gbraid = gbraid;
  const wbraid = cleanGoogleBraid(get("wbraid"));
  if (wbraid) ids.wbraid = wbraid;
  const lineClickId = cleanLineClickId(get("line_click_id"));
  if (lineClickId) ids.lineClickId = lineClickId;
  const lineBrowserId = cleanLineBrowserId(get("line_browser_id"));
  if (lineBrowserId) ids.lineBrowserId = lineBrowserId;
  const scid = cleanScid(get("scid"));
  if (scid) ids.scid = scid;
  return ids;
}

export function hasBrowserIds(ids: BrowserIds): boolean {
  return !!(
    ids.gaClientId || ids.gaSessions || ids.fbp || ids.fbc || ids.ttp ||
    ids.gbraid || ids.wbraid || ids.lineClickId || ids.lineBrowserId || ids.scid
  );
}

/** Newer values win; a field the newer read did not see keeps its older value. */
export function mergeBrowserIds(older: BrowserIds, newer: BrowserIds): BrowserIds {
  const merged: BrowserIds = { ...older, ...newer };
  if (older.gaSessions || newer.gaSessions) {
    merged.gaSessions = { ...(older.gaSessions ?? {}), ...(newer.gaSessions ?? {}) };
  }
  return merged;
}

/** Re-validate what comes back out of storage: the row is plain JSON text. */
export function browserIdsFromStored(stored: unknown): BrowserIds {
  if (!stored || typeof stored !== "object") return {};
  const s = stored as Record<string, unknown>;
  const ids: BrowserIds = {};
  const gaClientId = cleanGaClientId(s.gaClientId);
  if (gaClientId) ids.gaClientId = gaClientId;
  if (s.gaSessions && typeof s.gaSessions === "object") {
    const sessions: Record<string, string> = {};
    for (const [stream, id] of Object.entries(s.gaSessions as Record<string, unknown>)) {
      if (/^[A-Z0-9]{4,20}$/.test(stream) && typeof id === "string" && /^\d{9,11}$/.test(id)) {
        sessions[stream] = id;
      }
    }
    if (Object.keys(sessions).length) ids.gaSessions = sessions;
  }
  const fbp = cleanFbp(s.fbp);
  if (fbp) ids.fbp = fbp;
  const fbc = cleanFbc(s.fbc);
  if (fbc) ids.fbc = fbc;
  const ttp = cleanTtp(s.ttp);
  if (ttp) ids.ttp = ttp;
  const gbraid = cleanGoogleBraid(s.gbraid);
  if (gbraid) ids.gbraid = gbraid;
  const wbraid = cleanGoogleBraid(s.wbraid);
  if (wbraid) ids.wbraid = wbraid;
  const lineClickId = cleanLineClickId(s.lineClickId);
  if (lineClickId) ids.lineClickId = lineClickId;
  const lineBrowserId = cleanLineBrowserId(s.lineBrowserId);
  if (lineBrowserId) ids.lineBrowserId = lineBrowserId;
  const scid = cleanScid(s.scid);
  if (scid) ids.scid = scid;
  return ids;
}

/**
 * The GA4 session id to send with an event for this stream, or undefined.
 *
 * GA4 only joins a Measurement Protocol event to a web session (and so to that session's
 * source / medium / campaign) when the event arrives within 24 hours of the session start.
 * After that the id buys no attribution and would only stretch an old session's length in
 * the reports, so it is left out.
 */
export function gaSessionFor(
  sessions: Record<string, string> | undefined,
  measurementId: string | undefined,
  now: Date = new Date()
): string | undefined {
  if (!sessions || !measurementId) return undefined;
  const stream = measurementId.trim().toUpperCase().replace(/^G-/, "");
  const id = sessions[stream];
  if (!id) return undefined;
  const age = Math.floor(now.getTime() / 1000) - Number(id);
  return age >= 0 && age <= GA_SESSION_WINDOW_SECONDS ? id : undefined;
}

/**
 * Meta's fbc value for an event.
 *
 * The _fbc cookie is used as is when it belongs to the click id the lead came in with (or
 * when the lead has no click id of its own). Otherwise the value is built from the click id,
 * with the click time in MILLISECONDS as Meta documents; seconds are read as a 1970 date.
 */
export function fbcFor(
  fbclid: string | null | undefined,
  cookieFbc: string | undefined,
  clickTime: Date
): string | undefined {
  if (!fbclid) return cookieFbc;
  if (cookieFbc && cookieFbc.endsWith(`.${fbclid}`)) return cookieFbc;
  return `fb.1.${clickTime.getTime()}.${fbclid}`;
}

/**
 * `value` when it is an absolute http(s) URL with a hostname (max 2000 chars),
 * else undefined. A relative path must not be sent to a platform as the page
 * the conversion happened on.
 */
export function absoluteHttpUrl(value: string | null | undefined): string | undefined {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v || v.length > 2000) return undefined;
  try {
    const url = new URL(v);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A click id is an opaque token from the ad platform. Anything carrying brackets,
 * percent signs or whitespace is a template leftover, not an id, and must not be stored:
 * it would later be uploaded to the platform as if it were real.
 */
export function isPlausibleClickId(v: string): boolean {
  return !/[{}\[\]%\s]/.test(v);
}

const CLICK_ID_FIELDS = ["gclid", "fbclid", "ttclid", "msclkid", "twclid", "scclid"];
const LONG_FIELDS = ["landing_url", "referrer"];
const LONG_FIELD_CAP = 2000;
const FIELD_CAP = 1000;

/** The parsed JSON body as a plain object; anything else (array, string, null...) is empty. */
export function asBodyObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/**
 * The public tracking body reduced to fields that are usable as text: a field is kept only
 * when it is a non-empty trimmed string within its length cap (2000 for landing_url and
 * referrer, 1000 for the rest). Over-cap and non-string values are dropped, never truncated,
 * and malformed click ids are dropped too.
 */
export function coerceTrackBody(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const source = asBodyObject(raw);
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (typeof value !== "string") continue;
    const v = value.trim();
    if (!v) continue;
    const cap = LONG_FIELDS.indexOf(key) >= 0 ? LONG_FIELD_CAP : FIELD_CAP;
    if (v.length > cap) continue;
    if (CLICK_ID_FIELDS.indexOf(key) >= 0 && !isPlausibleClickId(v)) continue;
    out[key] = v;
  }
  return out;
}
