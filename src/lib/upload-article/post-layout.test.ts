/**
 * Regression: วิเคราะห์โครงบทความของเว็บ (ลำดับปก/อินโทร/สารบัญ/หัวข้อ/FAQ/CTA + ตำแหน่งสารบัญ)
 * และตัดสินว่าธีมแสดงรูป featured เองไหม — ใช้ตัดสินว่า push แล้วต้องวางสารบัญ/ปกตรงไหน
 * Run: npx tsx src/lib/upload-article/post-layout.test.ts
 */
import { analyzePostLayout, featuredShownInPage, postAuthorContent, summarizeLayouts, type PostLayout, type PostSample } from './site-scan';
import { TOC_POSITION_MAX } from './toc-position';
import { effectiveBodyCover, scanWantsBodyCover } from './types';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

const IMG_W = (src: string) =>
  `<div class="elementor-widget elementor-widget-image"><img src="${src}" width="1024" height="683"></div>`;
const EDITOR = (inner: string) =>
  `<div class="elementor-widget elementor-widget-text-editor"><div class="elementor-widget-container">${inner}</div></div>`;
const ELTOC =
  '<div class="elementor-widget elementor-widget-table-of-contents"><div class="elementor-toc__header"><h4 class="elementor-toc__header-title">สารบัญ</h4></div><ul><li>หัวข้อ A</li><li>หัวข้อ B</li></ul></div>';
const EZTOC = '<div id="ez-toc-container" class="ez-toc-container"><p class="ez-toc-title">สารบัญ</p><ul><li><a href="#a">A</a></li></ul></div>';
const SEC = (n: number) => `<h2>หัวข้อ ${n}</h2><p>เนื้อหา ${n}</p>`;
const join = (order: string[]) => order.join('>');

console.log('บทความ Elementor แบบ UME (ปก → อินโทร → สารบัญ → หัวข้อ)');
{
  const html = IMG_W('https://x.com/wp-content/uploads/2026/01/cover-1024x683.jpg') + EDITOR('<p>อินโทร</p>') + ELTOC + SEC(1) + SEC(2) + SEC(3);
  const l = analyzePostLayout(html);
  assert(l !== null, 'วิเคราะห์ได้');
  assert(join(l!.order) === 'cover>intro>toc>sections', 'ลำดับ cover,intro,toc,sections');
  assert(l!.tocPosition === 0, 'สารบัญก่อน H2 แรก = ตำแหน่ง 0');
  assert(l!.h2Count === 3, 'นับ h2 = 3 (ไม่นับหัวกล่องสารบัญ)');
  assert(l!.coverSrc === 'https://x.com/wp-content/uploads/2026/01/cover-1024x683.jpg', 'coverSrc ตรง');

  const h2Toc = ELTOC.replace(/h4/g, 'h2');
  const l2 = analyzePostLayout(IMG_W('https://x.com/a.jpg') + EDITOR('<p>อินโทร</p>') + h2Toc + SEC(1) + SEC(2));
  assert(l2!.h2Count === 2, 'หัวกล่องสารบัญเป็น h2 ก็ไม่ถูกนับเป็นหัวข้อ');
  assert(l2!.tocPosition === 0, 'หัวกล่องสารบัญเป็น h2 ยังได้ตำแหน่ง 0');
}

console.log('บทความ WP ธรรมดา (ไม่มีรูป)');
{
  const l = analyzePostLayout(`<p>อินโทร</p>${EZTOC}${SEC(1)}${SEC(2)}`);
  assert(join(l!.order) === 'intro>toc>sections', 'ลำดับ intro,toc,sections');
  assert(l!.tocPosition === 0, 'สารบัญ ez-toc ก่อน H2 แรก = 0');
  assert(l!.coverSrc === null, 'ไม่มีปก');
}

console.log('ตำแหน่งสารบัญ');
{
  const mid = analyzePostLayout(`<p>อินโทร 1</p>${EZTOC}<p>อินโทร 2</p>${SEC(1)}${SEC(2)}`);
  assert(mid!.tocPosition === -1, 'สารบัญกลางอินโทร = -1');
  const afterSecond = analyzePostLayout(`<p>อินโทร</p>${SEC(1)}${SEC(2)}${EZTOC}${SEC(3)}${SEC(4)}`);
  assert(afterSecond!.tocPosition === 2, 'สารบัญหลัง H2 ที่ 2 = 2');
  const afterLast = analyzePostLayout(`<p>อินโทร</p>${SEC(1)}${SEC(2)}${EZTOC}`);
  assert(afterLast!.tocPosition === TOC_POSITION_MAX, 'สารบัญหลัง H2 สุดท้าย = TOC_POSITION_MAX');
  const none = analyzePostLayout(`<p>อินโทร</p>${SEC(1)}`);
  assert(none!.tocPosition === undefined, 'ไม่มีสารบัญ = tocPosition undefined');
}

