/**
 * Regression: เว็บที่ผู้เขียนวางสารบัญ (widget Elementor) ในบทความเอง — push แบบ Elementor ต้องวางสารบัญของเว็บแทนของเรา ตรงจุดเดิม
 * (UME 2026-10-29: สแกนบอกว่าผู้เขียนใส่เอง แต่บทความที่ push ไปไม่มีสารบัญของเว็บเลย)
 * และสารบัญที่ template ของเว็บใส่ให้ทุกบทความ (แบบโปรเจกต์ termite) ต้องยังเป็น 'auto' เหมือนเดิม
 * Run: npx tsx src/lib/upload-article/site-toc.test.ts
 */
import { buildElementorData, type SiteTocWidget } from './wp-push';
import { cssRulesFor, findComponent, parseElementorToc, type PostSample } from './site-scan';
import { SITE_TOC_ID_TOKEN } from './types';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

type W = { id: string; widgetType: string; settings: Record<string, unknown> };
function widgetsOf(html: string, siteToc?: SiteTocWidget | null): W[] {
  const data = JSON.parse(buildElementorData(html, 'mk00001', { siteToc })) as Array<{ elements: Array<{ elements: W[] }> }>;
  return data[0].elements[0].elements;
}
const types = (ws: W[]) => ws.map((w) => w.widgetType).join(',');
const textOf = (w: W) => String(w.settings.editor ?? w.settings.html ?? '');

const SITE_TOC: SiteTocWidget = {
  settings: { headings_by_tags: ['h2'], marker_view: 'numbers', title: 'สารบัญ' },
  css: `.elementor .elementor-element.elementor-element-${SITE_TOC_ID_TOKEN} .elementor-toc__header-title{color:#123456}`,
};
const NAV = '<nav class="content-toc"><p class="content-toc__title">สารบัญ</p><ol><li><a href="#a">A</a></li></ol></nav>';
const H2S = '<h2 id="a">A</h2><p>a</p><h2 id="b">B</h2><p>b</p><h2 id="c">C</h2><p>c</p>';
const article = (inner: string) => `<style>.content-article p{color:red}</style>\n<div class="content-article">${inner}</div>`;

