/** ตรวจว่าหน้าที่ลิงก์อยู่ยังมีลิงก์ชี้มาหน้าลูกค้าหรือไม่ */
import { safeFetchHtml } from "./safe-fetch";
import type { CheckStatus } from "./types";

export interface AnalyzeResult {
  match: "EXACT" | "DOMAIN" | "NONE";
  rel: string;
  nofollow: boolean;
  anchorText: string;
  pageNoindex: boolean;
  pageNofollow: boolean;
}

function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  // ตัดชื่อแท็กออกก่อน
  const body = tag.replace(/^<\s*[a-zA-Z0-9]+/, "").replace(/\/?>$/, "");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = (m[2] ?? m[3] ?? m[4] ?? "").trim();
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&nbsp;/gi, " ");
}

function normHost(h: string): string {
  return h.toLowerCase().replace(/^www\./, "");
}

function normUrl(raw: string, base?: string): { host: string; key: string } | null {
  try {
    const u = new URL(decodeEntities(raw), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = normHost(u.hostname);
    const path = u.pathname.replace(/\/+$/, "");
    return { host, key: `${host}${path}${u.search}` };
  } catch {
    return null;
  }
}

export function analyzeHtml(html: string, pageUrl: string, targetUrl: string): AnalyzeResult {
  const target = normUrl(targetUrl);
  let best: { rank: number; rel: string; anchor: string } | null = null;

  if (target) {
    const re = /<a\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const attrs = parseAttrs(m[0]);
      if (!attrs.href) continue;
      const n = normUrl(attrs.href, pageUrl);
      if (!n) continue;
      let rank = 0;
      if (n.key === target.key) rank = 2;
      else if (n.host === target.host) rank = 1;
      if (!rank) continue;
      if (best && best.rank >= rank) continue;
      const after = html.slice(m.index + m[0].length, m.index + m[0].length + 2000);
      const close = after.search(/<\/a\s*>/i);
      const inner = close >= 0 ? after.slice(0, close) : after.slice(0, 200);
      const anchor = decodeEntities(inner.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
      best = { rank, rel: (attrs.rel ?? "").toLowerCase(), anchor };
      if (rank === 2 && !/nofollow|sponsored|ugc/.test(best.rel)) break; // เจอแบบ follow ตรงเป๊ะแล้ว
    }
  }

  let pageNoindex = false;
  let pageNofollow = false;
  const metaRe = /<meta\b[^>]*>/gi;
  let mm: RegExpExecArray | null;
  while ((mm = metaRe.exec(html))) {
    const a = parseAttrs(mm[0]);
    const name = (a.name ?? "").toLowerCase();
    if (name === "robots" || name === "googlebot") {
      const c = (a.content ?? "").toLowerCase();
      if (/\bnoindex\b|\bnone\b/.test(c)) pageNoindex = true;
      if (/\bnofollow\b|\bnone\b/.test(c)) pageNofollow = true;
    }
  }

  if (!best) {
    return { match: "NONE", rel: "", nofollow: false, anchorText: "", pageNoindex, pageNofollow };
  }
  return {
    match: best.rank === 2 ? "EXACT" : "DOMAIN",
    rel: best.rel,
    nofollow: /nofollow|sponsored|ugc/.test(best.rel),
    anchorText: best.anchor,
    pageNoindex,
    pageNofollow,
  };
}

export async function checkBacklink(
  liveUrl: string,
  targetUrl: string,
): Promise<{ status: CheckStatus; detail: string; rel: string }> {
  const r = await safeFetchHtml(liveUrl);
  if (!r.ok) {
    if (r.reason === "BLOCKED") return { status: "BLOCKED", detail: `ระบบไม่อนุญาตให้ตรวจ URL นี้ (${r.detail})`, rel: "" };
    const why: Record<string, string> = {
      TIMEOUT: "หมดเวลาระหว่างเปิดหน้า",
      HTTP_ERROR: `เปิดหน้าไม่ได้ (${r.detail})`,
      NOT_HTML: "ปลายทางไม่ใช่หน้า HTML",
      NETWORK: `เชื่อมต่อไม่ได้ (${r.detail})`,
    };
    return { status: "PAGE_ERROR", detail: why[r.reason] ?? r.detail, rel: "" };
  }
  const a = analyzeHtml(r.html, r.finalUrl, targetUrl);
  const noindex = a.pageNoindex ? " · หน้านี้ตั้ง noindex" : "";
  if (a.match === "NONE") return { status: "LOST", detail: "ไม่พบลิงก์ที่ชี้มาหน้าลูกค้าบนหน้านี้", rel: "" };
  if (a.match === "DOMAIN") {
    return { status: "LOST", detail: "พบลิงก์ไปโดเมนเดียวกัน แต่เป็นคนละหน้ากับที่ระบุ", rel: a.rel };
  }
  if (a.nofollow || a.pageNofollow) {
    return {
      status: "NOFOLLOW",
      detail: `พบลิงก์ แต่เป็น nofollow${a.rel ? ` (rel="${a.rel}")` : ""}${a.pageNofollow ? " (meta robots nofollow)" : ""}${noindex}`,
      rel: a.rel,
    };
  }
  return { status: "LIVE", detail: `พบลิงก์ปกติ${a.anchorText ? ` · anchor "${a.anchorText.slice(0, 80)}"` : ""}${noindex}`, rel: a.rel };
}
