/**
 * Regression: ตำแหน่งสารบัญ (nav.content-toc) — placeToc / build-html / detectTocPosition / ปก text-mode / Elementor slot
 * Run: npx tsx src/lib/upload-article/toc-position.test.ts
 */
import { buildUploadArticleHtml } from './build-html';
import {
  placeToc, tocPositionOfHtml, sectionCountOfHtml, buildTocFromHeadings, detectTocPosition,
  majorityTocPosition, effectiveTocPosition, normalizeTocPosition,
} from './toc-position';
import { removeCoverFromHtml, replaceCoverInHtml } from './article-images';
import { buildElementorData, type SiteTocWidget } from './wp-push';
import { DEFAULT_UPLOAD_THEME, SITE_TOC_ID_TOKEN } from './types';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { failed++; console.log(`  ✗ FAILED: ${msg}`); return; }
  passed++;
  console.log(`  ✓ ${msg}`);
}

const SRC =
  '<h1>หัวเรื่อง</h1><p>intro1</p><p>intro2</p>' +
  '<h2>หัวข้อ A</h2><p>a-body</p><h2>หัวข้อ B</h2><p>b-body</p><h2>หัวข้อ C</h2><p>c-body</p><h2>หัวข้อ D</h2><p>d-body</p>';

function build(mode: 'html' | 'text', extra: { tocPosition?: number; withKey?: boolean; lang?: 'th' | 'en'; cover?: boolean } = {}) {
  const o: Parameters<typeof buildUploadArticleHtml>[0] = {
    sourceHtml: SRC,
    mode,
    theme: DEFAULT_UPLOAD_THEME,
    site: { name: 'Test', url: 'https://example.com', language: extra.lang || 'th' },
    meta: { title: 'หัวเรื่อง' },
    cover: extra.cover ? { url: 'c.webp', alt: 'cover' } : null,
  };
  if (extra.withKey) o.tocPosition = extra.tocPosition;
  else if (extra.tocPosition !== undefined) o.tocPosition = extra.tocPosition;
  return buildUploadArticleHtml(o);
}

const navCount = (h: string) => (h.match(/<nav\b[^>]*content-toc/gi) || []).length;
const stripNav = (h: string) => h.replace(/<nav\b[^>]*content-toc[\s\S]*?<\/nav>/i, '').replace(/\s+/g, '');
const idx = (h: string, s: string) => h.indexOf(s);

