/**
 * Regression: FAQ ในบทความ Upload Article หาย / เหลือ 1 ข้อ (แจ้ง 2026-10-06)
 * Run: npx tsx src/lib/upload-article/faq.test.ts
 */
import { buildUploadArticleHtml, countFaqItems, replaceFaqSection } from './build-html';
import { cleanContinuation, cleanFaqFill, isTruncatedFinish, parseWriterOutput } from './writer';
import { DEFAULT_UPLOAD_THEME } from './types';
import { normalizeFaqAndTakeaways } from '@/lib/article-structure';
import { parseUploadCards } from './cards';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

function build(body: string) {
  return buildUploadArticleHtml({
    sourceHtml: `<h1>หัวเรื่อง</h1><p>บทนำ</p>${body}`,
    mode: 'html',
    theme: DEFAULT_UPLOAD_THEME,
    site: { name: 'Test', url: 'https://example.com', language: 'th' },
    meta: { title: 'หัวเรื่อง' },
  });
}

/** คำตอบข้อที่ n (เริ่ม 0) ในผลลัพธ์ */
function answers(html: string): string[] {
  return Array.from(html.matchAll(/<div class="content-faq__answer">([\s\S]*?)<\/div><\/details>/g), (m) => m[1]);
}

console.log('A — คำถาม H3 ที่ไม่มี "?" ปนกับที่มี (เดิมเหลือ 1 ข้อ)');
{
  const r = build('<h2>คำถามที่พบบ่อย</h2><h3>ค่าส่วนกลางเท่าไหร่</h3><p>a1</p><h3>ค่าส่วนกลางคิดยังไงบ้าง</h3><p>a2</p><h3>ควรเลือกชั้นไหนดี</h3><p>a3</p>');
  assert(r.faqCount === 3, `faqCount = 3 (ได้ ${r.faqCount})`);
}
{
  const r = build('<h2>FAQ</h2><h3>ต้องใช้เงินเท่าไร?</h3><p>a1</p><h4>รายละเอียด</h4><p>x</p><h3>กู้ได้ไหม?</h3><p>a2</p><h3>ใช้เวลากี่วัน?</h3><p>a3</p>');
  assert(r.faqCount === 3, `H4 ในคำตอบไม่ตัด FAQ (ได้ ${r.faqCount})`);
  assert(answers(r.html)[0]?.includes('รายละเอียด'), 'H4 อยู่ในคำตอบข้อแรก');
}
{
  const r = build('<h2>FAQ</h2><h3>X ได้ไหม?</h3><p><strong>ได้ครับ</strong></p><p>detail</p><h3>Y?</h3><p>b</p><h3>Z?</h3><p>c</p>');
  assert(r.faqCount === 3, `คำตอบตัวหนาไม่ตัด FAQ (ได้ ${r.faqCount})`);
}
{
  const r = build('<h2>FAQ</h2><h3>ต้องเตรียมเอกสารอะไร</h3><p>a</p><h3>ค่าธรรมเนียมการโอน</h3><p>b</p><h3>ใช้เวลานานไหม</h3><p>c</p>');
  assert(r.faqCount === 3, `หัวข้อไม่มีสัญญาณอยู่ระหว่างคำถาม ยังนับเป็นคำถาม (ได้ ${r.faqCount})`);
}

console.log('A — หัวข้อปิดท้าย FAQ ยังทำงาน');
{
  const r = build('<h2>FAQ</h2><h3>Q1?</h3><p>a</p><h3>Q2?</h3><p>b</p><h3>แหล่งอ้างอิง</h3><p>ref</p>');
  assert(r.faqCount === 2, `faqCount = 2 (ได้ ${r.faqCount})`);
  assert(!answers(r.html).some((a) => a.includes('ref')), 'แหล่งอ้างอิงอยู่นอก FAQ');
}
{
  const r = build('<h2>FAQ</h2><h3>Q1?</h3><p>a</p><h3>Q2?</h3><p>b</p><h3>สนใจโครงการ</h3><p>cta</p>');
  assert(r.faqCount === 2, `หัวข้อท้าย FAQ ที่ไม่ใช่คำถาม ไม่ถูกนับ (ได้ ${r.faqCount})`);
}
{
  const r = build('<h2>FAQ</h2><h3>Q1?</h3><p>a</p><h2>บทสรุป</h2><p>s</p>');
  assert(r.faqCount === 1 && !answers(r.html)[0].includes('s</p>'), 'H2 ถัดไปจบ FAQ');
}

