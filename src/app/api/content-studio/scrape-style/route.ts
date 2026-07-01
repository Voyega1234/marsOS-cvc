import { NextRequest, NextResponse } from "next/server";

interface ScrapedStyle {
  colors: {
    theme: string | null;
    text: string | null;
    border: string | null;
    accent: string | null;
    background: string | null;
    allColors: string[];
  };
  typography: {
    fontFamily: string | null;
    fontSize: string | null;
    lineHeight: string | null;
    letterSpacing: string | null;
    headingFont: string | null;
    headingWeight: string | null;
  };
  spacing: {
    paragraphMargin: string | null;
    sectionPadding: string | null;
    maxWidth: string | null;
  };
  rawCss: string;
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

function normalizeColor(c: string): string | null {
  c = c.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(c)) {
    return "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  }
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  const m = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return rgbToHex(+m[1], +m[2], +m[3]);
  return null;
}

function isDark(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

function isVeryLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 220;
}

function isGrey(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min < 20; // low saturation = grey
}

function isColorful(hex: string): boolean {
  return !isGrey(hex) && !isVeryLight(hex);
}

function extractAllColors(css: string): string[] {
  const colors = new Set<string>();
  // hex
  let m: RegExpExecArray | null;
  const hexRe = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  while ((m = hexRe.exec(css)) !== null) {
    const n = normalizeColor(m[0]);
    if (n) colors.add(n);
  }
  // rgb/rgba
  const rgbRe = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
  while ((m = rgbRe.exec(css)) !== null) {
    const n = rgbToHex(+m[1], +m[2], +m[3]);
    colors.add(n);
  }
  return Array.from(colors);
}

function extractCssValue(css: string, ...props: string[]): string | null {
  for (const prop of props) {
    const re = new RegExp(`${prop}\\s*:\\s*([^;}{]+)`, "gi");
    const m = re.exec(css);
    if (m) return m[1].trim();
  }
  return null;
}

function extractBodyTypography(css: string): { fontFamily: string | null; fontSize: string | null; lineHeight: string | null; letterSpacing: string | null } {
  // look for body { ... } block
  const bodyBlock = css.match(/\bbody\s*\{([^}]+)\}/i)?.[1] ?? "";
  const articleBlock = css.match(/\.(?:article|content|post|entry|blog)[^{]*\{([^}]+)\}/i)?.[1] ?? "";
  const combined = bodyBlock + "\n" + articleBlock + "\n" + css;

  return {
    fontFamily: extractCssValue(combined, "font-family"),
    fontSize: extractCssValue(combined, "font-size"),
    lineHeight: extractCssValue(combined, "line-height"),
    letterSpacing: extractCssValue(combined, "letter-spacing"),
  };
}

function extractHeadingStyle(css: string): { headingFont: string | null; headingWeight: string | null } {
  const h1Block = css.match(/\bh[12]\s*\{([^}]+)\}/i)?.[1] ?? "";
  return {
    headingFont: extractCssValue(h1Block, "font-family"),
    headingWeight: extractCssValue(h1Block + "\n" + css, "font-weight"),
  };
}

function extractSpacing(css: string): { paragraphMargin: string | null; sectionPadding: string | null; maxWidth: string | null } {
  const pBlock = css.match(/\bp\s*\{([^}]+)\}/i)?.[1] ?? "";
  return {
    paragraphMargin: extractCssValue(pBlock, "margin-bottom", "margin"),
    sectionPadding: extractCssValue(css, "padding"),
    maxWidth: extractCssValue(css, "max-width"),
  };
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return NextResponse.json({ error: "URL ไม่ถูกต้อง" }, { status: 400 });
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return NextResponse.json({ error: "รองรับเฉพาะ http/https" }, { status: 400 });
    }

    // Fetch page HTML
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let html: string;
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; StyleScraper/1.0)",
          "Accept": "text/html,*/*",
        },
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } catch (e) {
      clearTimeout(timeout);
      throw new Error(`ดึงหน้าเว็บไม่ได้: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Extract inline <style> blocks + link[rel=stylesheet] href hints
    const styleBlocks: string[] = [];
    let sm: RegExpExecArray | null;
    const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    while ((sm = styleRe.exec(html)) !== null) styleBlocks.push(sm[1]);

    // Fetch up to 3 external stylesheets
    const cssHrefs: string[] = [];
    const linkRe1 = /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi;
    const linkRe2 = /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']stylesheet["']/gi;
    while ((sm = linkRe1.exec(html)) !== null) cssHrefs.push(sm[1]);
    while ((sm = linkRe2.exec(html)) !== null) cssHrefs.push(sm[1]);

    const fetchedCss: string[] = [];
    for (const href of cssHrefs.slice(0, 3)) {
      try {
        const absHref = href.startsWith("http") ? href : new URL(href, url).toString();
        const r = await fetch(absHref, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; StyleScraper/1.0)" },
          signal: AbortSignal.timeout(5000),
        });
        if (r.ok) fetchedCss.push(await r.text());
      } catch { /* skip */ }
    }

    const allCss = [...styleBlocks, ...fetchedCss].join("\n");
    const allColors = extractAllColors(allCss + html);

    // Deduplicate & classify
    const unique = Array.from(new Set(allColors));
    const colorful = unique.filter(isColorful);
    const darkColors = colorful.filter(isDark);
    const lightColors = colorful.filter(c => !isDark(c));
    const allDark = unique.filter(isDark);

    // Heuristic picks
    const themeColor = darkColors[0] ?? colorful[0] ?? null;
    const accentColor = colorful.find(c => c !== themeColor) ?? colorful[1] ?? null;
    const textColor = allDark.find(c => isGrey(c)) ?? "#1c1c1c";
    const borderColor = unique.find(c => isVeryLight(c) && !isGrey(c) ? false : isGrey(c) && !isDark(c)) ?? "#e2e8f0";
    const bgColor = unique.find(isVeryLight) ?? null;

    // Try to find colors in context (buttons, headings, links)
    let ctxTheme = themeColor;
    let ctxAccent = accentColor;
    const btnMatch = (allCss + html).match(/(?:button|\.btn|\.cta|primary)[^}]{0,300}?(?:#[0-9a-fA-F]{6})/i);
    if (btnMatch) {
      const m = btnMatch[0].match(/#[0-9a-fA-F]{6}/i);
      if (m) ctxTheme = m[0].toLowerCase();
    }
    const linkMatch = (allCss + html).match(/\ba\b[^}]{0,200}?(?:#[0-9a-fA-F]{6})/i);
    if (linkMatch) {
      const m = linkMatch[0].match(/#[0-9a-fA-F]{6}/i);
      if (m) ctxAccent = m[0].toLowerCase();
    }

    // Typography
    const typo = extractBodyTypography(allCss);
    const heading = extractHeadingStyle(allCss);
    const spacing = extractSpacing(allCss);

    const result: ScrapedStyle = {
      colors: {
        theme: ctxTheme,
        text: textColor,
        border: borderColor,
        accent: ctxAccent,
        background: bgColor,
        allColors: unique.slice(0, 40),
      },
      typography: {
        fontFamily: typo.fontFamily,
        fontSize: typo.fontSize,
        lineHeight: typo.lineHeight,
        letterSpacing: typo.letterSpacing,
        headingFont: heading.headingFont,
        headingWeight: heading.headingWeight,
      },
      spacing: {
        paragraphMargin: spacing.paragraphMargin,
        sectionPadding: spacing.sectionPadding,
        maxWidth: spacing.maxWidth,
      },
      rawCss: allCss.slice(0, 8000),
    };

    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