console.log('1 — placeToc');
const base = build('html', { cover: true }).html;
const N = sectionCountOfHtml(base);
assert(N >= 4, `fixture มี section >= 4 (ได้ ${N})`);
assert(navCount(base) === 1, 'fixture มี nav.content-toc 1 อัน');
assert(tocPositionOfHtml(base) === -1, `fixture default = -1 (ได้ ${tocPositionOfHtml(base)})`);
{
  const h0 = placeToc(base, 0)!;
  assert(h0 !== null, 'placeToc 0 ไม่ null');
  const t = idx(h0, '<nav'), i2 = idx(h0, 'intro2'), h2 = idx(h0, '<h2');
  assert(t > i2 && t < h2, 'pos 0: TOC หลัง intro2 ก่อน <h2 แรก');
  assert(tocPositionOfHtml(h0) === 0, `pos 0: tocPositionOfHtml = 0 (ได้ ${tocPositionOfHtml(h0)})`);
  assert(navCount(h0) === 1, 'pos 0: nav 1 อัน');
  assert(stripNav(h0) === stripNav(base), 'pos 0: เนื้อหาไม่หาย');

  const h2p = placeToc(base, 2)!;
  const t2 = idx(h2p, '<nav');
  const hs = Array.from(h2p.matchAll(/<h2\b/g)).map((m) => m.index!);
  assert(t2 > idx(h2p, 'b-body') && t2 < hs[2], 'pos 2: TOC ระหว่างหัวข้อที่ 2 กับ <h2 ที่ 3');
  assert(tocPositionOfHtml(h2p) === 2, `pos 2: tocPositionOfHtml = 2 (ได้ ${tocPositionOfHtml(h2p)})`);
  assert(navCount(h2p) === 1 && stripNav(h2p) === stripNav(base), 'pos 2: nav 1 อัน + เนื้อหาไม่หาย');

  const he = placeToc(base, N)!;
  assert(idx(he, '<nav') > idx(he, 'd-body'), 'pos end: TOC หลัง section สุดท้าย');
  assert(tocPositionOfHtml(he) === N, `pos end: tocPositionOfHtml = ${N} (ได้ ${tocPositionOfHtml(he)})`);
  assert(navCount(he) === 1 && stripNav(he) === stripNav(base), 'pos end: nav 1 อัน + เนื้อหาไม่หาย');

  const back = placeToc(he, -1)!;
  assert(tocPositionOfHtml(back) === -1, `กลับ -1: tocPositionOfHtml = -1 (ได้ ${tocPositionOfHtml(back)})`);
  assert(back.replace(/\s+/g, '') === base.replace(/\s+/g, ''), 'กลับ -1: เท่ากับ placement เดิม (ไม่นับช่องว่าง)');
  assert(navCount(back) === 1, 'กลับ -1: nav 1 อัน');

  for (const p of [-1, 0, 2, N]) {
    const cur = placeToc(base, p)!;
    assert(placeToc(cur, tocPositionOfHtml(cur)!) === cur, `idempotent ที่ ${p}`);
  }
}
{
  // ไม่มี TOC ของระบบ → สร้างจาก H2
  const noToc = '<h1>T</h1><p>i</p><h2 id="a">A &amp; x</h2><p>a</p><h2 id="b">B</h2><p>b</p><h2 id="c">C</h2><p>c</p>';
  const out = placeToc(noToc, 0);
  assert(out !== null && navCount(out) === 1 && tocPositionOfHtml(out) === 0, 'ไม่มี nav + 3 H2 มี id: สร้างและวางที่ 0');
  assert(out!.includes('href="#a"') && out!.includes('A &amp; x'), 'TOC ลิงก์ id + escape ข้อความ');
  assert(placeToc('<h1>T</h1><h2 id="a">A</h2><h2 id="b">B</h2>', 0) === null, '2 H2 -> null');
  assert(placeToc('<h1>T</h1><h2 id="a">A</h2><h2>B</h2><h2 id="c">C</h2>', 0) === null, 'H2 ไม่มี id -> null');
  assert(buildTocFromHeadings(noToc)!.includes('aria-label="สารบัญ"'), 'ค่าเริ่มต้น label สารบัญ');
  assert(buildTocFromHeadings(noToc, 'en')!.includes('aria-label="Contents"') && buildTocFromHeadings(noToc, 'en')!.includes('>Contents</p>'), 'en label Contents');
  assert(placeToc(noToc, 0, 'en')!.includes('Contents'), 'placeToc en ใช้ Contents');
}

console.log('2 — buildUploadArticleHtml tocPosition');
{
  const a = build('html', { cover: true }).html;
  const b = buildUploadArticleHtml({
    sourceHtml: SRC, mode: 'html', theme: DEFAULT_UPLOAD_THEME,
    site: { name: 'Test', url: 'https://example.com', language: 'th' }, meta: { title: 'หัวเรื่อง' }, cover: { url: 'c.webp', alt: 'cover' },
  }).html;
  const c = build('html', { cover: true, withKey: true, tocPosition: undefined }).html;
  assert(a === b, 'html: tocPosition ไม่ส่ง = ไม่มี option ทุก byte');
  assert(c === b, 'html: tocPosition: undefined ชัด ๆ = ไม่มี option ทุก byte');
  for (const p of [0, 2]) {
    const o = build('html', { cover: true, tocPosition: p }).html;
    assert(tocPositionOfHtml(o) === p && navCount(o) === 1, `html: tocPosition ${p} ตรง`);
  }
  const t0 = build('text');
  assert(!t0.html.includes('content-toc'), 'text: undefined = ไม่มี TOC');
  const t1 = build('text', { tocPosition: 0 });
  assert(navCount(t1.html) === 1 && tocPositionOfHtml(t1.html) === 0, `text: tocPosition 0 = TOC 1 อัน ที่ 0 (ได้ ${tocPositionOfHtml(t1.html)})`);
}

