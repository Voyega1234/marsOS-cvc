/**
 * Regression: FAQ ในบทความ Upload Article หาย / เหลือ 1 ข้อ (แจ้ง 2026-10-06)
 * Run: npx tsx src/lib/upload-article/faq.test.ts
 */
import { buildUploadArticleHtml, countFaqItems, replaceFaqSection } from './build-html';
import { cleanContinuation, cleanFaqFill, isTruncatedFinish, parseWriterOutput } from './writer';
import { DEFAULT_UPLOAD_THEME } from './types';

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

console.log(`\n${passed} passed`);
