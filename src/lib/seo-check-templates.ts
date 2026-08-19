// ─────────────────────────────────────────────────────────────────────────────
//  SEO Task Checklist — Starter Templates (config, ไม่ใช่ mock data)
//
//  ใช้เป็นต้นแบบ checklist เริ่มต้นสำหรับ On-Page SEO / Technical SEO /
//  Indexing & Crawling ผู้ใช้กด "เริ่มต้นจาก Template Checklist" แล้วระบบจะสร้าง
//  งานจริงใน DB จาก template เหล่านี้ (bulk POST ไปที่ /api/projects/[id]/seo-tasks)
//
//  โครงหมวด (SEO Audit → List) อ้างอิงตารางตรวจ SEO ที่เจ้าของโปรเจคใช้จริง
//  desc ของแต่ละหมวด = "Solution & Impact on SEO" คือเหตุผลว่าทำแล้วได้อะไร
//  ส่วน task ในหมวด = Action ที่ลงมือทำได้จริงและกดติ๊กเสร็จได้
// ─────────────────────────────────────────────────────────────────────────────

export type SeoTaskArea = "ONPAGE" | "TECHNICAL" | "INDEXING";

export type SeoTaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface SeoCheckCategory {
  id: string;
  label: string;
  desc: string;
}

export interface SeoCheckTemplateTask {
  title: string;
  detail?: string;
  priority?: SeoTaskPriority;
}

// ─── On-Page SEO ──────────────────────────────────────────────────────────────

export const ONPAGE_CATEGORIES: SeoCheckCategory[] = [
  { id: "title-meta", label: "Meta Tags", desc: "ช่วยให้ Search Engine เข้าใจเนื้อหา และดึงให้ผู้ใช้คลิกเข้ามา" },
  { id: "heading", label: "Heading", desc: "สร้างลำดับชั้นเนื้อหาที่ชัดเจน และเพิ่มความเกี่ยวข้องของคีย์เวิร์ด" },
  { id: "intro-description", label: "Introduction & Description", desc: "ดึงผู้อ่านให้อยู่ต่อ และทำให้เนื้อหาตรงกับ search intent มากขึ้น" },
  { id: "content-expansion", label: "Content Expansion", desc: "เปิดโอกาสติดอันดับคีย์เวิร์ดใหม่ ๆ และดึงทราฟฟิกเพิ่ม" },
  { id: "content-reoptimization", label: "Content Reoptimization", desc: "อัปเดตเนื้อหาเดิมให้ยังตรงกับความต้องการ เพื่อรักษาอันดับไม่ให้ตก" },
  { id: "table-of-contents", label: "Table of Contents", desc: "ทำให้โครงสร้างเนื้อหาชัดเจน ทั้งผู้อ่านและ Search Engine เข้าใจง่ายขึ้น" },
  { id: "image-seo", label: "Alternative Text", desc: "ช่วยให้ Search Engine เข้าใจรูปภาพ และเพิ่มการเข้าถึง (Accessibility)" },
  { id: "internal-links", label: "Internal Links", desc: "เพิ่มเวลาที่ผู้ใช้อยู่บนเว็บ และกระจาย authority ไปยังหน้าอื่น" },
  { id: "external-links", label: "External Links", desc: "เพิ่มความน่าเชื่อถือของเนื้อหาด้วยการอ้างอิงแหล่งข้อมูลที่มีอำนาจ" },
];

