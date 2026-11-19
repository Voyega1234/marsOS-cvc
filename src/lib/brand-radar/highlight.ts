// Brand Radar: split a text into plain / highlighted segments for a list of terms (pure, no React, no server imports).
// Used to mark our brand (and competitors) inside AI answers. The text is untrusted: callers must render segments
// as React text nodes only.

export interface HighlightSegment { text: string; hit: boolean }

const LATIN = /[A-Za-z0-9À-ɏ]/;
/** Longest text scanned for hits; the remainder is returned as one plain segment. */
export const MAX_HIGHLIGHT_CHARS = 200_000;
/** Most hits marked in one text. */
export const MAX_HIGHLIGHT_HITS = 2_000;
const MAX_TERMS = 200;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Cleans a term list: trims, drops empty / 1-character terms, de-duplicates case-insensitively, longest first. */
export function normalizeTerms(terms: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    const v = (t ?? "").trim();
    if (v.length < 2) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out.sort((a, b) => b.length - a.length).slice(0, MAX_TERMS);
}

const reCache = new Map<string, RegExp>();
function regexFor(terms: string[]): RegExp {
  const key = terms.map((t) => t.toLowerCase()).join("\u0000");
  let re = reCache.get(key);
  if (!re) {
    re = new RegExp(terms.map((t) => escapeRe(t)).join("|"), "gi");
    if (reCache.size > 30) reCache.clear();
    reCache.set(key, re);
  }
  return re;
}

/**
 * Splits `text` into segments; hits are the places where one of `terms` appears.
 * Case-insensitive, longest term first, no overlaps. A term that starts or ends with a Latin letter or digit
 * must not sit inside a longer Latin / digit word ("ace" does not hit inside "space"); Thai has no word spaces,
 * so Thai terms match inside running text. The joined segments always equal the input.
 */
export function splitByTerms(text: string, terms: ReadonlyArray<string | null | undefined>): HighlightSegment[] {
  if (!text) return [];
  const list = normalizeTerms(terms);
  if (list.length === 0) return [{ text, hit: false }];
  const scan = text.length > MAX_HIGHLIGHT_CHARS ? text.slice(0, MAX_HIGHLIGHT_CHARS) : text;
  const re = new RegExp(regexFor(list).source, "gi");
  const out: HighlightSegment[] = [];
  let last = 0;
  let hits = 0;
  let m: RegExpExecArray | null;
  while (hits < MAX_HIGHLIGHT_HITS && (m = re.exec(scan)) !== null) {
    if (m[0].length === 0) { re.lastIndex += 1; continue; }
    const end = m.index + m[0].length;
    const before = m.index > 0 ? scan[m.index - 1] : "";
    const after = scan[end] ?? "";
    if ((LATIN.test(m[0][0]) && before && LATIN.test(before)) || (LATIN.test(m[0][m[0].length - 1]) && after && LATIN.test(after))) {
      re.lastIndex = m.index + 1;
      continue;
    }
    if (m.index > last) out.push({ text: text.slice(last, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    last = end;
    hits++;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}

/** Brand name + aliases (+ extra terms) as one highlight term list. */
export function brandTermsOf(brandName: string | null | undefined, aliases?: ReadonlyArray<string> | null, extra?: ReadonlyArray<string> | null): string[] {
  return normalizeTerms([brandName, ...(aliases ?? []), ...(extra ?? [])]);
}
