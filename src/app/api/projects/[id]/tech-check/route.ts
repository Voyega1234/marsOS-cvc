import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ─── Technical SEO — real, stateless, server-side checks ─────────────────────
//  ไม่มีการเก็บผลลัพธ์ลง DB — คำนวณสดทุกครั้งที่กด "ตรวจเว็บเบื้องต้น"

const FETCH_TIMEOUT_MS = 10_000;
const MAX_READ_BYTES = 500_000;
const UA_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; MarsOS-TechCheck/1.0)" };

type CheckStatus = "pass" | "warn" | "fail";

interface TechCheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

function errMsg(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "TimeoutError" || e.name === "AbortError") return "หมดเวลาเชื่อมต่อ (timeout)";
    return e.message;
  }
  return "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ";
}

function normalizeWebsite(raw: string): { origin: string; host: string } | null {
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const u = new URL(withProto);
    if (!u.host) return null;
    return { origin: `https://${u.host}`, host: u.host };
  } catch {
    return null;
  }
}

/** อ่าน body สูงสุด capBytes เพื่อไม่โหลดหน้าใหญ่เกินจำเป็น */
async function readCapped(res: Response, capBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return text.slice(0, capBytes);
  }
  const decoder = new TextDecoder();
  let result = "";
  let received = 0;
  while (received < capBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    result += decoder.decode(value, { stream: true });
  }
  try {
    await reader.cancel();
  } catch {
    // ignore
  }
  return result;
}

// ─── individual checks ─────────────────────────────────────────────────────

async function checkReachable(origin: string) {
  const start = Date.now();
  try {
    const res = await fetch(origin, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: UA_HEADERS,
    });
    const ms = Date.now() - start;
    if (!res.ok) {
      return { status: "fail" as CheckStatus, detail: `โหลดหน้าแรกไม่สำเร็จ HTTP ${res.status} (${ms}ms)`, res: null as Response | null, ms };
    }
    const chainNote = res.redirected ? ` (เปลี่ยนเส้นทางไปยัง ${res.url})` : "";
    return { status: "pass" as CheckStatus, detail: `เข้าถึงหน้าแรกได้ HTTP ${res.status} ใน ${ms}ms${chainNote}`, res, ms };
  } catch (e) {
    return { status: "fail" as CheckStatus, detail: `เชื่อมต่อหน้าแรกไม่สำเร็จ (${errMsg(e)})`, res: null as Response | null, ms: Date.now() - start };
  }
}

async function checkHttpsRedirect(host: string) {
  try {
    const res = await fetch(`http://${host}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: UA_HEADERS,
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location") || "";
      if (location.startsWith("https://")) {
        return { status: "pass" as CheckStatus, detail: `http://${host} เปลี่ยนเส้นทางไปยัง ${location} (HTTP ${res.status})` };
      }
      return { status: "warn" as CheckStatus, detail: `http://${host} เปลี่ยนเส้นทาง (HTTP ${res.status}) แต่ปลายทางไม่ใช่ https: ${location || "ไม่ระบุ"}` };
    }
    if (res.status >= 200 && res.status < 300) {
      return { status: "fail" as CheckStatus, detail: `http://${host} ตอบกลับ HTTP ${res.status} โดยไม่เปลี่ยนเส้นทางไปยัง https` };
    }
    return { status: "warn" as CheckStatus, detail: `http://${host} ตอบกลับ HTTP ${res.status}` };
  } catch (e) {
    return { status: "warn" as CheckStatus, detail: `ไม่สามารถเชื่อมต่อ http://${host} ได้ (${errMsg(e)})` };
  }
}

async function checkRobots(origin: string) {
  try {
    const res = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: UA_HEADERS });
    if (!res.ok) {
      return { status: "warn" as CheckStatus, detail: `ไม่พบ robots.txt (HTTP ${res.status})`, sitemapFromRobots: null as string | null };
    }
    const text = await readCapped(res, MAX_READ_BYTES);
    const lines = text.split(/\r?\n/);
    let inStarBlock = false;
    let disallowRoot = false;
    let sitemapLine: string | null = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^user-agent:\s*\*/i.test(trimmed)) inStarBlock = true;
      else if (/^user-agent:/i.test(trimmed)) inStarBlock = false;
      if (inStarBlock && /^disallow:\s*\/\s*$/i.test(trimmed)) disallowRoot = true;
      const sm = trimmed.match(/^sitemap:\s*(\S+)/i);
      if (sm) sitemapLine = sm[1];
    }
    if (disallowRoot) {
      return {
        status: "fail" as CheckStatus,
        detail: "robots.txt บล็อกทั้งเว็บไซต์ด้วย 'Disallow: /' สำหรับ User-agent: *",
        sitemapFromRobots: sitemapLine,
      };
    }
    if (!sitemapLine) {
      return { status: "warn" as CheckStatus, detail: "พบ robots.txt แต่ไม่มีการระบุ Sitemap:", sitemapFromRobots: null };
    }
    return { status: "pass" as CheckStatus, detail: `robots.txt ปกติ และระบุ Sitemap: ${sitemapLine}`, sitemapFromRobots: sitemapLine };
  } catch (e) {
    return { status: "warn" as CheckStatus, detail: `ไม่สามารถตรวจสอบ robots.txt ได้ (${errMsg(e)})`, sitemapFromRobots: null };
  }
}

