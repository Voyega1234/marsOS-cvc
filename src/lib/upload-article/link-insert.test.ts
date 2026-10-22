/**
 * Regression: Internal Link ในบทความ AI ไม่ตรงหัวข้อ (แจ้ง 2026-10-22)
 * Run: npx tsx src/lib/upload-article/link-insert.test.ts
 */
import { relinkInternalLinks, unwrapSiteLinks } from './link-insert';
import { linkPoolForArticle, pickLinksForKeyword } from './internal-links';
import { DEFAULT_UPLOAD_INTERNAL_LINKS } from './types';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

const hosts = new Set(['example.com']);
const stripA = (s: string) => s.replace(/<\/?a\b[^>]*>/g, '');

{
  const html = '<p>อ่านเรื่อง <a href="https://www.example.com/kitchen/">ปลวกกินไม้</a> ได้ที่นี่ และ <a href="https://other.org/x">แหล่งอ้างอิง</a></p><h2><a href="https://example.com/h">หัวข้อ</a></h2><div class="content-cta"><p><a href="https://example.com/contact">ติดต่อ</a></p></div><p><a href="#faq">FAQ</a></p>';
  const r = unwrapSiteLinks(html, hosts);
  assert(r.removed === 1, 'ถอดเฉพาะลิงก์เข้าเว็บตัวเองในย่อหน้า (www. นับเป็น host เดียวกัน)');
  assert(r.html.includes('https://other.org/x') && r.html.includes('https://example.com/h') && r.html.includes('https://example.com/contact') && r.html.includes('#faq'), 'ไม่แตะลิงก์ภายนอก, หัวข้อ, กล่อง CTA และ #anchor');
  assert(stripA(r.html) === stripA(html), 'ข้อความเดิมทุกตัวอักษร');
}
{
  const pool = [
    { keyword: 'ไม้อัดกันปลวก', url: 'https://example.com/plywood/' },
    { keyword: 'ปลวกกินไม้', url: 'https://example.com/termite/' },
  ];
  const html = '<p>บ้านที่ใช้ <a href="https://example.com/kitchen/">ปลวกกินไม้</a> เสี่ยงมาก</p><p>ควรเลือกไม้อัดกันปลวก ตั้งแต่แรก</p>';
  const r = relinkInternalLinks(html, pool, 5, hosts);
  assert(r.removed === 1 && r.inserted.length === 2, 'relink: ถอดลิงก์ผิด 1 แล้วใส่ใหม่ 2');
  assert(r.html.includes('href="https://example.com/termite/" data-ua-link="1">ปลวกกินไม้</a>') && !r.html.includes('/kitchen/'), 'anchor ชี้ URL ของคู่ keyword ที่ตรงกัน');
  assert(stripA(r.html) === stripA(html), 'relink ไม่เปลี่ยนถ้อยคำ');
}
{
  const links = { ...DEFAULT_UPLOAD_INTERNAL_LINKS, manual: [{ keyword: 'ปลวกกินไม้อัด', url: 'https://example.com/a/' }, { keyword: 'ลามิเนต', url: 'https://example.com/b/' }] };
  const pool = linkPoolForArticle(links, { slug: 'x', ownKeywords: ['ปลวกกินไม้อัด'] });
  assert(pool.length === 1 && pool[0].keyword === 'ลามิเนต', 'keyword หลักของบทความเองไม่เป็น anchor ไปหน้าอื่น');
}
{
  const links = {
    ...DEFAULT_UPLOAD_INTERNAL_LINKS,
    linksPerArticle: '3',
    manual: [
      { keyword: 'ปลวกกินไม้', url: 'https://example.com/1/' },
      { keyword: 'สินเชื่อบ้าน', url: 'https://example.com/2/' },
      { keyword: 'ทาสีรั้ว', url: 'https://example.com/3/' },
    ],
  };
  const picked = pickLinksForKeyword(links, { keyword: 'ปลวกกินไม้อัด', slug: 'termite-plywood' });
  assert(picked.length === 1 && picked[0].keyword === 'ปลวกกินไม้', 'เลือกเฉพาะลิงก์ที่หัวข้อตรงกับ keyword');
}

{
  const pool = [
    { keyword: 'ปลวกกินไม้', url: 'https://example.com/termite/' },
    { keyword: 'ปลวกกินไม้', url: 'https://example.com/other/' },
  ];
  const html = '<p>บ้านนี้ปลวกกินไม้ เยอะ</p><p>อีกหลังก็ปลวกกินไม้ เหมือนกัน</p>';
  const once = relinkInternalLinks(html, pool, 5, hosts, () => true);
  const twice = relinkInternalLinks(once.html, pool, 5, hosts, () => true);
  assert(once.inserted.length === 1 && twice.inserted.length === 0 && twice.html === once.html, 'relink รันซ้ำได้ผลเท่าเดิม ไม่ใช้ anchor เดิมซ้ำไปหน้าอื่น');
}

console.log(`\n${passed} passed`);
