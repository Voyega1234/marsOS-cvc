"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, Plus } from "lucide-react";
import { NAME_SUGGEST, cleanNames, localVariants, mergeSuggestions } from "@/lib/brand-radar/name-suggest";

/** Suggestions already fetched in this browser tab, by the names they were asked for. */
const cache = new Map<string, string[]>();
const DEBOUNCE_MS = 700;
const SHOWN_MAX = 12;

/**
 * Wraps the brand name field and lists other spellings of the names entered so far, one click to add each.
 * Spacing, hyphen and website variants are built here at once; Thai and English spellings come from the AI route.
 * The AI is asked only after the field has been focused, so opening a page spends nothing, and only when
 * the names the user typed change (adding a suggestion does not ask again).
 */
export default function BrandNameSuggestions({ names, website = "", projectId, max, onAdd, children }: {
  names: string[];
  website?: string;
  projectId?: string;
  max: number;
  /** Receives the names to append to the list */
  onAdd: (added: string[]) => void;
  children: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  const [ai, setAi] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiError, setAiError] = useState(false);
  /** Names that came from a suggestion: they are not sent back as new input. */
  const added = useRef(new Set<string>());
  const websiteRef = useRef(website);
  websiteRef.current = website;

  const typed = names.filter((n) => !added.current.has(n.toLowerCase()));
  const asked = cleanNames(typed.length ? typed : names);
  const key = asked.map((n) => n.toLowerCase()).sort().join("\n");
  const askedRef = useRef(asked);
  askedRef.current = asked;

  useEffect(() => {
    setAiError(false);
    if (!armed || !key) { setAi([]); setLoading(false); return; }
    const hit = cache.get(key);
    if (hit) { setAi(hit); setLoading(false); return; }
    setAi([]);
    setLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/brand-radar/name-suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ names: askedRef.current, website: websiteRef.current, projectId }),
          signal: ctrl.signal,
        });
        const data = (await res.json().catch(() => null)) as { names?: unknown; aiError?: unknown } | null;
        if (ctrl.signal.aborted) return;
        const list = cleanNames(data?.names, NAME_SUGGEST.resultMax);
        const failed = !res.ok || !!data?.aiError;
        if (!failed) cache.set(key, list);
        setAi(list);
        setAiError(failed);
      } catch {
        if (!ctrl.signal.aborted) setAiError(true);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [armed, key, projectId]);

  const room = Math.max(0, max - names.length);
  const suggestions = room > 0 ? mergeSuggestions(names, [ai, localVariants(names, website)], SHOWN_MAX) : [];
  const add = (list: string[]) => {
    const take = list.slice(0, room);
    if (!take.length) return;
    for (const n of take) added.current.add(n.toLowerCase());
    onAdd(take);
  };
  const show = room > 0 && names.length > 0 && (suggestions.length > 0 || loading || aiError);

  return (
    <div onFocusCapture={() => setArmed(true)}>
      {children}
      {show ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs" aria-live="polite">
          {suggestions.length > 0 ? <span className="text-gray-500">ชื่อแนะนำ (กดเพื่อเพิ่ม):</span> : null}
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add([s])}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-brand-blue/50 bg-white/90 px-2.5 py-1 text-brand-blue hover:bg-brand-mist"
            >
              <Plus className="h-3 w-3" />{s}
            </button>
          ))}
          {suggestions.length > 1 ? (
            <button type="button" onClick={() => add(suggestions)} className="px-1 text-brand-blue underline-offset-2 hover:underline">
              เพิ่มทั้งหมด
            </button>
          ) : null}
          {loading ? (
            <span className="inline-flex items-center gap-1 text-gray-500">
              <Loader2 className="h-3 w-3 animate-spin" /> กำลังหาชื่อไทย/อังกฤษและคำสะกดใกล้เคียง…
            </span>
          ) : null}
          {aiError ? <span className="text-amber-700">AI หาชื่อเพิ่มไม่สำเร็จ ลองแก้ชื่อแล้วรอสักครู่ หรือพิมพ์เพิ่มเองได้</span> : null}
        </div>
      ) : null}
    </div>
  );
}