export const ONPAGE_TEMPLATES: Record<string, SeoCheckTemplateTask[]> = {
  "title-meta": [
    { title: "Title มี main keyword และยาว 50-60 ตัวอักษร", priority: "HIGH" },
    { title: "Meta description 120-158 ตัวอักษร ชวนคลิก", priority: "MEDIUM" },
    { title: "Title แต่ละหน้าไม่ซ้ำกัน (unique)", priority: "HIGH" },
    { title: "Meta description มี CTA หรือ value proposition ชัดเจน", priority: "LOW" },
    { title: "ตรวจ Title/Meta ที่ Google เขียนทับเอง แล้วปรับให้ตรงกับ intent", priority: "LOW" },
  ],
  heading: [
    { title: "มี H1 เดียวต่อหน้า และมี keyword หลัก", priority: "HIGH" },
    { title: "โครงสร้าง H2/H3 เรียงลำดับตรรกะ ไม่ข้ามระดับ", priority: "MEDIUM" },
    { title: "Heading สื่อความหมายของเนื้อหาย่อยแต่ละส่วน", priority: "LOW" },
    { title: "ไม่มีการยัด keyword ใน heading จนอ่านไม่เป็นธรรมชาติ", priority: "MEDIUM" },
  ],
  "intro-description": [
    { title: "ย่อหน้าแรกตอบคำถามหลักของ keyword ภายใน 2-3 บรรทัด", priority: "HIGH" },
    { title: "เกริ่นนำมี keyword หลักภายใน 100 คำแรก", priority: "HIGH" },
    { title: "ระบุกลุ่มผู้อ่านและสิ่งที่จะได้รับจากบทความให้ชัดเจน", priority: "MEDIUM" },
    { title: "เกริ่นนำสอดคล้องกับ Title/Meta ไม่หลอกให้คลิก (no clickbait)", priority: "MEDIUM" },
  ],
  "content-expansion": [
    { title: "หา subtopic ที่คู่แข่ง Top 10 มีแต่หน้าเรายังไม่มี", priority: "HIGH" },
    { title: "เพิ่มหัวข้อจาก People Also Ask และ query ใน Search Console ที่ยังไม่ครอบคลุม", priority: "HIGH" },
    { title: "เพิ่มตาราง ตัวอย่าง หรือเคสจริง เพื่อจับ long-tail keyword", priority: "MEDIUM" },
    { title: "เพิ่มส่วน FAQ ท้ายบทความสำหรับคำถามที่พบบ่อย", priority: "MEDIUM" },
    { title: "แตกหัวข้อที่ใหญ่พอเป็นบทความใหม่ แล้วลิงก์กลับเป็น topic cluster", priority: "LOW" },
  ],
  "content-reoptimization": [
    { title: "หาหน้าที่อันดับตกจาก Search Console (เทียบ 3 เดือนล่าสุด)", priority: "HIGH" },
    { title: "อัปเดตข้อมูล ตัวเลข และปีในเนื้อหาให้เป็นปัจจุบัน", priority: "HIGH" },
    { title: "เพิ่มคีย์เวิร์ดที่ได้ impression แต่ยังไม่ติดอันดับเข้าไปในเนื้อหา", priority: "MEDIUM" },
    { title: "ปรับ Title/Meta ของหน้าที่ CTR ต่ำกว่าค่าเฉลี่ยของเว็บ", priority: "MEDIUM" },
    { title: "อัปเดตวันที่แก้ไขล่าสุด (dateModified) หลังปรับเนื้อหาจริง", priority: "LOW" },
  ],
  "table-of-contents": [
    { title: "บทความยาวเกิน 1,000 คำ มีสารบัญอยู่ต้นหน้า", priority: "MEDIUM" },
    { title: "สารบัญลิงก์ไปยัง anchor ของแต่ละ H2/H3 ได้จริง", priority: "MEDIUM" },
    { title: "ชื่อหัวข้อในสารบัญตรงกับ heading ในเนื้อหา", priority: "LOW" },
    { title: "สารบัญใช้งานได้บนมือถือ (ยุบ/ขยายได้ ไม่บังเนื้อหา)", priority: "LOW" },
  ],
  "image-seo": [
    { title: "รูปภาพทุกรูปมี Alt text ที่สื่อความหมาย", priority: "HIGH" },
    { title: "Alt text ของรูปหลักมี keyword ของหน้าอย่างเป็นธรรมชาติ", priority: "MEDIUM" },
    { title: "รูปตกแต่งที่ไม่มีความหมายตั้ง alt ว่าง (alt=\"\") ไม่ใส่มั่ว", priority: "LOW" },
    { title: "ชื่อไฟล์รูปภาพสื่อความหมาย (ไม่ใช่ IMG_1234.jpg)", priority: "LOW" },
    { title: "บีบอัดรูปภาพและใช้ format ที่เหมาะสม (WebP/AVIF)", priority: "MEDIUM" },
    { title: "ใช้ lazy loading สำหรับรูปที่ไม่ได้อยู่ above the fold", priority: "LOW" },
  ],
  "internal-links": [
    { title: "มีลิงก์ภายในไปยังหน้าที่เกี่ยวข้อง อย่างน้อย 3-5 ลิงก์", priority: "MEDIUM" },
    { title: "Anchor text สื่อความหมาย ไม่ใช้ 'คลิกที่นี่'", priority: "LOW" },
    { title: "มีลิงก์จากหน้า Pillar/Hub มายังหน้านี้ (topic cluster)", priority: "MEDIUM" },
    { title: "ไม่มีหน้าสำคัญที่ไม่มีลิงก์ภายในชี้เข้าเลย (orphan page)", priority: "MEDIUM" },
  ],
  "external-links": [
    { title: "อ้างอิงแหล่งข้อมูลที่น่าเชื่อถืออย่างน้อย 1-2 แห่งต่อบทความ", priority: "MEDIUM" },
    { title: "ไม่ลิงก์ออกไปยังเว็บสแปมหรือเว็บคุณภาพต่ำ", priority: "HIGH" },
    { title: "ลิงก์ภายนอกเปิดแท็บใหม่ และตั้ง rel ให้เหมาะสม (nofollow/sponsored เมื่อจำเป็น)", priority: "LOW" },
    { title: "ตรวจสอบลิงก์ภายนอกไม่เสีย และปลายทางยังเกี่ยวข้องกับเนื้อหา", priority: "MEDIUM" },
  ],
};