console.log('รูปปก');
{
  const small = analyzePostLayout(`<img src="https://x.com/icon.png" width="64" height="64"><p>อินโทร</p>${SEC(1)}`);
  assert(small!.coverSrc === null && !small!.order.includes('cover'), 'รูป width < 120 ไม่นับเป็นปก');
  const emoji = analyzePostLayout(`<img class="emoji" src="https://s.w.org/emoji.png"><p>อินโทร</p>${SEC(1)}`);
  assert(emoji!.coverSrc === null, 'อีโมจิไม่นับเป็นปก');
  const lazy = analyzePostLayout(
    `<img src="data:image/gif;base64,AAAA" data-lazy-src="https://x.com/real.jpg" width="800" height="500"><p>อินโทร</p>${SEC(1)}`,
  );
  assert(lazy!.coverSrc === 'https://x.com/real.jpg', 'ใช้ data-lazy-src แทน src');
  const afterText = analyzePostLayout(`<p>อินโทร</p><img src="https://x.com/late.jpg" width="800" height="500">${SEC(1)}`);
  assert(afterText!.coverSrc === null, 'รูปหลังย่อหน้าแรกไม่ใช่ปก');
}

console.log('FAQ และ CTA');
{
  const l = analyzePostLayout(
    `<p>อินโทร</p>${SEC(1)}<h2>คำถามที่พบบ่อย</h2><p>ถาม</p><div class="cta-box"><a href="/x">ติดต่อเรา</a></div>`,
  );
  assert(join(l!.order) === 'intro>sections>faq>cta', 'ลำดับ intro,sections,faq,cta');
  assert(l!.h2Count === 2, 'หัวข้อ FAQ นับเป็น h2');
  const en = analyzePostLayout(`<p>intro</p>${SEC(1)}<h2>FAQ</h2><p>q</p>`);
  assert(en!.order[en!.order.length - 1] === 'faq', 'หัวข้อ FAQ ภาษาอังกฤษถูกจับ');
  const line = analyzePostLayout(`<p>อินโทร</p>${SEC(1)}<p><a href="https://line.me/R/ti/p/@abc">LINE</a></p>`);
  assert(line!.order[line!.order.length - 1] === 'cta', 'ลิงก์ LINE ถูกจับเป็น cta');
}

console.log('เนื้อหาว่าง');
{
  assert(analyzePostLayout('') === null, 'สตริงว่าง = null');
  assert(analyzePostLayout('<div><script>var a=1</script><style>p{}</style><!-- x --></div>') === null, 'ไม่มีข้อความ = null');
}

console.log('summarizeLayouts');
{
  const mk = (order: PostLayout['order'], coverSrc: string | null, tocPosition?: number): PostLayout => ({
    order,
    h2Count: 3,
    coverSrc,
    ...(tocPosition !== undefined ? { tocPosition } : {}),
  });
  assert(summarizeLayouts([], true) === null, 'รายการว่าง = null');
  const s = summarizeLayouts(
    [
      mk(['cover', 'intro', 'toc', 'sections'], 'a.jpg', 0),
      mk(['cover', 'intro', 'toc', 'sections'], 'b.jpg', 0),
      mk(['intro', 'sections'], null),
    ],
    true,
  );
  assert(s !== null && s.posts === 3, 'นับจำนวนบทความ');
  assert(join(s!.order) === 'cover>intro>toc>sections' && s!.orderCount === 2, 'ลำดับส่วนใหญ่ + orderCount');
  assert(s!.coverInContent === 2, 'coverInContent นับเฉพาะที่มีปก');
  assert(s!.toc !== undefined && s!.toc.posts === 2 && s!.toc.position === 0 && s!.toc.count === 2, 'toc ส่วนใหญ่ {posts, position, count}');
  assert(s!.featuredShown === true, 'featuredShown ส่งผ่านค่า true');
  const s2 = summarizeLayouts([mk(['intro', 'sections'], null)], null);
  assert(s2!.featuredShown === null, 'featuredShown ส่งผ่านค่า null');
  assert(s2!.toc === undefined, 'ไม่มีสารบัญเลย = ไม่มี toc');
  assert(summarizeLayouts([mk(['intro'], null)], false)!.featuredShown === false, 'featuredShown ส่งผ่านค่า false');
}

