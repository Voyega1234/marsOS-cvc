/**
 * Website Context Scan — อ่าน "บริบทธุรกิจ" จากหน้าเว็บลูกค้าเท่านั้น
 * (title, meta description, H1/H2, เมนู nav, path ภายใน → slug convention)
 * ไม่ใช่ technical SEO audit — ไม่เช็ค speed/schema/broken link ใด ๆ
 */

import type { WebsiteContext } from './types';

const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 1_500_000;
const SITEMAP_TIMEOUT_MS = 8_000;
const MAX_SITEMAP_PATHS = 1_000;
const MAX_CRAWL_PATHS = 400;
const CRAWL_CONCURRENCY = 5;
const CRAWL_PAGE_TIMEOUT_MS = 6_000;
const CRAWL_BUDGET_MS = 25_000;
// ต่ำกว่านี้ถือว่า "อ่านหน้าเว็บได้ไม่ครบ" — เว็บจริงที่มีบทความมักมีมากกว่านี้เสมอ
const CRAWL_TRIGGER_PATHS = 30;
// ดึง title ของหน้าที่มีอยู่แล้ว — จำเป็นกับเว็บไทยที่ slug เป็นอังกฤษ
// (/accounting-service ไม่มีวันตรงกับคีย์เวิร์ด "รับทำบัญชี" ถ้าเทียบแค่ slug)
// ยิง HTTP ตรง ไม่มีค่า API — คุมด้วยจำนวนหน้า/ความขนาน/งบเวลา
// เว็บ WordPress ไทยจริงตอบหน้าละ ~3 วิ ยิงขนานเยอะ+timeout สั้นแล้วได้ 0 เรื่องทุกหน้า
// (เคสจริง: 8 ขนาน/timeout 5 วิ → titles=0 ทั้งที่ยิงเดี่ยวสำเร็จหมด)
const MAX_TITLE_FETCH = 200;
const TITLE_CONCURRENCY = 6;
const TITLE_PAGE_TIMEOUT_MS = 12_000;
const TITLE_BUDGET_MS = 150_000;
// WordPress REST — ทางลัดที่เร็วกว่าไล่เปิดทีละหน้าเป็นสิบเท่า (100 ชื่อเรื่อง/คำขอ ~1.3 วิ)
// เว็บลูกค้าไทยส่วนใหญ่เป็น WordPress และเปิด /wp-json ไว้ตามค่าเริ่มต้น
const WP_MAX_PAGES = 5;
const WP_TIMEOUT_MS = 20_000;

/**
 * ยิง HTTP พร้อม timeout — ลองซ้ำได้ (default 1 ครั้ง)
 * เว็บลูกค้าจริงตอบช้า/หลุดเป็นครั้งคราว ถ้าพลาดครั้งเดียวแล้วยอมแพ้ กลไกกันบทความซ้ำจะตายทั้งรัน
 * (เคสจริง: robots.txt + หน้าแรกหลุดพร้อมกัน → สแกนล้ม → ไม่มี existingPaths เลยสักหน้า)
 */
async function fetchTextWithTimeout(url: string, accept: string, timeoutMs: number, retries = 1): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const out = await fetchTextOnce(url, accept, timeoutMs);
    if (out !== null) return out;
    if (attempt < retries) await new Promise(r => setTimeout(r, 800));
  }
  return null;
}

async function fetchTextOnce(url: string, accept: string, timeoutMs: number): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: accept,
      },
    });
    try {
      if (!res.ok) return null;
      const text = await res.text();
      return text.length > MAX_HTML_BYTES ? text.slice(0, MAX_HTML_BYTES) : text;
    } finally {
      // เคลียร์ timer หลังอ่าน body จบ — ถ้าเคลียร์ตอนได้ header เซิร์ฟเวอร์ที่ส่งช้า
      // แบบหยดน้ำจะค้างเกิน timeout ที่ตั้งไว้
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * อ่าน sitemap ของเว็บ (เช็ค robots.txt ก่อน ไม่เจอค่อยลอง /sitemap.xml) → path ภายในทั้งหมด
 * นี่คือแหล่ง "หน้าเดิมของเว็บ" ที่ครบที่สุด — ลิงก์บนหน้าแรกเห็นแค่บางส่วน แต่ sitemap
 * เห็นทุกบทความ ใช้กันไม่ให้ keyword research เสนอ slug ซ้ำกับหน้าที่มีอยู่แล้ว
 * รองรับ sitemap index (ตามลูกไม่เกิน 5 ไฟล์) — ล้มเหลวเงียบ ๆ ไม่ทำให้รันพัง
 */
/**
 * www.example.com กับ example.com = เว็บเดียวกัน
 * robots.txt ที่ Yoast/WordPress สร้าง มักชี้ sitemap ข้าม www ไปมาเป็นปกติ
 * (เจอจริง: www.inflowaccount.co.th/robots.txt ชี้ไป inflowaccount.co.th/sitemap_index.xml)
 * ถ้าเทียบ origin ตรง ๆ จะตกทั้งเว็บ แล้วได้หน้าที่มีอยู่แล้ว 0 หน้าแบบเงียบ ๆ
 */
function sameSite(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname.replace(/^www\./i, '').toLowerCase();
    const hb = new URL(b).hostname.replace(/^www\./i, '').toLowerCase();
    return !!ha && ha === hb;
  } catch { return false; }
}