async function checkSitemap(origin: string, sitemapFromRobots: string | null) {
  const url = sitemapFromRobots || `${origin}/sitemap.xml`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: UA_HEADERS });
    if (!res.ok) {
      return { status: "fail" as CheckStatus, detail: `ไม่พบ sitemap ที่ ${url} (HTTP ${res.status})` };
    }
    const xml = await readCapped(res, MAX_READ_BYTES);
    const trimmed = xml.trimStart();
    const isValidXml = trimmed.startsWith("<?xml") || /^<urlset/i.test(trimmed) || /^<sitemapindex/i.test(trimmed);
    if (!isValidXml) {
      return { status: "fail" as CheckStatus, detail: `${url} ไม่ใช่ XML sitemap ที่ถูกต้อง` };
    }
    const locCount = (xml.match(/<loc>/gi) || []).length;
    if (locCount === 0) {
      return { status: "warn" as CheckStatus, detail: `${url} เป็น XML ที่ถูกต้องแต่ไม่พบ URL (<loc>) ภายใน` };
    }
    return { status: "pass" as CheckStatus, detail: `พบ sitemap ที่ ${url} มี ${locCount} URL (นับจากข้อมูลที่อ่านได้)` };
  } catch (e) {
    return { status: "fail" as CheckStatus, detail: `ไม่สามารถตรวจสอบ sitemap ได้ (${errMsg(e)})` };
  }
}

async function checkWwwConsistency(host: string) {
  const isWww = host.startsWith("www.");
  const altHost = isWww ? host.slice(4) : `www.${host}`;
  try {
    const res = await fetch(`https://${altHost}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: UA_HEADERS,
    });
    if (!res.ok) {
      return { status: "warn" as CheckStatus, detail: `https://${altHost} ตอบกลับ HTTP ${res.status}` };
    }
    const finalHost = (() => {
      try {
        return new URL(res.url).host;
      } catch {
        return "";
      }
    })();
    if (finalHost === host) {
      return { status: "pass" as CheckStatus, detail: `https://${altHost} เปลี่ยนเส้นทางไปยังโดเมนหลัก ${host} อย่างถูกต้อง` };
    }
    if (finalHost === altHost) {
      return {
        status: "warn" as CheckStatus,
        detail: `https://${altHost} เข้าถึงได้โดยไม่เปลี่ยนเส้นทางมาที่โดเมนหลัก (${host}) อาจเกิด duplicate content`,
      };
    }
    return { status: "warn" as CheckStatus, detail: `https://${altHost} เปลี่ยนเส้นทางไปยัง ${finalHost} ซึ่งไม่ตรงกับโดเมนหลัก` };
  } catch (e) {
    return { status: "pass" as CheckStatus, detail: `https://${altHost} เข้าถึงไม่ได้ (${errMsg(e)}) — มีโดเมนหลักเพียงชุดเดียว` };
  }
}

