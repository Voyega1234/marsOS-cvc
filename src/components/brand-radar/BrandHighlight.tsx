import { splitByTerms } from "@/lib/brand-radar/highlight";
import { cn } from "@/lib/utils";

/** Green mark used wherever our own brand is highlighted inside an AI answer. */
export const BRAND_HIT_CLS = "rounded bg-emerald-200 px-0.5 font-semibold text-emerald-950 ring-1 ring-emerald-400 dark:bg-emerald-500/30 dark:text-emerald-100 dark:ring-emerald-400/50";

/** Row cue for an answer that mentions our brand (left border + light green wash). */
export const BRAND_ROW_CLS = "border-l-4 border-l-emerald-500 bg-emerald-50/60 dark:bg-emerald-500/10";

/**
 * Plain text with our brand terms marked. The text is untrusted AI output: it is only ever rendered as React text
 * nodes (never as HTML).
 */
export function BrandHighlight({ text, terms, className }: { text: string; terms: ReadonlyArray<string>; className?: string }) {
  const segs = splitByTerms(text, terms);
  return (
    <>
      {segs.map((s, i) => s.hit
        ? <mark key={i} title="แบรนด์เรา" className={cn(BRAND_HIT_CLS, className)}>{s.text}</mark>
        : s.text)}
    </>
  );
}