/** คืน path ถ้า href ชี้ในเว็บเดียวกัน (รับทั้ง relative, absolute และ protocol-relative) */
function samePath(href: string, origin: string): string | null {
  try {
    if (href.startsWith('//')) {
      const u = new URL(`${new URL(origin).protocol}${href}`);
      return sameSite(u.href, origin) ? (u.pathname || '/') : null;
    }
    if (href.startsWith('/')) return href;
    if (!/^https?:\/\//i.test(href)) return null;
    const u = new URL(href);
    return sameSite(u.href, origin) ? (u.pathname || '/') : null;
  } catch { return null; }
}

async function fetchSitemapPaths(origin: string): Promise<string[]> {
  const paths = new Set<string>();
  const parseLocs = (xml: string): string[] =>
    Array.from(xml.matchAll(/<loc[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi))
      .map(m => m[1].trim())
      .filter(Boolean);
  try {
    let sitemapUrls: string[] = [];
    const robots = await fetchTextWithTimeout(`${origin}/robots.txt`, 'text/plain', SITEMAP_TIMEOUT_MS);
    if (robots) {
      sitemapUrls = Array.from(robots.matchAll(/^sitemap:\s*(\S+)/gim)).map(m => m[1]);
    }
    if (!sitemapUrls.length) sitemapUrls = [`${origin}/sitemap.xml`];
    const queue = sitemapUrls.slice(0, 3);
    let fetched = 0;
    while (queue.length && fetched < 5 && paths.size < MAX_SITEMAP_PATHS) {
      const smUrl = queue.shift()!;
      fetched++;
      const xml = await fetchTextWithTimeout(smUrl, 'application/xml,text/xml,*/*', SITEMAP_TIMEOUT_MS);
      if (!xml) continue;
      for (const loc of parseLocs(xml)) {
        if (/\.xml(\.gz)?$/i.test(loc)) {
          // ตาม sitemap ลูกเฉพาะโดเมนเดียวกัน — sitemap ชี้ออกนอกโดเมนได้ ไม่ควรตามไปยิง
          if (!sameSite(loc, origin)) continue;
          if (queue.length < 5) queue.push(loc);
          continue;
        }
        const locPath = samePath(loc, origin);
        if (locPath) {
          const p = locPath.replace(/\/+$/, '');
          if (p && p !== '/') paths.add(p);
        }
        if (paths.size >= MAX_SITEMAP_PATHS) break;
      }
    }
  } catch { /* sitemap เป็นของเสริม — อ่านไม่ได้ก็ใช้ลิงก์จากหน้าแรกตามเดิม */ }
  return Array.from(paths);
}

/**
 * Crawler สำรอง — ใช้เมื่อเว็บไม่มี sitemap (หรือ sitemap ให้หน้าน้อยผิดปกติ)
 * ไล่ตามลิงก์ภายในแบบ BFS จากหน้าแรก เก็บเฉพาะ "path" ไม่เก็บเนื้อหา
 * มี deadline รวมกันเวลาไม่บาน และไม่มีค่า API ใด ๆ (ยิง HTTP ตรงอย่างเดียว)
 */
async function crawlInternalPaths(origin: string, seedPaths: string[], budgetMs: number): Promise<string[]> {
  const deadline = Date.now() + budgetMs;
  const found = new Set<string>(seedPaths);
  const visited = new Set<string>();
  let frontier = seedPaths.slice(0, 40);
  const SKIP_EXT = /\.(?:jpg|jpeg|png|gif|svg|webp|css|js|pdf|xml|ico|zip|mp4|woff2?)$/i;

  for (let depth = 0; depth < 2 && frontier.length && Date.now() < deadline; depth++) {
    const next: string[] = [];
    for (let i = 0; i < frontier.length && Date.now() < deadline && found.size < MAX_CRAWL_PATHS; i += CRAWL_CONCURRENCY) {
      const batch = frontier.slice(i, i + CRAWL_CONCURRENCY).filter(p => !visited.has(p));
      if (!batch.length) continue;
      batch.forEach(p => visited.add(p));
      const pages = await Promise.all(
        batch.map(p => fetchTextWithTimeout(`${origin}${p}`, 'text/html,application/xhtml+xml', CRAWL_PAGE_TIMEOUT_MS))
      );
      for (const html of pages) {
        if (!html) continue;
        const hrefRe = /<a[^>]+href=["']([^"'#?]+)[^"']*["']/gi;
        let m: RegExpExecArray | null;
        while ((m = hrefRe.exec(html)) !== null && found.size < MAX_CRAWL_PATHS) {
          const href = m[1].trim();
          const path = samePath(href, origin);
          if (!path || path === '/' || SKIP_EXT.test(path)) continue;
          const clean = path.replace(/\/+$/, '');
          if (!clean || found.has(clean)) continue;
          found.add(clean);
          next.push(clean);
        }
      }
    }
    frontier = next;
  }
  return Array.from(found);
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // entity ตัวเลข (&#8211; ฯลฯ) — WordPress ใส่มาในชื่อเรื่องเป็นปกติ
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
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

/**
 * อ่าน <title> + <h1> ของหน้าที่มีอยู่แล้ว เพื่อใช้เทียบ "เรื่องซ้ำ" กับคีย์เวิร์ดที่จะเสนอ
 * ตัดหางแบรนด์ออก ("… | ชื่อบริษัท", "… - ชื่อบริษัท") เพราะไม่ใช่เนื้อเรื่องของหน้า
 * ล้มเหลวรายหน้า = ข้ามเงียบ ๆ ไม่ทำให้การสแกนพัง
 */
/**
 * ดึงชื่อเรื่องจาก WordPress REST API (posts + pages)
 * เร็วกว่าเปิดทีละหน้ามาก และได้ครบกว่า — เว็บที่ไม่ใช่ WordPress จะคืน [] แล้วไปใช้วิธีเปิดหน้าแทน
 */
async function fetchWpTitles(origin: string): Promise<string[]> {
  const titles: string[] = [];
  for (const type of ['posts', 'pages'] as const) {
    for (let page = 1; page <= WP_MAX_PAGES; page++) {
      const url = `${origin}/wp-json/wp/v2/${type}?per_page=100&page=${page}&_fields=title`;
      const body = await fetchTextWithTimeout(url, 'application/json', WP_TIMEOUT_MS, page === 1 ? 1 : 0);
      if (!body) break;
      let rows: Array<{ title?: { rendered?: string } }>;
      try {
        const parsed = JSON.parse(body);
        if (!Array.isArray(parsed)) break;
        rows = parsed;
      } catch {
        break;
      }
      if (!rows.length) break;
      for (const row of rows) {
        const clean = stripTags(String(row?.title?.rendered ?? '')).trim();
        if (clean.length >= 6) titles.push(clean.slice(0, 200));
      }
      if (rows.length < 100) break;
    }
  }
  return titles;
}

async function fetchPageTitles(origin: string, paths: string[], budgetMs: number): Promise<string[]> {
  // ลอง WordPress REST ก่อน — ได้ครบและเร็วกว่า ถ้าเว็บไม่ใช่ WordPress ค่อยไล่เปิดทีละหน้า
  const wp = await fetchWpTitles(origin);
  if (wp.length >= 20) return wp;
  const deadline = Date.now() + budgetMs;
  const titles: string[] = [...wp];
  const targets = paths.slice(0, MAX_TITLE_FETCH);
  for (let i = 0; i < targets.length; i += TITLE_CONCURRENCY) {
    if (Date.now() > deadline) break;
    const batch = targets.slice(i, i + TITLE_CONCURRENCY);
    const htmls = await Promise.all(
      // หน้า title ไม่ลองซ้ำ — 200 หน้า × 2 ครั้งกินงบเวลาจนได้ title น้อยลงกว่าเดิม
      batch.map(pth => fetchTextWithTimeout(`${origin}${pth}`, 'text/html,application/xhtml+xml', TITLE_PAGE_TIMEOUT_MS, 0))
    );
    for (const html of htmls) {
      if (!html) continue;
      const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const h = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      for (const raw of [t?.[1], h?.[1]]) {
        if (!raw) continue;
        const clean = stripTags(raw).split(/\s[|–—-]\s/)[0].trim();
        if (clean.length >= 6) titles.push(clean.slice(0, 200));
      }
    }
  }
  return titles;
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
    existingTitles: [],
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

  // อ่าน sitemap ขนานไปกับหน้าแรก — ได้ "ทุกหน้าที่มีอยู่จริง" ไม่ใช่แค่ลิงก์บนหน้าแรก
  const sitemapPromise = fetchSitemapPaths(origin);

  try {
    // หน้าแรกหลุดชั่วคราวได้ (เว็บลูกค้าตอบช้า/ตัดการเชื่อมต่อ) — ลองซ้ำอีกครั้งก่อนยอมแพ้
    // แพ้ตั้งแต่ครั้งแรก = ทั้งรันไม่มี existingPaths แล้วเสนอคีย์เวิร์ดซ้ำกับหน้าเดิมทันที
    let res: Response | null = null;
    let html = '';
    let fetchErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      // จับเวลาคลุมถึงตอนอ่าน body ด้วย — เซิร์ฟเวอร์ที่ส่งแบบหยดน้ำทำให้ค้างเกิน timeout ได้
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        res = await fetch(url, {
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml',
          },
        });
        if (res.ok) html = await res.text();
        fetchErr = null;
        break;
      } catch (e) {
        fetchErr = e;
        res = null;
      } finally {
        clearTimeout(timer);
      }
      await new Promise(r => setTimeout(r, 800));
    }
    if (fetchErr || !res) throw fetchErr ?? new Error('fetch ไม่สำเร็จ');
    if (!res.ok) {
      // เว็บที่กัน bot มักตอบ 403 ที่หน้าแรกแต่เปิด /sitemap.xml ให้ — ถ้ายังอ่าน sitemap ได้
      // ต้องใช้ต่อ ไม่งั้นกลไกกันบทความซ้ำจะตายบนเว็บกลุ่มที่ต้องใช้มากที่สุด
      let salvaged = await sitemapPromise;
      // รอบแรกอาจหลุดพร้อมกับหน้าแรก (เน็ตสะดุด/เว็บตอบช้าเป็นช่วง) — ยิง sitemap ใหม่อีกรอบ
      // ก่อนยอมทิ้ง existingPaths ทั้งรัน เพราะไม่มี path = กันบทความซ้ำไม่ได้เลย
      if (!salvaged.length) salvaged = await fetchSitemapPaths(origin);
      if (salvaged.length) {
        return {
          ...base,
          status: 'ok',
          existingPaths: salvaged,
          existingTitles: await fetchPageTitles(origin, salvaged, TITLE_BUDGET_MS),
          slugConvention: detectSlugConvention(salvaged),
          error: `หน้าแรกตอบ HTTP ${res.status} แต่อ่าน sitemap สำเร็จ`,
        };
      }
      return { ...base, error: `HTTP ${res.status}` };
    }

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
      const path = samePath(href, origin);
      if (!path || path === '/' || /\.(?:jpg|jpeg|png|gif|svg|webp|css|js|pdf|xml|ico)$/i.test(path)) continue;
      paths.add(path.replace(/\/+$/, ''));
    }

    for (const p of await sitemapPromise) {
      if (paths.size >= MAX_SITEMAP_PATHS + 200) break;
      paths.add(p);
    }

    // เว็บไม่มี sitemap (หรือมีแต่ไม่ครบ) → ไล่ตามลิงก์ต่ออีก 1 ชั้น ให้เห็นหน้าบทความจริง
    // ไม่งั้นจะรู้จักแค่หน้าที่ลิงก์อยู่บนหน้าแรก แล้วไปเสนอคีย์เวิร์ดซ้ำกับบทความเดิม
    if (paths.size < CRAWL_TRIGGER_PATHS) {
      for (const p of await crawlInternalPaths(origin, Array.from(paths), CRAWL_BUDGET_MS)) {
        paths.add(p);
      }
    }

    const allPaths = Array.from(paths);
    return {
      ...base,
      status: 'ok',
      title: titleMatch ? stripTags(titleMatch[1]).slice(0, 300) || null : null,
      metaDescription: descMatch ? stripTags(descMatch[1]).slice(0, 500) || null : null,
      h1,
      h2,
      navLabels,
      existingPaths: allPaths,
      existingTitles: await fetchPageTitles(origin, allPaths, TITLE_BUDGET_MS),
      slugConvention: detectSlugConvention(allPaths),
    };
  } catch (err) {
    const message = err instanceof Error ? (err.name === 'AbortError' ? 'timeout' : err.message) : String(err);
    // หน้าแรกอ่านไม่ได้ (เช่นเว็บกัน bot) แต่ sitemap อาจยังอ่านได้ — เก็บ path ไว้กันซ้ำต่อ
    let sitemapPaths = await sitemapPromise;
    // เช่นเดียวกับกรณี HTTP ไม่ 2xx — ลอง sitemap ซ้ำก่อนยอมแพ้ทั้งการสแกน
    if (!sitemapPaths.length) sitemapPaths = await fetchSitemapPaths(origin);
    if (sitemapPaths.length) {
      return {
        ...base,
        status: 'ok',
        existingPaths: sitemapPaths,
        existingTitles: await fetchPageTitles(origin, sitemapPaths, TITLE_BUDGET_MS),
        slugConvention: detectSlugConvention(sitemapPaths),
        error: `อ่านหน้าแรกไม่ได้ (${message.slice(0, 120)}) แต่อ่าน sitemap สำเร็จ`,
      };
    }
    return { ...base, error: message.slice(0, 200) };
  }
}