console.log('push แบบ Elementor + สารบัญของเว็บ');
{
  // ไม่มีผลสแกน = เหมือนเดิม: สารบัญของเราอยู่ใน HTML widget ไม่มี widget สารบัญของเว็บ
  const html = article(`<h1>T</h1><p>intro</p>${NAV}${H2S}`);
  const plain = widgetsOf(html);
  assert(!plain.some((w) => w.widgetType === 'table-of-contents'), 'ไม่มีผลสแกน = ไม่มี widget สารบัญของเว็บ');
  assert(plain.some((w) => textOf(w).includes('content-toc')), 'ไม่มีผลสแกน = สารบัญของเรายังอยู่');
  assert(types(widgetsOf(html, null)) === types(plain), 'siteToc null = โครง widget เดิมทุกตัว');

  // มีผลสแกน = แทน nav ของเรา ตรงจุดเดิม (หลังย่อหน้าแรก ก่อน H2 แรก)
  const ws = widgetsOf(html, SITE_TOC);
  const toc = ws.findIndex((w) => w.widgetType === 'table-of-contents');
  assert(toc > 0, 'วาง widget สารบัญของเว็บ');
  assert(!ws.some((w) => textOf(w).includes('content-toc')), 'ตัดสารบัญของเราออก — ไม่ซ้อน 2 อัน');
  assert(textOf(ws[toc - 1]).includes('intro') && !textOf(ws[toc - 1]).includes('<h2'), 'อยู่หลังย่อหน้าแรก');
  assert(textOf(ws[toc + 1]).startsWith('<h2 id="a">'), 'อยู่ก่อน H2 แรก');
  assert(JSON.stringify(ws[toc].settings) === JSON.stringify(SITE_TOC.settings), 'settings ตามของเว็บ');
  assert(ws.filter((w) => w.widgetType === 'table-of-contents').length === 1, 'สารบัญของเว็บมีอันเดียว');

  // CSS หน้าตาจากบทความต้นแบบ → ผูกกับ id ของ widget ใหม่ + เว้นระยะจากย่อหน้า
  const marker = textOf(ws[0]);
  assert(marker.includes(`.elementor-element-${ws[toc].id} .elementor-toc__header-title{color:#123456}`), 'CSS ของเว็บผูกกับ id widget ใหม่');
  assert(!marker.includes(SITE_TOC_ID_TOKEN), 'ไม่มีตัวแทน id หลุดขึ้นเว็บ');
  assert(/elementor-widget-table-of-contents[^{]*\{margin:1\.6em 0!important/.test(marker), 'มี CSS เว้นระยะสารบัญ');
  assert(!textOf(widgetsOf(html)[0]).includes('table-of-contents'), 'ไม่มีผลสแกน = ไม่มี CSS สารบัญ');
}
{
  // บทความไม่มีสารบัญของเรา (เช่น Generate ตอนผลสแกนยังบอกว่าเว็บใส่ให้) → วางจุดเดียวกับที่ระบบวาง
  const ws = widgetsOf(article(`<h1>T</h1><figure><img src="x.webp" alt=""></figure><p>intro</p>${H2S}`), SITE_TOC);
  const toc = ws.findIndex((w) => w.widgetType === 'table-of-contents');
  assert(toc > 0 && textOf(ws[toc - 1]).includes('intro') && textOf(ws[toc - 1]).includes('<figure'), 'ไม่มี nav: วางหลังรูปปก + ย่อหน้าแรก');
  assert(textOf(ws[toc + 1]).startsWith('<h2 id="a">'), 'ไม่มี nav: ไม่เลย H2 แรก');

  const noIntro = widgetsOf(article(`<h1>T</h1>${H2S}`), SITE_TOC);
  const t2 = noIntro.findIndex((w) => w.widgetType === 'table-of-contents');
  assert(t2 > 0 && textOf(noIntro[t2 - 1]) === '<h1>T</h1>' && textOf(noIntro[t2 + 1]).startsWith('<h2'), 'ไม่มีย่อหน้าเปิด: วางหลัง H1 ก่อน H2 แรก');

  const short = widgetsOf(article('<h1>T</h1><p>intro</p><h2>A</h2><p>a</p><h2>B</h2><p>b</p>'), SITE_TOC);
  assert(!short.some((w) => w.widgetType === 'table-of-contents'), 'H2 ไม่ถึง 3 + ไม่มี nav = ไม่วาง');
  assert(!textOf(short[0]).includes('table-of-contents'), 'ไม่วาง = ไม่ใส่ CSS สารบัญ');
}
{
  // แยกเป็น widget ไม่ได้ (ไม่มีตัวครอบ + ไม่มีส่วนที่เป็นข้อความ) → HTML ก้อนเดียวแบบเดิม สารบัญของเรายังอยู่ (ไม่หายทั้งคู่)
  const ws = widgetsOf(`${NAV}<div class="x"><h2>A</h2></div><div class="y"><h2>B</h2></div>`, SITE_TOC);
  assert(ws.length === 1 && ws[0].widgetType === 'html' && textOf(ws[0]).includes('content-toc'), 'แยกไม่ได้ = คงสารบัญของเรา');
}

console.log('สแกน: อ่าน widget สารบัญของเว็บ');
const WIDGET =
  '<div class="elementor-element elementor-element-3a2ffd3 elementor-toc--minimized-on-tablet elementor-widget elementor-widget-table-of-contents" data-id="3a2ffd3" data-element_type="widget" ' +
  'data-settings="{&quot;headings_by_tags&quot;:[&quot;h2&quot;],&quot;marker_view&quot;:&quot;numbers&quot;,&quot;minimize_box&quot;:&quot;yes&quot;,&quot;Bad-Key&quot;:1}" data-widget_type="table-of-contents.default">' +
  '<div class="elementor-widget-container"><div class="elementor-toc__header"><div class="elementor-toc__header-title">\n\t\tสารบัญ &amp; หัวข้อ\t</div>' +
  '<div class="elementor-toc__toggle-button elementor-toc__toggle-button--expand" role="button"><i aria-hidden="true" class="fas fa-chevron-down"></i></div>' +
  '<div class="elementor-toc__toggle-button elementor-toc__toggle-button--collapse" role="button"><svg aria-hidden="true" class="e-font-icon-svg e-fas-chevron-up"></svg></div></div>' +
  '<div id="elementor-toc__3a2ffd3" class="elementor-toc__body"></div></div></div>';
{
  const t = parseElementorToc(`<p>x</p>${WIDGET}`);
  assert(t?.dataId === '3a2ffd3', 'อ่าน data-id');
  assert(JSON.stringify(t?.settings.headings_by_tags) === '["h2"]' && t?.settings.marker_view === 'numbers', 'อ่าน data-settings');
  assert(!('Bad-Key' in (t?.settings ?? {})), 'ตัด key แปลก ๆ ทิ้ง');
  assert(t?.settings.title === 'สารบัญ & หัวข้อ' && t?.settings.html_tag === 'div', 'อ่านหัวข้อ + แท็กหัวข้อ');
  assert(JSON.stringify(t?.settings.expand_icon) === '{"value":"fas fa-chevron-down","library":"fa-solid"}', 'ไอคอนเปิดแบบ <i>');
  assert(JSON.stringify(t?.settings.collapse_icon) === '{"value":"fas fa-chevron-up","library":"fa-solid"}', 'ไอคอนปิดแบบ svg');
  assert(parseElementorToc('<div class="elementor-widget-text-editor"></div>') === null, 'ไม่มี widget = null');
}
{
  const css =
    '.elementor-2748 .elementor-element.elementor-element-3a2ffd3{--box-padding:10px}/* x */.elementor-element-3a2ffd3b{color:red}' +
    '@media(max-width:767px){.elementor-2748 .elementor-element.elementor-element-3a2ffd3 .elementor-toc__body{padding:0}.other{x:y}}' +
    '.elementor-element-3a2ffd3 a{background:url(javascript:alert(1))}</style><script>';
  const out = cssRulesFor(css, 'elementor-element-3a2ffd3');
  assert(out.includes('.elementor-2748 .elementor-element.elementor-element-3a2ffd3{--box-padding:10px}'), 'เก็บกฎของ widget');
  assert(out.includes('@media(max-width:767px){.elementor-2748 .elementor-element.elementor-element-3a2ffd3 .elementor-toc__body{padding:0}}'), 'เก็บกฎใน @media');
  assert(!out.includes('3a2ffd3b') && !out.includes('.other'), 'ไม่เก็บ element อื่น');
  assert(!out.includes('javascript:') && !out.includes('<'), 'ตัดโค้ดอันตราย');
}

console.log('สแกน: ผู้เขียนวางเอง vs template ใส่ให้');
{
  const page = (doc: string, template = '') =>
    '<html><body><div data-elementor-type="header" data-elementor-id="90" class="elementor elementor-90 elementor-location-header"><nav>เมนู</nav></div>' +
    `<main><div data-elementor-type="single-post" data-elementor-id="1874" class="elementor elementor-1874 elementor-location-single">${template}` +
    `<div class="elementor-element elementor-widget elementor-widget-theme-post-content"><div class="elementor-widget-container">${doc}</div></div></div></main></body></html>`;
  const own = (id: number) =>
    `<div data-elementor-type="wp-post" data-elementor-id="${id}" class="elementor elementor-${id}">${WIDGET}` +
    `<div class="elementor-element elementor-widget elementor-widget-text-editor"><div class="elementor-widget-container">${H2S}</div></div></div>`;

  // REST ไม่มี markup ของ Elementor (บางเว็บ) — เดิมนับเป็นปลั๊กอินแทรก → ตัดของเราทิ้ง บทความไม่มีสารบัญเลย
  const posts: PostSample[] = [1, 2, 3].map((n) => ({ link: `https://x.test/p${n}`, content: H2S, page: page(own(n)) }));
  const f = findComponent('toc', posts, null, []);
  assert(f.where === 'some-posts', `widget ในเอกสารของบทความ (REST ไม่มี markup) = ผู้เขียนวางเอง (ได้ ${f.where})`);

  // REST มี markup ของ Elementor (แบบ UME)
  const rest = findComponent('toc', [1, 2, 3].map((n) => ({ link: `https://x.test/p${n}`, content: own(n), page: page(own(n)) })), null, []);
  assert(rest.where === 'some-posts', `REST มี widget = ผู้เขียนวางเอง (ได้ ${rest.where})`);

  // template single-post ใส่ให้ทุกบทความ (แบบ termite) — ต้องยังเป็น auto ตัดของเราเหมือนเดิม
  const tpl = findComponent('toc', [1, 2, 3].map((n) => ({ link: `https://x.test/p${n}`, content: H2S, page: page(`<div data-elementor-type="wp-post" data-elementor-id="${n}" class="elementor elementor-${n}">${H2S}</div>`, WIDGET) })), null, []);
  assert(tpl.where === 'auto', `template ใส่ให้ = auto (ได้ ${tpl.where})`);
}

console.log(`\n${passed} passed`);