// ─── Technical SEO ────────────────────────────────────────────────────────────

export const TECHNICAL_CATEGORIES: SeoCheckCategory[] = [
  { id: "sitemap", label: "Sitemap.xml", desc: "ช่วยให้ Search Engine ค้นพบและจัดทำดัชนีทุกหน้าสำคัญได้อย่างมีประสิทธิภาพ" },
  { id: "robots", label: "Robots.txt", desc: "ควบคุมการเข้าถึงของบอท ให้ crawl ถูกต้องและไม่เปิดข้อมูลที่ไม่ควรเปิด" },
  { id: "pagespeed", label: "Page Speed", desc: "ลด bounce rate และช่วยอันดับ เพราะ Google ให้ความสำคัญกับเว็บที่โหลดเร็ว" },
  { id: "structured-data", label: "Schema Markup", desc: "ช่วยให้ Google เข้าใจเนื้อหาเฉพาะทาง (สินค้า, FAQ) และสร้าง Rich Snippet" },
  { id: "hreflang", label: "Hreflang", desc: "ทำให้ผู้ใช้เห็นเวอร์ชันภาษาและภูมิภาคของเนื้อหาที่ถูกต้อง" },
  { id: "robots-tag", label: "Robots Tag", desc: "ควบคุมการ index/crawl รายหน้า ไม่ให้หน้าที่ไม่ต้องการโผล่ในผลการค้นหา" },
  { id: "language-tag", label: "Language Tag", desc: "ระบุภาษาหลักของหน้า เพื่อให้ Search Engine แสดงเวอร์ชันที่ถูกต้องแก่ผู้ใช้" },
  { id: "https-security", label: "SSL Certificate (HTTPS)", desc: "เข้ารหัสข้อมูลระหว่างเซิร์ฟเวอร์กับผู้ใช้ สร้างความน่าเชื่อถือ และเป็นสัญญาณจัดอันดับ" },
  { id: "canonical", label: "Canonical Tag", desc: "แก้ปัญหาเนื้อหาซ้ำ ป้องกันการถูกลดอันดับจาก duplicate content" },
];