console.log('3 — detectTocPosition / majority / effective');
{
  const d = (html: string) => detectTocPosition(html, html.indexOf('<div class="toc"'));
  const TOC = '<div class="toc"><ul><li>x</li></ul></div>';
  assert(d(`<figure><img src="a.jpg"></figure><p>intro</p>${TOC}<h2>A</h2>`) === 0, 'หลังอินโทร -> 0');
  assert(d(`<p>intro</p>${TOC}<p>more intro</p><h2>A</h2>`) === -1, 'มีย่อหน้าหลัง toc -> -1');
  assert(d(`<h2>A</h2><p>a</p><h2>B</h2><p>b</p>${TOC}<h2>C</h2>`) === 2, 'หลัง 2 h2 -> 2');
  assert(d(`<p>intro</p>${TOC}<p>&nbsp;</p><h2>A</h2>`) === 0, 'p nbsp ไม่นับ -> 0');
  assert(d(`<p>intro</p>${TOC}<p><img src="x.jpg"></p><h2>A</h2>`) === 0, 'p img ไม่นับ -> 0');
  assert(JSON.stringify(majorityTocPosition([0, 0, -1])) === '{"position":0,"count":2}', 'majority [0,0,-1]');
  assert(majorityTocPosition([]) === undefined, 'majority [] = undefined');
  assert(effectiveTocPosition({ tocPosition: 2, siteScan: { components: { toc: { position: 0 } } } }) === 2, 'effective: ทีมย้ายชนะ');
  assert(effectiveTocPosition({ siteScan: { components: { toc: { position: 0 } } } }) === 0, 'effective: ใช้ scan');
  for (const bad of [1.5, '0', 99, -2]) {
    assert(effectiveTocPosition({ tocPosition: bad }) === undefined, `effective invalid ${JSON.stringify(bad)} -> undefined`);
    assert(normalizeTocPosition(bad) === undefined, `normalize invalid ${JSON.stringify(bad)} -> undefined`);
  }
  assert(effectiveTocPosition(null) === undefined, 'effective null -> undefined');
}

console.log('4 — removeCoverFromHtml / replaceCoverInHtml');
{
  const box = '<figure class="content-figure content-cover"><img src="X" alt=""></figure>';
  assert(!removeCoverFromHtml(`<h1>T</h1>${box}<p>a</p>`).includes('<figure'), 'ลบ figure.content-cover');
  assert(removeCoverFromHtml('<h1>T</h1><p>a</p>') === '<h1>T</h1><p>a</p>', 'ไม่มีปก = คืนเดิม');
  const plain = '<h1>T</h1><figure><img src="X" alt="a"></figure><p>a</p>';
  assert(removeCoverFromHtml(plain, 'X') === '<h1>T</h1><p>a</p>', 'text mode: ลบ figure ที่ src ตรง');
  assert(removeCoverFromHtml(plain, 'Y') === plain, 'src ต่าง ไม่ลบ');
  assert(removeCoverFromHtml(plain) === plain, 'ไม่ส่ง coverSrc ไม่ลบ');
  const withText = '<h1>T</h1><figure><img src="X"><p>text inside</p></figure><p>a</p>';
  assert(removeCoverFromHtml(withText, 'X') === withText, 'figure ที่มีข้อความอื่น ไม่ลบ');
  const amp = '<h1>T</h1><figure><img src="https://a.test/i.jpg?a=1&amp;b=2"></figure><p>a</p>';
  assert(removeCoverFromHtml(amp, 'https://a.test/i.jpg?a=1&b=2') === '<h1>T</h1><p>a</p>', 'src มี & เก็บเป็น &amp; ยังจับได้');

  assert(replaceCoverInHtml(`<h1>T</h1>${box}<p>a</p>`, 'N', 'alt').includes('src="N"') && !replaceCoverInHtml(`<h1>T</h1>${box}<p>a</p>`, 'N', 'alt').includes('src="X"'), 'replace: กล่องปกถูกแทน');
  const rp = replaceCoverInHtml('<h1>T</h1><p>i</p><figure><img src="X"></figure><p>a</p>', 'N', 'alt', 'X');
  assert(rp.indexOf('src="N"') > rp.indexOf('<p>i</p>') && rp.indexOf('src="N"') < rp.indexOf('<p>a</p>') && !rp.includes('src="X"'), 'replace: ปกเก่าแบบ plain แทนตรงจุดเดิม');
  const ins = replaceCoverInHtml('<h1>T</h1><p>a</p>', 'N', 'alt');
  assert(ins.startsWith('<h1>T</h1>\n<figure class="content-figure content-cover">'), 'replace: ไม่เจอ -> แทรกหลัง </h1>');
  assert(replaceCoverInHtml('<p>a</p>', 'N', 'alt') === '<p>a</p>', 'ไม่มี H1 ไม่มีปก = คืนเดิม');
}

