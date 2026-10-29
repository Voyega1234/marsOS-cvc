/**
 * Regression: FAQ มี 2 แบบตามที่เว็บใช้ (2026-10-29) — กดเปิด-ปิด (details, ค่าเดิม) / เปิดตลอด (คำถามเป็น h3)
 * โปรเจกต์เดิมที่ไม่ได้ตั้งค่า ต้องได้ HTML เดิมทุกตัวอักษร
 * Run: npx tsx src/lib/upload-article/faq-display.test.ts
 */
import { applyFaqDisplayMarkup, FAQ_HEADING_CSS, faqToAccordion, faqToOpen } from '@/lib/article-structure';
import { parseFaqFromHtml } from '@/lib/articleSchema';
import { applyFaqDisplay, buildUploadCss, sanitizeThemeDetail } from './theme-css';
import { buildElementorData } from './wp-push';
import { detectFaqDisplay } from './site-scan';
import type { UploadTheme } from './types';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

const ITEM = (q: string, a: string, open = false) =>
  `<details class="content-faq__item"${open ? ' open' : ''}><summary class="content-faq__question"><span class="content-faq__q">${q}</span></summary><div class="content-faq__answer">${a}</div></details>`;
const FAQ = `<h2 id="faq">คำถามที่พบบ่อย</h2>\n${ITEM('ราคาเท่าไหร่?', '<p>เริ่ม 1,000 บาท</p>', true)}\n${ITEM('ใช้เวลานานไหม?', '<p>ประมาณ <strong>1 ชั่วโมง</strong></p>')}`;

const theme = (faq?: Record<string, unknown>): UploadTheme => ({
  theme: '#2563eb', text: '#1f2937', border: '#e5e7eb', accent: '#2563eb', background: '', styleMode: 'embed',
  ...(faq ? { detail: { faq } } : {}),
} as UploadTheme);

