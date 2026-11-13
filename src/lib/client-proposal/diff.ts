export interface DiffPart { type: "same" | "del" | "ins"; text: string }

function tokenize(s: string): string[] {
  if (!s) return [];
  if (typeof Intl !== "undefined" && typeof (Intl as { Segmenter?: unknown }).Segmenter === "function") {
    try {
      const seg = new Intl.Segmenter("th", { granularity: "word" });
      return Array.from(seg.segment(s), (x) => x.segment);
    } catch { /* fall through */ }
  }
  return s.split(/(\s+)/).filter((t) => t !== "");
}

function push(parts: DiffPart[], type: DiffPart["type"], text: string): void {
  if (!text) return;
  const last = parts[parts.length - 1];
  if (last && last.type === type) last.text += text;
  else parts.push({ type, text });
}

export function diffWords(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ type: "same", text: before }] : [];
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length * b.length > 4_000_000) {
    const out: DiffPart[] = [];
    push(out, "del", before);
    push(out, "ins", after);
    return out;
  }
  const n = a.length, m = b.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const out: DiffPart[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push(out, "same", a[i]); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { push(out, "del", a[i]); i++; }
    else { push(out, "ins", b[j]); j++; }
  }
  while (i < n) push(out, "del", a[i++]);
  while (j < m) push(out, "ins", b[j++]);
  return out;
}