console.log('5 — Elementor site TOC slot');
{
  type W = { id: string; widgetType: string; settings: Record<string, unknown> };
  const SITE_TOC: SiteTocWidget = {
    settings: { headings_by_tags: ['h2'], marker_view: 'numbers', title: 'สารบัญ' },
    css: `.elementor-element-${SITE_TOC_ID_TOKEN}{color:red}`,
  };
  const wsOf = (html: string, tocPosition?: number): W[] => {
    const data = JSON.parse(buildElementorData(html, 'mk00001', { siteToc: SITE_TOC, tocPosition })) as Array<{ elements: Array<{ elements: W[] }> }>;
    return data[0].elements[0].elements;
  };
  const txt = (w: W) => String(w.settings.editor ?? w.settings.html ?? '');
  const NAV = '<nav class="content-toc"><p class="content-toc__title">สารบัญ</p><ol><li><a href="#a">A</a></li></ol></nav>';
  const H2S = '<h2 id="a">A</h2><p>a</p><h2 id="b">B</h2><p>b</p><h2 id="c">C</h2><p>c</p>';
  const art = (inner: string) => `<style>.content-article p{color:red}</style>\n<div class="content-article">${inner}</div>`;
  const tocIdx = (ws: W[]) => ws.findIndex((w) => w.widgetType === 'table-of-contents');

  const textNoToc = (ws: W[]) => !ws.some((w) => txt(w).includes('content-toc'));

  const withNav = wsOf(art(`<h1>T</h1><p>intro</p>${NAV}${H2S}`), 2);
  const plainWithNav = wsOf(art(`<h1>T</h1><p>intro</p>${NAV}${H2S}`));
  assert(JSON.stringify(withNav.map((w) => w.widgetType)) === JSON.stringify(plainWithNav.map((w) => w.widgetType)), 'มี nav: tocPosition ถูกเมิน (โครงเท่าเดิม)');
  assert(tocIdx(withNav) > 0 && textNoToc(withNav), 'มี nav: site TOC แทน nav');

  const noNav = art(`<h1>T</h1><p>intro</p>${H2S}`);
  const w0 = wsOf(noNav, 0);
  const i0 = tocIdx(w0);
  assert(i0 > 0 && txt(w0[i0 + 1]).startsWith('<h2 id="a">'), 'ไม่มี nav pos 0: ก่อน widget ของ H2 แรก');
  const w1 = wsOf(noNav, 1);
  assert(tocIdx(w1) > 0 && txt(w1[tocIdx(w1) + 1]).startsWith('<h2 id="b">'), 'pos 1: ก่อน H2 ตัวที่ 2');
  const we = wsOf(noNav, 3);
  assert(tocIdx(we) === we.length - 1, 'pos = จำนวน H2: widget สุดท้าย');
  const wBig = wsOf(noNav, 40);
  assert(tocIdx(wBig) === wBig.length - 1, 'pos เกินจำนวน H2: widget สุดท้าย');
  const wLegacy = wsOf(noNav);
  const il = tocIdx(wLegacy);
  assert(il > 0 && txt(wLegacy[il - 1]).includes('intro') && txt(wLegacy[il + 1]).startsWith('<h2 id="a">'), 'undefined: legacy slot (หลังย่อหน้าแรก ก่อน H2 แรก)');
  const wNeg = wsOf(noNav, -1);
  assert(JSON.stringify(wNeg.map((w) => w.widgetType + txt(w).length)) === JSON.stringify(wLegacy.map((w) => w.widgetType + txt(w).length)), '-1 = legacy');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