console.log('B — หัว FAQ ไม่ใช่ H2 (เดิม FAQ หายทั้งก้อน)');
{
  const r = build('<h2>สรุป</h2><p>s</p><h3>คำถามที่พบบ่อย</h3><h4>A ได้ไหม</h4><p>a</p><h4>B?</h4><p>b</p><h4>C?</h4><p>c</p>');
  assert(r.faqCount === 3, `หัว FAQ เป็น H3 (ได้ ${r.faqCount})`);
}
{
  const r = build('<h2>สรุป</h2><p>s</p><p><strong>FAQ</strong></p><p><strong>A?</strong></p><p>a</p><p><strong>B?</strong></p><p>b</p><p><strong>C?</strong></p><p>c</p>');
  assert(r.faqCount === 3, `หัว FAQ เป็นย่อหน้าตัวหนา (ได้ ${r.faqCount})`);
}
{
  const r = build('<h2>คำถามที่หลายคนสงสัย</h2><h3>A?</h3><p>a</p><h3>B?</h3><p>b</p>');
  assert(r.faqCount === 2, `หัว FAQ สำนวนอื่น "คำถามที่หลายคนสงสัย" (ได้ ${r.faqCount})`);
}

console.log('C/D — คำถามเป็นย่อหน้า');
{
  const r = build('<h2>FAQ</h2><p>Q1: A</p><p>a</p><p>Q2: B</p><p>b</p><p>Q3. C</p><p>c</p>');
  assert(r.faqCount === 3, `Q1:/Q2:/Q3. ไม่มี ? (ได้ ${r.faqCount})`);
}
{
  const r = build('<h2>FAQ</h2><p>ซื้อคอนโดต้องใช้เงินเท่าไหร่</p><p>ประมาณสามแสนบาท</p><p>กู้ร่วมได้ไหม</p><p>ได้ถ้าเป็นคู่สมรส</p><p>โอนกี่วัน</p><p>ราวหนึ่งสัปดาห์</p>');
  assert(r.faqCount === 3, `ย่อหน้าคำถามภาษาไทยไม่มี ? (ได้ ${r.faqCount})`);
}
{
  const r = build('<h2>FAQ</h2><p><strong>A?</strong></p><p>a</p><p><strong>Q2</strong> ต่อสัญญาได้ไหม</p><p>b</p><p><strong>Q3</strong> ยกเลิกได้ไหม</p><p>c</p>');
  assert(r.faqCount === 3, `คำถามตัวหนาบางส่วน (ได้ ${r.faqCount})`);
}

console.log('E — คำถามเป็น H2 ต่อจากหัว FAQ');
{
  const r = build('<h2>คำถามที่พบบ่อย</h2><h2>A ได้ไหม?</h2><p>a</p><h2>B ได้ไหม?</h2><p>b</p><h2>C?</h2><p>c</p><h2>ติดต่อเรา</h2><p>x</p>');
  assert(r.faqCount === 3, `คำถาม H2 ถูกลดเป็นคำถาม FAQ (ได้ ${r.faqCount})`);
  assert(/<h2[^>]*>ติดต่อเรา<\/h2>/.test(r.html), 'H2 ที่ไม่ใช่คำถามยังเป็น H2');
}