console.log('featuredShownInPage');
{
  const FEATURED = 'https://x.com/wp-content/uploads/2026/01/cover.jpg';
  const page = (head: string, body: string) =>
    `<html><body>${head}<div class="entry-content">${body}</div></body></html>`;
  assert(
    featuredShownInPage(page('<div class="hero"><img src="https://x.com/wp-content/uploads/2026/01/cover-scaled.jpg"></div>', '<p>เนื้อหา</p>'), '<p>เนื้อหา</p>', FEATURED) === true,
    'รูปอยู่นอกกล่องเนื้อหา (cover-scaled) = true',
  );
  assert(featuredShownInPage(page('<div>x</div>', '<p>เนื้อหา</p>'), '<p>เนื้อหา</p>', FEATURED) === false, 'ไม่เจอรูปเลย = false');
  const inRegion = '<p>เนื้อหา</p><img src="https://x.com/wp-content/uploads/2026/01/cover-1024x683.jpg">';
  assert(featuredShownInPage(page('', inRegion), inRegion, FEATURED) === false, 'เจอแค่ในกล่อง และ REST มีรูปด้วย = false');
  assert(featuredShownInPage(page('', inRegion), '<p>เนื้อหา</p>', FEATURED) === true, 'เจอแค่ในกล่อง แต่ REST ไม่มี (ธีมแทรก) = true');
  assert(featuredShownInPage(page('', inRegion), null, FEATURED) === null, 'REST ปิด และเจอแค่ในกล่อง = null');
  assert(featuredShownInPage('<html><body><p>ไม่มีกล่อง</p></body></html>', null, FEATURED) === null, 'หากล่องเนื้อหาไม่เจอ = null');
  assert(featuredShownInPage(page('', '<p>x</p>'), null, 'https://x.com/a.jpg') === null, 'ชื่อไฟล์สั้นเกินไป = null');
  const inFooter = '<footer><img src="https://x.com/wp-content/uploads/2026/01/cover.jpg"></footer>';
  assert(featuredShownInPage(page(inFooter, '<p>เนื้อหา</p>'), '<p>เนื้อหา</p>', FEATURED) === false, 'รูปใน footer ไม่นับ');
  const elPage = `<html><body><div class="elementor-widget-theme-post-content"><div class="elementor-widget-container"><p>เนื้อหา</p></div></div></body></html>`;
  assert(featuredShownInPage(elPage, '<p>เนื้อหา</p>', FEATURED) === false, 'หากล่อง Elementor theme-post-content เจอ');
  const bgStyle = '<style>.elementor-element-abc{background-image:url("https://x.com/wp-content/uploads/2026/01/cover-1536x1024.jpg")}</style><div class="elementor-element-abc"></div>';
  assert(featuredShownInPage(page(bgStyle, '<p>เนื้อหา</p>'), '<p>เนื้อหา</p>', FEATURED) === true, 'featured เป็นพื้นหลังผ่าน <style> ในหน้า = true');
}

console.log('ใส่ปกในเนื้อหาจากผลสแกน');
{
  const L = (featuredShown: boolean | null, coverInContent: number, posts = 5) => ({ featuredShown, coverInContent, posts });
  assert(scanWantsBodyCover(L(false, 4)), 'ธีมไม่แสดง + บทความส่วนใหญ่ใส่ปกเอง (แบบ UME) = ใส่ให้');
  assert(!scanWantsBodyCover(L(false, 2)), 'ธีมไม่แสดง แต่บทความส่วนใหญ่ไม่มีปก = ไม่ใส่ (กัน CSS ที่มองไม่เห็น)');
  assert(!scanWantsBodyCover(L(true, 5)), 'ธีมแสดง featured = ไม่ใส่');
  assert(!scanWantsBodyCover(L(null, 5)), 'ตัดสินไม่ได้ = ไม่ใส่');
  assert(!scanWantsBodyCover(undefined), 'ผลสแกนเก่าไม่มี layout = ไม่ใส่ (เหมือนเดิม)');
  assert(effectiveBodyCover({ bodyCover: false, siteScan: { layout: L(false, 5) } }) === false, 'ทีมตั้งไม่ใส่เอง ชนะผลสแกน');
  assert(effectiveBodyCover({ bodyCover: true, siteScan: { layout: L(true, 0) } }) === true, 'ทีมตั้งใส่เอง ชนะผลสแกน');
  assert(effectiveBodyCover({ siteScan: { layout: L(false, 5) } }) === true, 'ไม่เคยตั้ง = ตามผลสแกน');
  assert(effectiveBodyCover({}) === false && effectiveBodyCover(null) === false, 'ไม่มีอะไรเลย = ไม่ใส่ (ค่าเดิม)');
}

console.log('postAuthorContent');
{
  const withRegion: PostSample = {
    link: 'https://x.com/p',
    content: null,
    page: '<html><body><header>เมนู</header><div class="entry-content"><p>เนื้อหาผู้เขียน</p></div></body></html>',
  };
  const out = postAuthorContent(withRegion);
  assert(out !== null && out.includes('เนื้อหาผู้เขียน') && !out.includes('เมนู'), 'ดึงเนื้อหาจากกล่องในหน้าจริงเมื่อ content เป็น null');
  assert(out !== null && !out.includes('class="entry-content"'), 'ไม่รวมแท็กเปิดของกล่อง');
  const elDoc: PostSample = {
    link: 'https://x.com/p',
    content: '<p>rest</p>',
    page: '<html><body><div class="entry-content"><div data-elementor-type="wp-post"><p>จาก Elementor</p></div></div></body></html>',
  };
  assert((postAuthorContent(elDoc) || '').includes('data-elementor-type="wp-post"'), 'มีเอกสาร Elementor = ใช้เอกสารนั้น');
  assert(postAuthorContent({ link: 'u', content: '<p>rest</p>', page: null }) === '<p>rest</p>', 'ไม่มีหน้า = ใช้ content จาก REST');
  assert(postAuthorContent({ link: 'u', content: null, page: '<html><body><p>ไม่มีกล่อง</p></body></html>' }) === null, 'ไม่มีกล่องและ content null = null');
}

console.log(`\nผ่านทั้งหมด ${passed} รายการ`);