export const TECHNICAL_TEMPLATES: Record<string, SeoCheckTemplateTask[]> = {
  sitemap: [
    { title: "sitemap.xml เข้าถึงได้และเป็น XML ที่ valid", priority: "HIGH" },
    { title: "sitemap มีเฉพาะ URL ที่ index ได้ (ตอบ 200 และเป็น canonical)", priority: "MEDIUM" },
    { title: "ส่ง sitemap เข้า Google Search Console แล้ว", priority: "MEDIUM" },
    { title: "sitemap อัปเดตอัตโนมัติเมื่อมีหน้าใหม่ และมี lastmod ที่ถูกต้อง", priority: "LOW" },
  ],
  robots: [
    { title: "robots.txt เข้าถึงได้และไม่บล็อกหน้าสำคัญ", priority: "HIGH" },
    { title: "robots.txt ระบุบรรทัด Sitemap: URL", priority: "LOW" },
    { title: "บล็อกหน้า admin / staging / ผลค้นหาภายใน ไม่ให้กิน crawl budget", priority: "MEDIUM" },
    { title: "ไม่ใช้ robots.txt บล็อกหน้าที่ต้องการให้ตั้ง noindex (บอทต้องเข้าไปอ่านได้)", priority: "MEDIUM" },
  ],
  pagespeed: [
    { title: "LCP ผ่านเกณฑ์ (ต่ำกว่า 2.5s) บนหน้าสำคัญ", priority: "HIGH" },
    { title: "INP ผ่านเกณฑ์ (ต่ำกว่า 200ms)", priority: "MEDIUM" },
    { title: "CLS ผ่านเกณฑ์ (ต่ำกว่า 0.1)", priority: "MEDIUM" },
    { title: "ตรวจคะแนน PageSpeed Insights ทั้งมือถือและเดสก์ท็อป", priority: "MEDIUM" },
    { title: "บีบอัดและใช้ next-gen format สำหรับรูปภาพ", priority: "MEDIUM" },
    { title: "ลด render-blocking resources (CSS/JS)", priority: "LOW" },
  ],
  "structured-data": [
    { title: "มี Organization หรือ LocalBusiness schema ระดับเว็บไซต์", priority: "MEDIUM" },
    { title: "หน้าเนื้อหาใส่ schema ตรงประเภท (Article / Product / Service)", priority: "MEDIUM" },
    { title: "ใส่ FAQ schema ในหน้าที่มีส่วนคำถามที่พบบ่อยจริง", priority: "LOW" },
    { title: "ตรวจด้วย Rich Results Test ไม่มี error", priority: "MEDIUM" },
    { title: "ข้อมูลใน schema ตรงกับที่แสดงบนหน้าจริง ไม่ใส่ข้อมูลที่ผู้ใช้มองไม่เห็น", priority: "HIGH" },
  ],
  hreflang: [
    { title: "ทุกหน้าที่มีหลายภาษามี hreflang ครบทุกเวอร์ชัน", priority: "HIGH" },
    { title: "hreflang อ้างอิงกลับหากันครบถ้วน (return link)", priority: "HIGH" },
    { title: "มี x-default สำหรับผู้ใช้ที่ไม่ตรงกับภาษาใดเลย", priority: "MEDIUM" },
    { title: "รหัสภาษา/ประเทศถูกต้องตามมาตรฐาน (th-TH, en-US)", priority: "MEDIUM" },
    { title: "hreflang ชี้ไปยัง URL ที่เป็น canonical และตอบ 200", priority: "MEDIUM" },
  ],
  "robots-tag": [
    { title: "หน้าสำคัญไม่มี noindex โดยไม่ตั้งใจ", priority: "CRITICAL" },
    { title: "หน้า thank you / filter / ผลค้นหาภายใน ตั้ง noindex ไว้", priority: "MEDIUM" },
    { title: "ไม่ใช้ noindex ร่วมกับ canonical ที่ชี้เข้าหน้าเดียวกัน", priority: "MEDIUM" },
    { title: "ตรวจ X-Robots-Tag ระดับ HTTP header ว่าไม่ขัดกับ meta robots", priority: "LOW" },
  ],
  "language-tag": [
    { title: "ทุกหน้ามี <html lang=\"...\"> ตรงกับภาษาของเนื้อหาจริง", priority: "HIGH" },
    { title: "ไม่มีหน้าที่ระบุ lang ผิดภาษา (เช่นหน้าไทยแต่ตั้ง lang=\"en\")", priority: "MEDIUM" },
    { title: "Content-Language header (ถ้ามี) ไม่ขัดกับ html lang", priority: "LOW" },
  ],
  "https-security": [
    { title: "เว็บไซต์ใช้ HTTPS ทั้งหมด ไม่มี mixed content", priority: "CRITICAL" },
    { title: "http เปลี่ยนเส้นทางไปยัง https อัตโนมัติ (301)", priority: "HIGH" },
    { title: "SSL certificate ยังไม่หมดอายุ และตั้งต่ออายุอัตโนมัติไว้", priority: "HIGH" },
    { title: "ใช้โดเมนเดียวเป็นหลัก (www หรือ non-www) แล้ว redirect อีกแบบเข้ามา", priority: "MEDIUM" },
  ],
  canonical: [
    { title: "ทุกหน้ามี canonical tag ชี้ไปยัง URL ที่ถูกต้อง", priority: "HIGH" },
    { title: "canonical เป็น absolute URL และเป็น self-referencing ในหน้าปกติ", priority: "MEDIUM" },
    { title: "ไม่มี canonical ชี้ไขว้กันเป็นวงจร (canonical loop)", priority: "MEDIUM" },
    { title: "canonical ไม่ขัดกับ sitemap และลิงก์ภายใน", priority: "MEDIUM" },
  ],
};