function main() {
  console.log('โปรเจกต์เดิม (ไม่ได้ตั้งค่า / กดเปิด-ปิด) ไม่เปลี่ยน');
  {
    assert(applyFaqDisplayMarkup(FAQ, undefined) === FAQ, 'ไม่ได้ตั้ง = HTML เดิมทุกตัวอักษร');
    assert(applyFaqDisplayMarkup(FAQ, 'accordion') === FAQ, 'accordion = HTML เดิม');
    assert(applyFaqDisplayMarkup(FAQ, 'อะไรก็ได้') === FAQ, 'ค่าแปลก = HTML เดิม');
    const styled = `<style>.content-article p{}</style>${FAQ}`;
    assert(applyFaqDisplay(styled, undefined) === styled && applyFaqDisplay(styled, { layout: 'card' }) === styled, 'applyFaqDisplay ไม่ได้ตั้ง display = ไม่แตะ CSS');
    const menu = '<details class="menu"><summary>เมนู</summary><p>x</p></details>';
    assert(faqToOpen(menu) === menu, 'details ที่ไม่ใช่ FAQ ไม่แตะ');
  }

  console.log('เปิดตลอด');
  {
    const open = faqToOpen(FAQ);
    assert(!/<details|<summary/.test(open), 'ไม่มี details/summary เหลือ');
    assert(open.includes('<div class="content-faq__item content-faq__item--open"><h3 class="content-faq__heading">ราคาเท่าไหร่?</h3><div class="content-faq__answer"><p>เริ่ม 1,000 บาท</p></div></div>'), 'คำถามเป็น h3 คำตอบอยู่ใน content-faq__answer');
    assert(!/\bopen\b(?!")/.test(open.replace(/content-faq__item--open|content-faq__heading/g, '')), 'ตัด attribute open ทิ้ง');
    assert(open.includes('<strong>1 ชั่วโมง</strong>'), 'ตัวหนาในคำตอบอยู่ครบ');
    assert(faqToOpen(open) === open, 'แปลงซ้ำได้ผลเดิม');
    const bare = '<details class="content-faq__item"><summary class="content-faq__question"><h3>Q?</h3></summary><p>A</p></details>';
    assert(faqToOpen(bare) === '<div class="content-faq__item content-faq__item--open"><h3 class="content-faq__heading">Q?</h3><div class="content-faq__answer"><p>A</p></div></div>', 'คำตอบไม่มีตัวครอบ = ใส่ตัวครอบ, h3 ใน summary (บทความ 2026-10-21) ถอดออก');
    const twoBlocks = '<details class="content-faq__item"><summary>Q?</summary><div class="content-faq__answer"><p>A</p></div><p>ต่อ</p></details>';
    assert(faqToOpen(twoBlocks).includes('<div class="content-faq__answer"><div class="content-faq__answer"><p>A</p></div><p>ต่อ</p></div>'), 'คำตอบหลายก้อน = ครอบทั้งหมด ไม่ตกหล่น');
  }

  console.log('กลับเป็นกดเปิด-ปิด');
  {
    const back = faqToAccordion(faqToOpen(FAQ));
    assert(back === FAQ.replace(' open>', '>'), 'แปลงไปกลับได้ details เดิม (ข้อแรกไม่กางค้าง)');
    assert(faqToAccordion(back) === back, 'แปลงซ้ำได้ผลเดิม');
    const nested = '<div class="content-faq__item content-faq__item--open"><h3 class="content-faq__heading">Q?</h3><div class="content-faq__answer"><div class="x"><p>A</p></div><p>B</p></div></div><p>หลัง FAQ</p>';
    assert(faqToAccordion(nested) === '<details class="content-faq__item"><summary class="content-faq__question"><span class="content-faq__q">Q?</span></summary><div class="content-faq__answer"><div class="x"><p>A</p></div><p>B</p></div></details><p>หลัง FAQ</p>', 'div ซ้อนในคำตอบ ปิดถูกที่');
    assert(applyFaqDisplayMarkup(faqToOpen(FAQ), 'accordion') === back, 'ธีมเปลี่ยนกลับเป็นกดเปิด-ปิด = บทความที่ Generate แบบเปิดตลอดก็กลับได้');
  }

  console.log('Schema FAQPage ได้ชุดเดียวกัน');
  {
    const a = JSON.stringify(parseFaqFromHtml(FAQ));
    assert(parseFaqFromHtml(FAQ).length === 2, 'แบบเดิมอ่านได้ 2 ข้อ');
    assert(JSON.stringify(parseFaqFromHtml(faqToOpen(FAQ))) === a, 'แบบเปิดตลอดอ่านได้คำถามคำตอบเดียวกัน');
  }

  console.log('CSS');
  {
    const css = buildUploadCss(theme({ display: 'open', questionColor: '#112233' }));
    assert(css.includes(FAQ_HEADING_CSS), 'CSS ใหม่มีระยะของหัวข้อคำถาม');
    assert(/\.content-faq__heading\{[^}]*#112233/.test(css), 'สีคำถามที่ตั้งไว้ใช้กับหัวข้อด้วย');
    const oldStored = `<style>.content-article .content-faq__question{cursor:pointer}</style>\n<div class="content-article">${FAQ}</div>`;
    const pushed = applyFaqDisplay(oldStored, { display: 'open' });
    assert(pushed.includes(FAQ_HEADING_CSS) && pushed.indexOf(FAQ_HEADING_CSS) < pushed.indexOf('</style>'), 'บทความเก่า (CSS ไม่มีหัวข้อ) = เติม CSS ใน <style> เดิม');
    assert(applyFaqDisplay(pushed, { display: 'open' }) === pushed, 'push ซ้ำไม่เติมซ้ำ');
    const clean = `<div class="content-article">${FAQ}</div>`;
    assert(!applyFaqDisplay(clean, { display: 'open' }).includes('<style'), 'โหมด clean (ไม่มี <style>) ไม่เติม CSS — ธีมเว็บคุม h3 เอง');
    const d = sanitizeThemeDetail({ faq: { display: 'open', layout: 'plain' } });
    assert(d?.faq?.display === 'open' && d.faq.layout === 'plain', 'sanitize เก็บ display คู่กับ layout (การ์ดแบบเปิดตลอดก็ได้)');
    assert(sanitizeThemeDetail({ faq: { display: '<script>' } })?.faq?.display === undefined, 'ค่าแปลกถูกทิ้ง');
  }

  console.log('Elementor: FAQ เปิดตลอดแก้เป็นข้อความได้');
  {
    const html = `<div class="content-article">${faqToOpen(FAQ)}</div>`;
    const ws = JSON.parse(buildElementorData(html, 'abc1234'))[0].elements[0].elements as { widgetType: string; settings: { editor?: string } }[];
    const faqWidgets = ws.filter((w) => (w.settings.editor || '').includes('content-faq__item--open'));
    assert(faqWidgets.length > 0 && faqWidgets.every((w) => w.widgetType === 'text-editor'), 'อยู่ใน Text Editor ไม่ใช่ HTML widget');
  }

  console.log('สแกนเว็บ: ดูจากโครง HTML');
  {
    assert(detectFaqDisplay('<div class="rank-math-faq-item"><h3 class="rank-math-question">Q?</h3><div class="rank-math-answer"><p>A</p></div></div>') === 'open', 'Rank Math FAQ = เปิดตลอด');
    assert(detectFaqDisplay('<div class="schema-faq-section"><strong class="schema-faq-question">Q?</strong><p class="schema-faq-answer">A</p></div>') === 'open', 'Yoast FAQ = เปิดตลอด');
    assert(detectFaqDisplay('<h3>ราคาเท่าไหร่?</h3><p>คำตอบมีคำว่า toggle accordion</p>') === 'open', 'h3 + ย่อหน้า = เปิดตลอด (คำในข้อความไม่นับ)');
    assert(detectFaqDisplay('<div class="elementor-accordion"><div class="elementor-tab-title">Q</div></div>') === 'accordion', 'Elementor Accordion = กดเปิด-ปิด');
    assert(detectFaqDisplay('<div class="elementor-toggle-item"><div>Q</div></div>') === 'accordion', 'Elementor Toggle = กดเปิด-ปิด');
    assert(detectFaqDisplay('<details><summary>Q</summary><p>A</p></details>') === 'accordion', 'details/summary = กดเปิด-ปิด');
    assert(detectFaqDisplay('<div class="faq-q" aria-expanded="false">Q</div>') === 'accordion', 'aria-expanded = กดเปิด-ปิด');
    assert(detectFaqDisplay('<div class="uagb-faq__outer-wrap uagb-faq-layout-grid"><div class="uagb-faq-questions">Q</div></div>') === 'open', 'Spectra แบบ grid = เปิดตลอด');
    assert(detectFaqDisplay('<div class="uagb-faq__outer-wrap uagb-faq-layout-accordion">Q</div>') === 'accordion', 'Spectra แบบ accordion = กดเปิด-ปิด');
  }

  console.log(`\n${passed} passed`);
}

main();