console.log('Guard — ไม่สร้าง FAQ เกินจริง');
{
  const r = build('<h2>รีวิว</h2><h3>ข้อดี</h3><p>x</p><h3>ข้อเสีย</h3><p>y</p>');
  assert(r.faqCount === 0 && !r.html.includes('<details'), 'ไม่มีหัว FAQ = ไม่มี FAQ');
}
{
  const r = build('<h2>FAQ</h2><h3>A?</h3><p>คำตอบยาวที่บังเอิญลงท้ายว่าใช่ไหม</p><h3>B?</h3><p>b</p>');
  assert(r.faqCount === 2, `ย่อหน้าคำตอบลงท้ายคำถาม ไม่กลายเป็นคำถามใหม่เมื่อคำถามเป็นหัวข้อ (ได้ ${r.faqCount})`);
}
{
  const r = buildUploadArticleHtml({
    sourceHtml: '<h1>T</h1><h3>คำถามที่พบบ่อย</h3><h4>A?</h4><p>a</p>',
    mode: 'text',
    theme: DEFAULT_UPLOAD_THEME,
    site: { name: 'Test', url: 'https://example.com', language: 'th' },
    meta: { title: 'T' },
  });
  assert(r.faqCount === 0, 'โหมด text ไม่แปลง FAQ');
}
{
  const r = build('<h2>FAQ</h2><h3>A?</h3><p>a</p><h3>B?</h3><p>b</p>');
  const schema = /"@type":\s*"FAQPage"/.test(r.html);
  assert(schema, 'มี FAQPage schema');
}

console.log('G — บทความถูกตัด / FAQ ขาด (เขียนต่อ + เติม FAQ ตอนเขียน)');
{
  assert(isTruncatedFinish('length') && !isTruncatedFinish('stop') && !isTruncatedFinish(''), 'finish_reason length = ถูกตัด, stop = จบ');
  const head = 'META_DESCRIPTION: คำโปรย\n---HTML---\n<h1>T</h1><p>บทนำ</p><h2>FAQ</h2><h3>ข้อแรก?</h3><p>ตอบ</p><h3>ข้อสอ';
  const cont = '```html\nง?</h3><p>ตอบสอง</p>```';
  const merged = parseWriterOutput(head + cleanContinuation(cont));
  assert(countFaqItems(merged.html) === 2, 'ต่อส่วนที่ถูกตัดแล้ว FAQ ครบ 2 ข้อ');
  assert(merged.metaDescription === 'คำโปรย', 'meta description ยังอยู่หลังต่อข้อความ');
  assert(cleanContinuation('META_DESCRIPTION: x\n---HTML---\n<p>ต่อ</p>') === '<p>ต่อ</p>', 'ตัดหัวสัญญาที่โมเดลใส่ซ้ำ');
}
{
  const fill = cleanFaqFill('นี่คือ FAQ\n<h2>คำถามที่พบบ่อย</h2><h3>หนึ่ง?</h3><p>1</p><h3>สอง?</h3><p>2</p><h2>สรุป</h2><p>แถม</p>');
  assert(!fill.includes('สรุป') && fill.startsWith('<h2>'), 'เติม FAQ: ตัดข้อความนอกแท็กและหัวข้อที่แถมมา');
  const withOne = '<h1>T</h1><p>a</p><h2>FAQ</h2><h3>เดียว?</h3><p>x</p><h2>สรุป</h2><p>จบ</p>';
  assert(countFaqItems(withOne) === 1, 'นับ FAQ 1 ข้อ');
  const replaced = replaceFaqSection(withOne, fill);
  assert(countFaqItems(replaced) === 2 && !replaced.includes('เดียว?'), 'แทน FAQ เดิมทั้งส่วน');
  assert(replaced.indexOf('คำถามที่พบบ่อย') < replaced.indexOf('สรุป'), 'FAQ ใหม่อยู่ก่อนสรุปตามเดิม');
  const noFaq = '<h1>T</h1><p>a</p><h2>เนื้อหา</h2><p>b</p><h2>บทสรุป</h2><p>จบ</p>';
  const inserted = replaceFaqSection(noFaq, fill);
  assert(countFaqItems(inserted) === 2 && inserted.indexOf('คำถามที่พบบ่อย') < inserted.indexOf('บทสรุป'), 'ไม่มี FAQ เดิม: แทรกก่อนบทสรุป');
  const noEnd = replaceFaqSection('<h1>T</h1><h2>เนื้อหา</h2><p>b</p>', fill);
  assert(noEnd.trim().endsWith('<p>2</p>'), 'ไม่มีสรุป: ต่อท้ายบทความ');
}