// ─── Indexing & Crawling ──────────────────────────────────────────────────────

export const INDEXING_CATEGORIES: SeoCheckCategory[] = [
  { id: "not-found-redirect", label: "Not Found (404) and Redirect", desc: "แก้ลิงก์เสียด้วย 301 redirect ไปยังหน้าใหม่ที่ถูกต้อง" },
  { id: "broken-url-check", label: "Broken URL Check", desc: "ป้องกันประสบการณ์ใช้งานที่แย่และคะแนนเว็บที่ติดลบจากลิงก์ที่ใช้งานไม่ได้" },
  { id: "crawled-not-indexed", label: "Crawled - Not Indexed", desc: "ต้องปรับคุณภาพหน้าหรืออัปเดต sitemap เพื่อกระตุ้นให้ Googlebot จัดทำดัชนี" },
  { id: "discovered-not-indexed", label: "Discovered - Not Indexed", desc: "ต้องแก้ไขให้หน้าถูกจัดทำดัชนีและปรากฏในผลการค้นหา" },
  { id: "server-error-5xx", label: "Server Error (5xx)", desc: "ต้องแก้ปัญหาเซิร์ฟเวอร์เพื่อให้เว็บไซต์เข้าถึงได้ตลอดเวลา" },
  { id: "duplicate-without-canonical", label: "Duplicate w/o Canonical", desc: "ป้องกันปัญหาเนื้อหาซ้ำด้วยการกำหนด canonical tag ให้ทุกหน้า" },
];

