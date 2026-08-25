/**
 * Website Context Scan — อ่าน "บริบทธุรกิจ" จากหน้าเว็บลูกค้าเท่านั้น
 * (title, meta description, H1/H2, เมนู nav, path ภายใน → slug convention)
 * ไม่ใช่ technical SEO audit — ไม่เช็ค speed/schema/broken link ใด ๆ
 */

import type { WebsiteContext } from './types';

const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 1_500_000;

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAll(html: string, re: RegExp, max: number): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < max) {
    const text = stripTags(m[1] ?? '');
    if (text && text.length <= 200 && !out.includes(text)) out.push(text);
  }
  return out;
}

function detectSlugConvention(paths: string[]): WebsiteContext['slugConvention'] {
  if (!paths.length) return 'unknown';
  let latin = 0;
  let thai = 0;
  for (const p of paths) {
    const decoded = (() => { try { return decodeURIComponent(p); } catch { return p; } })();
    if (/[฀-๿]/.test(decoded)) thai++;
    else if (/[a-z0-9-]/i.test(decoded.replace(/[/._]/g, ''))) latin++;
  }
  if (thai > 0 && latin > 0) return 'mixed';
  if (thai > 0) return 'thai';
  if (latin > 0) return 'latin';
  return 'unknown';
}

export async function scanWebsiteContext(rawUrl: string): Promise<WebsiteContext> {
  const fetchedAt = new Date().toISOString();
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const base: WebsiteContext = {
    url,
    title: null,
    metaDescription: null,
    h1: [],
    h2: [],
    navLabels: [],
    existingPaths: [],
    slugConvention: 'unknown',
    fetchedAt,
    status: 'failed',
  };

  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return { ...base, error: 'URL ไม่ถูกต้อง' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return { ...base, error: `HTTP ${res.status}` };

    let html = await res.text();
    if (html.length > MAX_HTML_BYTES) html = html.slice(0, MAX_HTML_BYTES);

    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const descMatch =
      /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i.exec(html) ||
      /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["']/i.exec(html);

    const h1 = extractAll(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi, 5);
    const h2 = extractAll(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi, 20);

    // nav labels: ข้อความใน <a> ภายใน <nav>/<header> (หยาบพอสำหรับบริบท)
    const navBlocks = html.match(/<(?:nav|header)[\s\S]*?<\/(?:nav|header)>/gi) ?? [];
    const navLabels: string[] = [];
    for (const block of navBlocks) {
      for (const label of extractAll(block, /<a[^>]*>([\s\S]*?)<\/a>/gi, 40)) {
        if (label.length <= 60 && !navLabels.includes(label)) navLabels.push(label);
        if (navLabels.length >= 30) break;
      }
    }

    // internal paths → slug convention + ตรวจ slug ซ้ำกับหน้าเดิม
    const paths = new Set<string>();
    const hrefRe = /<a[^>]+href=["']([^"'#?]+)[^"']*["']/gi;
    let hm: RegExpExecArray | null;
    while ((hm = hrefRe.exec(html)) !== null && paths.size < 200) {
      const href = hm[1].trim();
      let path: string | null = null;
      if (href.startsWith('/')) path = href;
      else if (href.startsWith(origin)) path = href.slice(origin.length) || '/';
      if (!path || path === '/' || /\.(?:jpg|jpeg|png|gif|svg|webp|css|js|pdf|xml|ico)$/i.test(path)) continue;
      paths.add(path.replace(/\/+$/, ''));
    }

    return {
      ...base,
      status: 'ok',
      title: titleMatch ? stripTags(titleMatch[1]).slice(0, 300) || null : null,
      metaDescription: descMatch ? stripTags(descMatch[1]).slice(0, 500) || null : null,
      h1,
      h2,
      navLabels,
      existingPaths: Array.from(paths),
      slugConvention: detectSlugConvention(Array.from(paths)),
    };
  } catch (err) {
    const message = err instanceof Error ? (err.name === 'AbortError' ? 'timeout' : err.message) : String(err);
    return { ...base, error: message.slice(0, 200) };
  }
}