console.log('H — มาตรฐานโครง: คำถาม FAQ = span ใน summary, หัว FAQ = H2, Key Takeaways เป็นกล่อง (2026-10-22)');
{
  const r = build('<h2>สรุปประเด็นสำคัญ</h2><ul><li>ข้อ 1</li><li>ข้อ 2</li></ul><h2>เนื้อหา</h2><p>x</p><h2>อีกหัวข้อ</h2><p>y</p><h2>คำถามที่พบบ่อย</h2><h3>หนึ่ง?</h3><p>1</p><h3>สอง?</h3><p>2</p>');
  assert((r.html.match(/<summary class="content-faq__question"><span class="content-faq__q">/g) || []).length === 2, 'คำถาม FAQ อยู่ใน <span> ภายใน summary');
  assert(!/<summary\b[^>]*>\s*<h[1-6]\b/.test(r.html), 'ไม่มีหัวข้อใน summary (บางเว็บตัด summary ทิ้ง)');
  assert(/<h2[^>]*>คำถามที่พบบ่อย<\/h2>/.test(r.html), 'หัว FAQ เป็น H2');
  assert(/<div class="content-takeaways"><p class="content-takeaways__title">สรุปประเด็นสำคัญ<\/p><ul>/.test(r.html), 'Key Takeaways เป็นกล่อง');
  assert(r.h2Count === 3 && !/<h2[^>]*>สรุปประเด็นสำคัญ/.test(r.html), 'Key Takeaways ไม่นับเป็น H2 / ไม่เข้าสารบัญ');
  assert(!/content-toc[\s\S]*สรุปประเด็นสำคัญ[\s\S]*<\/nav>/.test(r.html.slice(0, r.html.indexOf('</nav>') + 6)), 'สารบัญไม่มี Key Takeaways');
  assert(r.plainText.includes('- ข้อ 1'), 'plain text ของกล่องยังเป็นรายการ');
}
{
  const r = build('<p><strong>สรุป</strong></p><ul><li>ไม่ใช่กล่อง</li></ul>');
  assert(!r.html.includes('<div class="content-takeaways"'), '"สรุป" เฉย ๆ ไม่กลายเป็นกล่อง');
}
{
  const old = '<style>.x{}</style><div class="content-article"><h1>T</h1><p>a</p><nav class="content-toc"><ol><li><a href="#key-takeaways">Key Takeaways</a></li><li><a href="#b">B</a></li></ol></nav><h2 id="key-takeaways">Key Takeaways</h2><ul><li>k</li></ul><h2 id="b">B</h2><p>b</p><h3>FAQ</h3><details class="content-faq__item"><summary class="content-faq__question"><span class="content-faq__q"><strong>Q1?</strong></span></summary><div class="content-faq__answer"><p>a</p></div></details><details><summary>Q2?</summary><p>b</p></details></div>';
  const out = normalizeFaqAndTakeaways(old);
  assert(out.includes('<summary class="content-faq__question"><span class="content-faq__q"><strong>Q1?</strong></span></summary>'), 'บทความเก่า: span คงเดิม');
  assert(out.includes('<summary>Q2?</summary>'), 'บทความเก่า: summary ข้อความเปล่า คงเดิม');
  const h3Era = '<details class="content-faq__item"><summary class="content-faq__question"><h3 class="content-faq__q">Q3?</h3></summary><div class="content-faq__answer"><p>c</p></div></details>';
  assert(normalizeFaqAndTakeaways(h3Era).includes('<summary class="content-faq__question"><span class="content-faq__q">Q3?</span></summary>'), 'บทความช่วง h3: h3 ใน summary → span');
  assert(/<h2 id="faq">FAQ<\/h2>/.test(out), 'บทความเก่า: หัว FAQ H3 → H2');
  assert(out.includes('<div class="content-takeaways" id="key-takeaways">') && !out.includes('href="#key-takeaways"'), 'บทความเก่า: Key Takeaways เป็นกล่อง + ตัดออกจากสารบัญ');
  assert(normalizeFaqAndTakeaways(out) === out, 'แปลงซ้ำไม่เปลี่ยน (idempotent)');
}
{
  const seo = '<h1>T</h1><div class="content-highlight">\n  <p><strong>Key Takeaways</strong></p>\n  <ul><li>k</li></ul>\n</div><div class="content-highlight"><p>อื่น</p></div>';
  const out = normalizeFaqAndTakeaways(seo);
  assert(out.startsWith('<h1>T</h1><div class="content-takeaways"><p class="content-takeaways__title">Key Takeaways</p>') && (out.match(/content-highlight/g) || []).length === 1, 'SEO เก่า: Key Takeaways ใน content-highlight ไม่เป็นกล่องซ้อน');
}
console.log('H2 — บทความไทย: หัวกล่องเป็น "สรุปประเด็นสำคัญ" เสมอ ไม่ใช่ Key Takeaways (2026-10-26)');
{
  const r = build('<h2>Key Takeaways</h2><ul><li>ข้อ 1</li><li>ข้อ 2</li></ul><h2>เนื้อหา</h2><p>x</p>');
  assert(r.html.includes('<p class="content-takeaways__title">สรุปประเด็นสำคัญ</p>') && !/key\s*takeaways/i.test(r.html), 'Upload เว็บไทย: Key Takeaways → สรุปประเด็นสำคัญ');
  const thai = '<h1>หัวเรื่องภาษาไทย</h1><p>บทนำภาษาไทยสำหรับผู้อ่าน</p><h2>Key Takeaways</h2><ul><li>ประเด็นแรกของบทความ</li></ul><h2>เนื้อหา</h2><p>รายละเอียด</p>';
  const out = normalizeFaqAndTakeaways(thai);
  assert(out.includes('<p class="content-takeaways__title">สรุปประเด็นสำคัญ</p>'), 'SEO ไม่ส่งภาษา: เดาจากเนื้อหาไทย → สรุปประเด็นสำคัญ');
  assert(normalizeFaqAndTakeaways(out) === out, 'แปลงซ้ำไม่เปลี่ยน');
  const boxed = '<p>บทนำภาษาไทย</p><div class="content-takeaways"><p class="content-takeaways__title">Key Takeaways</p><ul><li>ประเด็นภาษาไทย</li></ul></div>';
  assert(normalizeFaqAndTakeaways(boxed).includes('<p class="content-takeaways__title">สรุปประเด็นสำคัญ</p>'), 'กล่องเดิมที่เขียน Key Takeaways → เปลี่ยนหัวกล่อง');
  const custom = '<p>บทนำภาษาไทย</p><div class="content-takeaways"><p class="content-takeaways__title">ข้อดีของบริการ</p><ul><li>ประเด็นภาษาไทย</li></ul></div>';
  assert(normalizeFaqAndTakeaways(custom) === custom, 'หัวกล่องที่ไม่ใช่หัวสรุป ไม่แตะ');
  assert(normalizeFaqAndTakeaways('<h2>Key Takeaways</h2><ul><li>ข้อ</li></ul>', 'en').includes('<p class="content-takeaways__title">Key Takeaways</p>'), 'บทความอังกฤษคง Key Takeaways');
  assert(normalizeFaqAndTakeaways('<h2>Key Takeaways</h2><ul><li>k</li></ul>', 'th').includes('<p class="content-takeaways__title">สรุปประเด็นสำคัญ</p>'), 'ส่งภาษาไทยมา: ชนะการเดาจากเนื้อหา');
}
{
  const html = '<div class="content-article"><h1>T</h1><nav class="content-toc" aria-label="สารบัญ"><p class="content-toc__title">สารบัญ</p><ol><li><a href="#a">A</a></li></ol></nav><p>intro</p><p><strong>สารบัญ</strong></p><ul><li><a href="#a">A</a></li><li><a href="#b">B</a></li></ul><h2 id="a">A</h2><p>x</p></div>';
  const p = parseUploadCards(html);
  const tocs = p.cards.filter((c) => c.type === 'toc');
  assert(tocs.length === 2 && !tocs[0].derived && !!tocs[1].derived, 'หน้า Push: สารบัญที่เขียนมาในเนื้อหาเป็นการ์ดสารบัญ ปิดไว้ก่อน');
  assert(p.head + p.cards.map((c) => c.html).join('') + p.tail === html, 'หน้า Push: ประกอบกลับได้ HTML เดิม');
}

console.log(`\n${passed} passed`);
