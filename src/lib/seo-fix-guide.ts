// ─────────────────────────────────────────────────────────────────────────────
//  SEO Fix Guide — ขั้นตอนแก้ปัญหาแบบทำตามได้เลยสำหรับทุก finding id ของ seo-audit.ts
//  (คำสั่งเจ้าของ 2026-09-11) ผลสแกนต้องพ่วงวิธีแก้ที่เจาะจง ไม่ใช่แค่บอกว่าอะไรผิด
//
//  ใช้โดย:
//  - seo-audit.ts: `add()` ดึง fix/aiSuggest มาแปะให้ทุก finding อัตโนมัติจาก id
//  - seo-task-expand.ts: ดึง actionLabel มาตั้งชื่อ task รายหน้า
//  - route from-scan: ดึง SeoAiSuggestKind เพื่อรู้ว่า finding ไหนเรียก AI ได้
// ─────────────────────────────────────────────────────────────────────────────

/** ชนิดข้อความที่ให้ AI แนะนำ 1-3 แบบ */
export type SeoAiSuggestKind = 'title' | 'metaDescription' | 'h1' | 'lead' | 'contentTopics'

/** ป้ายกำกับงานย่อยต่อหน้า — ใช้ต่อท้ายเป็น "${label} หน้า ${path}" (เฉพาะ finding ที่ถูกแยกเป็นรายหน้า) */
export const SEO_ACTION_LABEL: Record<string, string> = {
  // ONPAGE
  'title-missing': 'ใส่ title',
  'title-length': 'ปรับความยาว title',
  'title-duplicate': 'แก้ title ซ้ำ',
  'meta-desc-missing': 'เขียน meta description',
  'meta-desc-length': 'ปรับความยาว meta description',
  'h1-missing': 'เพิ่ม H1',
  'h1-multiple': 'ลด H1 ให้เหลืออันเดียว',
  'heading-skip': 'แก้ลำดับ heading',
  'thin-content': 'เพิ่มเนื้อหา',
  'lead-weak': 'เขียนย่อหน้าแรกใหม่',
  'toc-missing': 'เพิ่มสารบัญ',
  'image-alt': 'ใส่ alt text ให้รูป',
  'internal-links-few': 'เพิ่มลิงก์ภายใน',
  'orphan-pages': 'เพิ่มลิงก์ชี้มาหน้านี้',
  'external-links-none': 'อ้างอิงแหล่งข้อมูลภายนอก',
  // TECHNICAL
  'noindex-pages': 'ตรวจ noindex',
  'lang-missing': 'ใส่ lang ที่ <html>',
  'viewport-missing': 'เพิ่ม meta viewport',
  'canonical-missing': 'ใส่ canonical',
  'schema-missing': 'เพิ่ม Schema JSON-LD',
  'mixed-content': 'แก้ mixed content',
  // INDEXING
  'canonical-cross': 'ตรวจ canonical ชี้ออก',
  'broken-internal': 'แก้ลิงก์เสีย',
  'server-5xx': 'แก้เซิร์ฟเวอร์ 5xx',
}

/** finding id → ชนิดข้อความที่ให้ AI แนะนำ — ไม่มีใน map = ไม่ใช้ AI */
export const SEO_AI_SUGGEST: Record<string, SeoAiSuggestKind> = {
  'title-missing': 'title',
  'title-length': 'title',
  'title-duplicate': 'title',
  'meta-desc-missing': 'metaDescription',
  'meta-desc-length': 'metaDescription',
  'h1-missing': 'h1',
  'thin-content': 'contentTopics',
  'lead-weak': 'lead',
}