function checkHomepageHtml(html: string): TechCheckResult[] {
  const results: TechCheckResult[] = [];

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  results.push(
    titleMatch && titleMatch[1].trim()
      ? { id: "html-title", label: "Title tag", status: "pass", detail: `พบ <title>: "${titleMatch[1].trim().slice(0, 80)}"` }
      : { id: "html-title", label: "Title tag", status: "fail", detail: "ไม่พบ <title> หรือว่างเปล่าบนหน้าแรก" }
  );

  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]*>/i);
  const descContent = descMatch ? descMatch[0].match(/content=["']([^"']*)["']/i) : null;
  results.push(
    descContent && descContent[1].trim()
      ? { id: "html-meta-description", label: "Meta description", status: "pass", detail: "พบ meta description บนหน้าแรก" }
      : { id: "html-meta-description", label: "Meta description", status: "warn", detail: "ไม่พบ meta description บนหน้าแรก" }
  );

  const h1Matches = html.match(/<h1[^>]*>/gi) || [];
  results.push(
    h1Matches.length === 1
      ? { id: "html-h1", label: "H1 เดียวต่อหน้า", status: "pass", detail: "พบ <h1> 1 แท็กบนหน้าแรก" }
      : h1Matches.length === 0
        ? { id: "html-h1", label: "H1 เดียวต่อหน้า", status: "fail", detail: "ไม่พบ <h1> บนหน้าแรก" }
        : { id: "html-h1", label: "H1 เดียวต่อหน้า", status: "warn", detail: `พบ <h1> จำนวน ${h1Matches.length} แท็กบนหน้าแรก (ควรมีเพียง 1)` }
  );

  const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  results.push(
    hasViewport
      ? { id: "html-viewport", label: "Viewport meta tag", status: "pass", detail: "พบ meta viewport" }
      : { id: "html-viewport", label: "Viewport meta tag", status: "fail", detail: "ไม่พบ meta viewport (กระทบ mobile usability)" }
  );

  const hasCanonical = /<link[^>]+rel=["']canonical["']/i.test(html);
  results.push(
    hasCanonical
      ? { id: "html-canonical", label: "Canonical tag", status: "pass", detail: "พบ canonical link บนหน้าแรก" }
      : { id: "html-canonical", label: "Canonical tag", status: "warn", detail: "ไม่พบ canonical link บนหน้าแรก" }
  );

  const langMatch = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  results.push(
    langMatch
      ? { id: "html-lang", label: "lang attribute", status: "pass", detail: `พบ lang="${langMatch[1]}"` }
      : { id: "html-lang", label: "lang attribute", status: "warn", detail: "ไม่พบ lang attribute บนแท็ก <html>" }
  );

  const hasNoindex = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
  results.push(
    hasNoindex
      ? { id: "html-noindex", label: "Noindex meta tag", status: "fail", detail: "พบ meta robots noindex บนหน้าแรก — หน้าแรกจะไม่ถูก index!" }
      : { id: "html-noindex", label: "Noindex meta tag", status: "pass", detail: "ไม่พบ noindex บนหน้าแรก" }
  );

  return results;
}

// ─── route handler ──────────────────────────────────────────────────────────

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session!.user.role === "CLIENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const project = await prisma.project.findFirst({ where: { id: params.id, organizationId: orgId } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const normalized = normalizeWebsite(project.website || "");
  if (!normalized) {
    return NextResponse.json({ error: "โปรเจกต์นี้ยังไม่ได้ตั้งค่า website ที่ถูกต้อง" }, { status: 400 });
  }
  const { origin, host } = normalized;

  const results: TechCheckResult[] = [];

  const reachable = await checkReachable(origin);
  results.push({ id: "site-reachable", label: "เข้าถึงหน้าแรกได้", status: reachable.status, detail: reachable.detail });

  const httpsRedirect = await checkHttpsRedirect(host);
  results.push({ id: "https-redirect", label: "http เปลี่ยนเส้นทางไปยัง https", status: httpsRedirect.status, detail: httpsRedirect.detail });

  const robots = await checkRobots(origin);
  results.push({ id: "robots-txt", label: "robots.txt", status: robots.status, detail: robots.detail });

  const sitemap = await checkSitemap(origin, robots.sitemapFromRobots);
  results.push({ id: "sitemap-xml", label: "Sitemap", status: sitemap.status, detail: sitemap.detail });

  const www = await checkWwwConsistency(host);
  results.push({ id: "www-consistency", label: "ความสอดคล้อง www / non-www", status: www.status, detail: www.detail });

  if (reachable.res) {
    try {
      const html = await readCapped(reachable.res, MAX_READ_BYTES);
      results.push(...checkHomepageHtml(html));
    } catch (e) {
      results.push({ id: "html-checks", label: "ตรวจสอบ HTML หน้าแรก", status: "warn", detail: `ไม่สามารถอ่านเนื้อหา HTML ของหน้าแรกได้ (${errMsg(e)})` });
    }
  } else {
    results.push({ id: "html-checks", label: "ตรวจสอบ HTML หน้าแรก", status: "warn", detail: "ข้ามการตรวจสอบ เนื่องจากเข้าถึงหน้าแรกไม่ได้" });
  }

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    website: origin,
    results,
  });
}