export const INDEXING_TEMPLATES: Record<string, SeoCheckTemplateTask[]> = {
  "not-found-redirect": [
    { title: "รวบรวมหน้า 404 ทั้งหมดจาก Search Console และ server log", priority: "HIGH" },
    { title: "ทำ 301 redirect จาก URL เก่าไปยังหน้าที่เนื้อหาใกล้เคียงที่สุด", priority: "HIGH" },
    { title: "ไม่ redirect ทุก URL ที่หายไปเข้าหน้าแรก (เลี่ยง soft 404)", priority: "MEDIUM" },
    { title: "ไม่มี redirect chain เกิน 2 ต่อ และไม่มี redirect loop", priority: "MEDIUM" },
    { title: "หน้า 404 จริงคืนสถานะ 404 และมีทางออกให้ผู้ใช้ (ค้นหา/เมนู)", priority: "LOW" },
  ],
  "broken-url-check": [
    { title: "สแกนลิงก์ภายในทั้งเว็บและแก้ลิงก์เสียทั้งหมด", priority: "HIGH" },
    { title: "แก้ลิงก์เสียในเมนูหลัก footer และ sitemap ก่อนเป็นอันดับแรก", priority: "HIGH" },
    { title: "ตรวจลิงก์ภายนอกที่เสียหรือถูกเปลี่ยนปลายทาง", priority: "MEDIUM" },
    { title: "ตรวจรูปภาพและไฟล์แนบที่ลิงก์เสีย (404 ของ asset)", priority: "LOW" },
    { title: "ตั้งรอบตรวจลิงก์เสียซ้ำอย่างน้อยเดือนละครั้ง", priority: "LOW" },
  ],
  "crawled-not-indexed": [
    { title: "ดึงรายการหน้า Crawled - currently not indexed จาก Search Console", priority: "HIGH" },
    { title: "ประเมินความบางของเนื้อหา แล้วเพิ่มคุณค่าให้หน้าที่ถูกข้าม", priority: "HIGH" },
    { title: "เพิ่มลิงก์ภายในจากหน้าที่มี authority มายังหน้าที่ยังไม่ถูก index", priority: "MEDIUM" },
    { title: "รวมหน้าที่ซ้ำซ้อนหรือคุณค่าต่ำเข้าด้วยกัน แล้ว redirect", priority: "MEDIUM" },
    { title: "ยืนยันว่าหน้าอยู่ใน sitemap แล้วกด Request Indexing", priority: "MEDIUM" },
  ],
  "discovered-not-indexed": [
    { title: "ดึงรายการหน้า Discovered - currently not indexed จาก Search Console", priority: "HIGH" },
    { title: "ตรวจว่าเซิร์ฟเวอร์ตอบเร็วพอ ไม่ทำให้ Google ชะลอการ crawl", priority: "HIGH" },
    { title: "ลดจำนวน URL คุณค่าต่ำที่กิน crawl budget (filter/parameter)", priority: "MEDIUM" },
    { title: "เพิ่มลิงก์ภายในจากหน้าแรกหรือหน้า hub มายังหน้าที่ยังไม่ถูก crawl", priority: "MEDIUM" },
    { title: "ตรวจ sitemap ว่ามี lastmod ถูกต้องและส่งเข้า Search Console แล้ว", priority: "MEDIUM" },
  ],
  "server-error-5xx": [
    { title: "ตรวจ Search Console หา URL ที่คืนสถานะ 5xx", priority: "CRITICAL" },
    { title: "ตรวจ server log หาสาเหตุ (timeout, memory, rate limit)", priority: "HIGH" },
    { title: "ตรวจว่าไม่ได้บล็อก Googlebot ด้วย firewall/WAF/rate limit", priority: "HIGH" },
    { title: "ตั้ง uptime monitoring และแจ้งเตือนเมื่อเว็บล่ม", priority: "MEDIUM" },
    { title: "ทดสอบซ้ำหลังแก้ แล้วกด Validate Fix ใน Search Console", priority: "MEDIUM" },
  ],
  "duplicate-without-canonical": [
    { title: "ดึงรายการ Duplicate without user-selected canonical จาก Search Console", priority: "HIGH" },
    { title: "ใส่ canonical แบบ self-referencing ให้ทุกหน้า", priority: "HIGH" },
    { title: "รวม URL ที่ต่างกันแค่ parameter / www / trailing slash ให้ชี้ canonical เดียว", priority: "MEDIUM" },
    { title: "ตรวจว่า canonical ไม่ขัดกับ sitemap และลิงก์ภายใน", priority: "MEDIUM" },
    { title: "ตรวจเนื้อหาซ้ำระหว่างหน้าจริง แล้วรวมหรือเขียนใหม่ให้ต่างกัน", priority: "MEDIUM" },
  ],
};

// ─── Lookup ───────────────────────────────────────────────────────────────────

const CATEGORIES_BY_AREA: Record<SeoTaskArea, SeoCheckCategory[]> = {
  ONPAGE: ONPAGE_CATEGORIES,
  TECHNICAL: TECHNICAL_CATEGORIES,
  INDEXING: INDEXING_CATEGORIES,
};

const TEMPLATES_BY_AREA: Record<SeoTaskArea, Record<string, SeoCheckTemplateTask[]>> = {
  ONPAGE: ONPAGE_TEMPLATES,
  TECHNICAL: TECHNICAL_TEMPLATES,
  INDEXING: INDEXING_TEMPLATES,
};

export function getCategories(area: SeoTaskArea): SeoCheckCategory[] {
  return CATEGORIES_BY_AREA[area] ?? [];
}

export function getTemplates(area: SeoTaskArea): Record<string, SeoCheckTemplateTask[]> {
  return TEMPLATES_BY_AREA[area] ?? {};
}