/** finding id → ขั้นตอนแก้แบบทำตามได้เลย (บรรทัดขึ้นต้นด้วย "- " ทุกข้อ) */
export const SEO_FIX_GUIDE: Record<string, string> = {
  // ── TECHNICAL: robots / sitemap / https ─────────────────────────────────
  'robots-missing': [
    '- สร้างไฟล์ robots.txt ใหม่ที่ราก domain (เช่น https://example.com/robots.txt)',
    '- ใส่อย่างน้อย "User-agent: *" และบรรทัด "Sitemap: https://example.com/sitemap.xml"',
    '- อัปโหลดผ่าน hosting/CMS แล้วเปิด URL ตรวจว่าอ่านไฟล์ได้จริงด้วย view-source',
    '- ยืนยันด้วย Google Search Console > robots.txt Tester (หรือ URL inspection)',
  ].join('\n'),
  'robots-disallow-all': [
    '- เปิดไฟล์ robots.txt ที่ราก domain แล้วหาแถว "Disallow: /" ใต้ "User-agent: *"',
    '- ลบทิ้งหรือแก้เป็น "Disallow:" (ว่าง) หรือระบุเฉพาะ path ที่ต้องการกันจริง ๆ',
    '- ตรวจว่า path สำคัญ (หน้าแรก, บทความ, สินค้า) ไม่ติด disallow อื่นแฝงอยู่',
    '- เช็คด้วย Search Console > robots.txt Tester แล้วขอ re-crawl หน้าใหม่',
  ].join('\n'),
  'robots-no-sitemap': [
    '- เปิดไฟล์ robots.txt ที่ราก domain',
    '- เพิ่มบรรทัด "Sitemap: https://<โดเมน>/sitemap.xml" (ใส่ URL เต็ม ไม่ใช่ path สั้น)',
    '- บันทึกแล้วเปิด URL robots.txt ซ้ำเพื่อตรวจว่าเห็นบรรทัดนี้จริง',
    '- ส่ง sitemap ซ้ำใน Google Search Console > Sitemaps เพื่อให้ re-crawl',
  ].join('\n'),
  'sitemap-missing': [
    '- สร้างไฟล์ sitemap.xml (ปั๊มจาก CMS/ปลั๊กอิน SEO หรือ script) ให้ครอบคลุมทุกหน้าที่ไม่ถูก noindex',
    '- วางไว้ที่ราก domain หรือ path ที่ประกาศไว้ใน robots.txt',
    '- ยืนยันว่าเปิด URL แล้วได้ XML ที่ถูกต้อง (view-source ตรวจ <urlset>/<loc>)',
    '- ส่งเข้า Google Search Console > Sitemaps',
  ].join('\n'),
  'sitemap-empty': [
    '- ตรวจ script/ปลั๊กอินที่ generate sitemap ว่าทำไมไม่ดึง URL เข้ามา (เช่น query เงื่อนไข noindex ผิด)',
    '- เติม <url><loc>...</loc></url> ให้ครบทุกหน้าที่ต้องการให้ index',
    '- เปิด URL sitemap ตรวจว่ามี <loc> มากกว่า 0 รายการจริง',
    '- ส่ง sitemap ใหม่ใน Search Console แล้วรอ crawl stats อัปเดต',
  ].join('\n'),
  'https-no-redirect': [
    '- ตั้งค่า redirect 301 จาก http:// ไป https:// ที่ hosting/Cloudflare (Always Use HTTPS) หรือใน .htaccess/next.config',
    '- ครอบคลุมทั้ง root domain และทุก path ไม่ใช่แค่หน้าแรก',
    '- ทดสอบด้วย curl -I http://<โดเมน> ว่าได้ 301/308 ไปที่ https',
    '- ตรวจซ้ำด้วย Search Console URL inspection ว่า URL แบบ http ถูก redirect ไม่ใช่ error',
  ].join('\n'),
  'www-duplicate': [
    '- เลือกโดเมนหลักหนึ่งชุด (มี www หรือไม่มี) แล้วตั้ง 301 redirect อีกชุดมาหาโดเมนหลักที่ Cloudflare/hosting',
    '- ตั้ง canonical ของทุกหน้าให้ชี้โดเมนหลักเดียวกันเป็นการยืนยันซ้ำ',
    '- ตรวจ Google Search Console ว่าตั้ง preferred domain/canonical ตรงกัน',
    '- ทดสอบด้วย curl -I ทั้งสองโดเมนว่าโดเมนรอง redirect มาโดเมนหลักจริง',
  ].join('\n'),
  'hreflang-no-default': [
    '- เปิด <head> ของหน้าที่มีชุด hreflang แล้วเพิ่ม <link rel="alternate" hreflang="x-default" href="..."> ชี้หน้าเริ่มต้นที่ต้องการ',
    '- ใส่ให้ครบทุกหน้าที่มีชุด hreflang เดียวกัน (ต้องมีครบทุกภาษารวม x-default ในทุกหน้า)',
    '- ตรวจด้วย view-source หรือ Search Console International Targeting',
    '- ยืนยันด้วย hreflang testing tool ว่าไม่มี error ขาด x-default',
  ].join('\n'),
  'pagespeed-slow': [
    '- ลดขนาดภาพ (บีบอัด/ใช้ WebP) และเปิด lazy-load ให้ภาพนอกจอแรก',
    '- ลด JS/CSS ที่ block การ render (defer/async script ที่ไม่จำเป็นตอนโหลดแรก)',
    '- ใช้ CDN/cache สำหรับ static asset และเปิด server-side/edge caching',
    '- รัน PageSpeed Insights ซ้ำหลังแก้ เพื่อดูว่า LCP/CLS/TBT ผ่านเกณฑ์',
  ].join('\n'),

  // ── ONPAGE ───────────────────────────────────────────────────────────────
  'title-missing': [
    '- แก้ <title> ใน <head> ของหน้านี้ (หรือช่อง SEO Title ใน CMS)',
    '- ใส่คีย์เวิร์ดหลักไว้ต้นประโยค ความยาวราว 50-60 ตัวอักษร',
    '- ตรวจว่าไม่ซ้ำกับ title ของหน้าอื่น',
    '- ยืนยันด้วย view-source หรือ Search Console URL inspection',
  ].join('\n'),
  'title-length': [
    '- แก้ <title> ใน <head> ของหน้านี้ (หรือช่อง SEO Title ใน CMS)',
    '- ใส่คีย์เวิร์ดหลักไว้ต้นประโยค ตัดคำฟุ่มเฟือย ให้อยู่ราว 50-60 ตัวอักษร',
    '- ตรวจว่าไม่ซ้ำกับหน้าอื่น',
    '- ยืนยันด้วย view-source หรือดูตัวอย่างใน Search Console',
  ].join('\n'),
  'title-duplicate': [
    '- แก้ title ของแต่ละหน้าให้ไม่ซ้ำกัน โดยเติมรายละเอียดเฉพาะของหน้านั้น (ทำเล/รุ่น/หัวข้อย่อย)',
    '- แก้ที่ <title> ใน <head> หรือช่อง SEO Title ใน CMS ของแต่ละหน้า',
    '- ตรวจให้แน่ใจว่าคีย์เวิร์ดหลักยังอยู่ต้นประโยค',
    '- ยืนยันด้วย view-source ทุกหน้าที่เกี่ยวข้อง',
  ].join('\n'),
  'meta-desc-missing': [
    '- เขียน meta description ใหม่ในช่อง SEO Description ของ CMS (หรือ <meta name="description"> ใน <head>)',
    '- ยาวราว 120-158 ตัวอักษร มีคีย์เวิร์ดหลักและ call to action',
    '- ตรวจว่าไม่ซ้ำกับหน้าอื่น',
    '- ยืนยันด้วย view-source',
  ].join('\n'),
  'meta-desc-length': [
    '- แก้ <meta name="description"> ใน <head> หรือช่อง SEO Description ใน CMS',
    '- ปรับความยาวให้อยู่ราว 120-158 ตัวอักษร ให้จบประโยคสมบูรณ์ไม่ถูกตัดกลางคำ',
    '- ใส่ call to action ท้ายประโยค',
    '- ยืนยันด้วย view-source',
  ].join('\n'),
  'h1-missing': [
    '- เพิ่มแท็ก <h1> หนึ่งอันในเนื้อหาหน้านี้ (หรือช่องหัวข้อหลักใน CMS)',
    '- ใช้คีย์เวิร์ดหลักของหน้า ให้สื่อความหมายตรงกับ title',
    '- ตรวจว่าไม่มี <h1> อันอื่นซ้ำ',
    '- ยืนยันด้วย view-source หรือ inspect element',
  ].join('\n'),
  'h1-multiple': [
    '- เปลี่ยน <h1> ที่เกินมาให้เป็น <h2> ตามลำดับโครงสร้างเนื้อหา (คงไว้ <h1> เดียว)',
    '- แก้ในเทมเพลต/CMS ของหน้านี้โดยตรง',
    '- ตรวจว่า <h1> ที่เหลือยังสื่อความหมายหลักของหน้า',
    '- ยืนยันด้วย view-source หรือ inspect element',
  ].join('\n'),
  'heading-skip': [
    '- ไล่ลำดับ heading จาก H2 ไป H3 ไป H4 ตามลำดับ อย่ากระโดดข้ามระดับ (เช่น H2 ตรงไป H4)',
    '- แก้โครงสร้างหัวข้อในเนื้อหาหรือเทมเพลตของหน้านี้',
    '- ตรวจทั้งหน้าว่าไม่มีจุดอื่นที่ข้ามระดับซ้ำ',
    '- ยืนยันด้วย inspect element หรือ extension ตรวจ heading outline',
  ].join('\n'),
  'thin-content': [
    '- เพิ่มเนื้อหาให้ครบอย่างน้อย 300 คำ โดยขยายหัวข้อที่มีอยู่ให้ละเอียดขึ้น (ตัวอย่าง/ขั้นตอน/ข้อมูลสนับสนุน)',
    '- แก้ในเนื้อหาบทความ/หน้าใน CMS โดยตรง',
    '- อย่ายัดคำฟุ่มเฟือยเพื่อให้ครบจำนวน ต้องเป็นเนื้อหาที่มีประโยชน์จริง',
    '- ตรวจความยาวซ้ำหลังแก้ (นับคำใน CMS หรือเครื่องมือนับคำ)',
  ].join('\n'),
  'lead-weak': [
    '- เขียนย่อหน้าแรกใหม่ให้ตอบคำถามหลักของหน้าใน 2-3 ประโยคแรก ก่อนขยายความ',
    '- แก้ในเนื้อหาส่วนต้นของหน้าใน CMS',
    '- ใส่คีย์เวิร์ดหลักและคำตอบตรงประเด็นไว้ต้นย่อหน้า (ช่วยสัญญาณ AEO/featured snippet)',
    '- อ่านทวนว่าอ่าน 2-3 บรรทัดแรกแล้วเข้าใจคำตอบทันที',
  ].join('\n'),
  'toc-missing': [
    '- เพิ่มสารบัญ (Table of Contents) ที่ต้นบทความ ลิงก์ไปแต่ละหัวข้อด้วย anchor (#id)',
    '- ใส่ id ให้ทุกแท็ก heading ที่ต้องการให้สารบัญลิงก์ถึง',
    '- แก้ในเทมเพลตบทความหรือใช้ปลั๊กอิน TOC ของ CMS',
    '- ทดสอบคลิกลิงก์ในสารบัญว่าพาไปหัวข้อที่ถูกต้อง',
  ].join('\n'),
  'image-alt': [
    '- ใส่ attribute alt ให้ครบทุก <img> ที่ยังไม่มี บรรยายสิ่งที่อยู่ในภาพสั้น ๆ ตรงบริบท',
    '- แก้ในเนื้อหา/CMS ที่แทรกรูป หรือ media library ถ้า CMS รองรับใส่ alt กลาง',
    '- ใส่คีย์เวิร์ดที่เกี่ยวข้องเมื่อสมเหตุสมผล ห้ามยัดคีย์เวิร์ดเกินจริง',
    '- ยืนยันด้วย view-source หรือ inspect element ว่าทุกรูปมี alt',
  ].join('\n'),
  'internal-links-few': [
    '- เพิ่มลิงก์ภายในไปหน้าที่เกี่ยวข้อง (บทความ/บริการ/หมวดหมู่ใกล้เคียง) อย่างน้อย 3-5 ลิงก์',
    '- แทรกลิงก์ในเนื้อหาแบบเนียน ๆ ตรงจุดที่พูดถึงหัวข้อนั้น',
    '- แก้ในเนื้อหาบทความหรือ CMS ของหน้านี้',
    '- ตรวจว่าลิงก์ทุกอันเปิดได้จริง ไม่ 404',
  ].join('\n'),
  'orphan-pages': [
    '- หาหน้าที่เกี่ยวข้อง (หมวดหมู่/เมนู/บทความอื่น) แล้วเพิ่มลิงก์ชี้มาหน้านี้',
    '- พิจารณาเพิ่มในเมนูนำทาง, breadcrumb, หรือ related-posts ถ้าเหมาะสม',
    '- แก้ในเนื้อหา/เทมเพลตของหน้าที่จะลิงก์มา',
    '- ตรวจซ้ำด้วยการ crawl เว็บอีกรอบว่าหน้านี้ถูกลิงก์ถึงแล้ว',
  ].join('\n'),
  'external-links-none': [
    '- เพิ่มลิงก์อ้างอิงไปแหล่งข้อมูลภายนอกที่น่าเชื่อถือ (งานวิจัย/หน่วยงานทางการ/ข่าวต้นทาง) อย่างน้อย 1-2 ลิงก์',
    '- แทรกลิงก์ตรงจุดที่อ้างอิงข้อมูล/สถิติ ในเนื้อหาบทความ',
    '- แก้ในเนื้อหาบทความใน CMS',
    '- ตรวจว่าลิงก์เปิดได้จริงและเกี่ยวข้องกับเนื้อหาจริง',
  ].join('\n'),

  // ── TECHNICAL: ระดับหน้า ─────────────────────────────────────────────────
  'noindex-pages': [
    '- ตรวจว่าตั้ง noindex ไว้โดยตั้งใจหรือไม่ (ดูในช่อง SEO/Robots ของหน้านี้ใน CMS)',
    '- ถ้าไม่ตั้งใจ ให้เอา <meta name="robots" content="noindex"> ออกจาก <head>',
    '- ถ้าตั้งใจ (เช่นหน้า thank-you/internal) ให้ปล่อยไว้ตามเดิม',
    '- ยืนยันด้วย view-source หรือ Search Console URL inspection',
  ].join('\n'),
  'lang-missing': [
    '- เพิ่ม attribute lang ที่แท็ก <html> เช่น <html lang="th"> สำหรับเว็บภาษาไทย',
    '- แก้ในเทมเพลตหลักของเว็บ (layout/_document) ให้มีผลทุกหน้า',
    '- ถ้าเว็บหลายภาษา ให้ตั้ง lang ตามภาษาของแต่ละหน้าจริง',
    '- ยืนยันด้วย view-source',
  ].join('\n'),
  'viewport-missing': [
    '- เพิ่ม <meta name="viewport" content="width=device-width, initial-scale=1"> ใน <head>',
    '- แก้ในเทมเพลตหลักของเว็บ (layout/_document) ให้มีผลทุกหน้า',
    '- ตรวจว่าหน้าเว็บ responsive บนมือถือหลังแก้',
    '- ยืนยันด้วย view-source และ Google Mobile-Friendly Test',
  ].join('\n'),
  'canonical-missing': [
    '- เพิ่ม <link rel="canonical" href="<URL ของหน้านี้>"> ใน <head>',
    '- แก้ในเทมเพลต/CMS ของหน้านี้ (self-referencing canonical)',
    '- ตรวจว่า URL ใน canonical ตรงกับ URL จริงเป๊ะ (https, มี/ไม่มี www ให้สอดคล้องกัน)',
    '- ยืนยันด้วย view-source',
  ].join('\n'),
  'schema-missing': [
    '- เพิ่ม Schema Markup แบบ JSON-LD ใน <head> หรือท้ายหน้า ให้ตรงชนิดหน้า (บทความ/บล็อกใช้ Article, หน้าทั่วไปใช้ WebPage, หน้าองค์กรใช้ Organization)',
    '- แก้ในเทมเพลต/CMS ของหน้านี้ หรือปลั๊กอิน SEO ที่รองรับ schema',
    '- ใส่ข้อมูลให้ครบตามชนิด schema (headline, author, datePublished ฯลฯ)',
    '- ตรวจด้วย Google Rich Results Test ว่าไม่มี error',
  ].join('\n'),
  'mixed-content': [
    '- เปลี่ยนลิงก์ทรัพยากร (รูป/สคริปต์/สไตล์) จาก http:// เป็น https:// หรือใช้ URL แบบ protocol-relative (//)',
    '- แก้ในเนื้อหา/เทมเพลตที่อ้างอิงทรัพยากรนั้น หรือตั้งค่า CDN ให้บังคับ https',
    '- ถ้าทรัพยากรมาจากโดเมนภายนอก ตรวจว่าโดเมนนั้นรองรับ https ก่อนเปลี่ยน',
    '- ยืนยันด้วย view-source และเช็ค console เบราว์เซอร์ว่าไม่มี mixed content warning',
  ].join('\n'),

  // ── INDEXING ─────────────────────────────────────────────────────────────
  'canonical-cross': [
    '- ตรวจว่าตั้งใจรวมหน้านี้เข้ากับ URL ปลายทางหรือไม่ (ดู <link rel="canonical"> ใน <head>)',
    '- ถ้าไม่ตั้งใจ ให้แก้ canonical ให้ชี้ URL ของตัวเอง (self-referencing)',
    '- ถ้าตั้งใจรวมจริง ให้ปล่อยไว้ตามเดิมแต่พิจารณาทำ 301 redirect แทนเพื่อความชัดเจน',
    '- ยืนยันด้วย view-source และ Search Console URL inspection',
  ].join('\n'),
  'broken-internal': [
    '- เปลี่ยนลิงก์ในหน้าต้นทางให้ชี้ URL ที่ถูกต้อง หรือทำ 301 redirect จาก URL เก่าไปหน้าที่เนื้อหาใกล้เคียงที่สุด',
    '- แก้ที่เนื้อหา/เมนู/CMS ของหน้าที่มีลิงก์นี้อยู่',
    '- ถ้าหน้าปลายทางถูกลบถาวรจริง ให้ตั้ง redirect ที่ hosting/Cloudflare หรือ .htaccess/next.config',
    '- ยืนยันด้วยการเปิด URL ซ้ำหรือ Search Console URL inspection ว่าไม่ตอบ 404 แล้ว',
  ].join('\n'),
  'server-5xx': [
    '- ตรวจ log เซิร์ฟเวอร์/แอปว่า URL นี้ error อะไร (timeout, memory, query ผิดพลาด)',
    '- แก้โค้ด/การตั้งค่าที่ทำให้ error แล้ว deploy ใหม่',
    '- ถ้าเป็นปัญหา capacity ชั่วคราว ให้ปรับ resource หรือ cache หน้านี้',
    '- ยืนยันด้วยการเปิด URL ซ้ำหรือ Search Console URL inspection ว่าตอบ 200 แล้ว',
  ].join('\n'),
  'soft-404': [
    '- ตั้งให้ URL ที่ไม่มีจริงตอบ HTTP 404 (หรือ 410 ถ้าลบถาวร) แทนที่จะตอบ 200',
    '- แก้ที่ routing/middleware ของแอป หรือตั้งค่า custom 404 page ใน hosting/CMS',
    '- ตรวจว่าเนื้อหาหน้า 404 ยังมีลิงก์กลับไปหน้าอื่นที่เกี่ยวข้อง (ไม่ทำให้ผู้ใช้ตัน)',
    '- ยืนยันด้วย curl -I ไปยัง URL มั่ว ๆ ว่าได้สถานะ 404 แล้ว',
  ].join('\n'),
}
