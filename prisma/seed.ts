import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { MEGA_ARTICLE_WRITER_PROMPT, ARTICLE_AUDIT_PROMPT, ARTICLE_FIX_PROMPT } from "../src/lib/default-prompts";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // ── Organization ────────────────────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { slug: "demo-org" },
    update: {},
    create: { name: "Demo Organization", slug: "demo-org", plan: "pro" },
  });

  // ── Users ────────────────────────────────────────────────────────────────────
  const users = await Promise.all([
    prisma.user.upsert({
      where: { email: "admin@example.com" },
      update: {},
      create: { name: "Admin User", email: "admin@example.com", password: await bcrypt.hash("admin123", 12), role: "ADMIN", organizationId: org.id, status: "ACTIVE" },
    }),
    prisma.user.upsert({
      where: { email: "manager@example.com" },
      update: {},
      create: { name: "SEO Manager", email: "manager@example.com", password: await bcrypt.hash("manager123", 12), role: "SEO_MANAGER", organizationId: org.id, status: "ACTIVE" },
    }),
    prisma.user.upsert({
      where: { email: "planner@example.com" },
      update: {},
      create: { name: "SEO Planner", email: "planner@example.com", password: await bcrypt.hash("planner123", 12), role: "SEO_PLANNER", organizationId: org.id, status: "ACTIVE" },
    }),
    prisma.user.upsert({
      where: { email: "writer@example.com" },
      update: {},
      create: { name: "Content Writer", email: "writer@example.com", password: await bcrypt.hash("writer123", 12), role: "WRITER", organizationId: org.id, status: "ACTIVE" },
    }),
    prisma.user.upsert({
      where: { email: "reviewer@example.com" },
      update: {},
      create: { name: "SEO Reviewer", email: "reviewer@example.com", password: await bcrypt.hash("reviewer123", 12), role: "REVIEWER", organizationId: org.id, status: "ACTIVE" },
    }),
    prisma.user.upsert({
      where: { email: "publisher@example.com" },
      update: {},
      create: { name: "Content Publisher", email: "publisher@example.com", password: await bcrypt.hash("publisher123", 12), role: "PUBLISHER", organizationId: org.id, status: "ACTIVE" },
    }),
  ]);

  const [admin, manager, , writer, reviewer] = users;

  // ── Brand Template ───────────────────────────────────────────────────────────
  const coJourneyTemplate = await prisma.brandTemplate.upsert({
    where: { id: "template-cojourneytravel" },
    update: {},
    create: {
      id: "template-cojourneytravel",
      organizationId: org.id,
      name: "Co Journey Visa Template",
      brandName: "Co Journey Visa",
      language: "th",
      brandVoice: "ภาษาทางการ น่าเชื่อถือ เชี่ยวชาญ เป็นมิตร ให้ข้อมูลที่ถูกต้องและเป็นประโยชน์",
      htmlStructure: "elementor-ready",
      colorTheme: "green-cream",
      ctaText: "ติดต่อทีมงาน Co Journey Visa เพื่อรับคำปรึกษาฟรี โทร 02-xxx-xxxx",
      contactBlock: "<div class='cta-contact'>ปรึกษาฟรี ไม่มีค่าใช้จ่าย | Line: @cojourneytravel | โทร: 02-xxx-xxxx</div>",
      referenceRules: "อ้างอิงแหล่งข้อมูลทางการเท่านั้น เช่น สถานทูต กรมการกงสุล NAATI",
      forbiddenClaims: "ห้ามรับประกันผลวีซ่า ห้ามโอ้อวดเกินจริง ห้ามระบุราคาที่ไม่ได้รับการยืนยัน",
      imageStyle: "professional-muted-green",
      schemaRules: "FAQPage JSON-LD required for all articles",
      isDefault: true,
    },
  });

  // ── Projects ─────────────────────────────────────────────────────────────────
  const project1 = await prisma.project.upsert({
    where: { id: "project-cojourneyvisa" },
    update: {},
    create: {
      id: "project-cojourneyvisa",
      organizationId: org.id,
      name: "Co Journey Visa",
      clientName: "Co Journey Visa",
      website: "cojourneyvisa.com",
      businessType: "Visa Agency",
      industry: "Travel / Visa Services",
      language: "th",
      market: "Thailand",
      status: "ACTIVE",
      targetAudience: "คนไทยที่ต้องการยื่นวีซ่าและเดินทางต่างประเทศ",
      defaultTemplateId: coJourneyTemplate.id,
      createdById: admin.id,
      ownerId: admin.id,
    },
  });

  const project2 = await prisma.project.upsert({
    where: { id: "project-abcdental" },
    update: {},
    create: {
      id: "project-abcdental",
      organizationId: org.id,
      name: "ABC Dental Clinic",
      clientName: "ABC Dental Clinic",
      website: "abcdentalclinic.com",
      businessType: "Dental Clinic",
      industry: "Healthcare",
      language: "th",
      market: "Thailand",
      status: "ACTIVE",
      targetAudience: "ผู้ป่วยทั่วไปที่ต้องการบริการทันตกรรมในกรุงเทพ",
      createdById: admin.id,
      ownerId: manager.id,
    },
  });

  const project3 = await prisma.project.upsert({
    where: { id: "project-bangkokcondo" },
    update: {},
    create: {
      id: "project-bangkokcondo",
      organizationId: org.id,
      name: "Bangkok Condo Leads",
      clientName: "Bangkok Condo Leads",
      website: "bangkokcondoleads.com",
      businessType: "Real Estate",
      industry: "Property",
      language: "en",
      market: "Thailand",
      status: "PLANNING",
      targetAudience: "Foreign buyers and investors looking for condos in Bangkok",
      createdById: admin.id,
      ownerId: manager.id,
    },
  });

  // ── Project Members ──────────────────────────────────────────────────────────
  const memberData = [
    // Project 1
    { id: "pm-coj-admin",    projectId: project1.id, userId: admin.id,    role: "PROJECT_ADMIN" },
    { id: "pm-coj-manager",  projectId: project1.id, userId: manager.id,  role: "SEO_MANAGER" },
    { id: "pm-coj-writer",   projectId: project1.id, userId: writer.id,   role: "WRITER" },
    { id: "pm-coj-reviewer", projectId: project1.id, userId: reviewer.id, role: "REVIEWER" },
    // Project 2
    { id: "pm-abc-admin",    projectId: project2.id, userId: admin.id,    role: "PROJECT_ADMIN" },
    { id: "pm-abc-manager",  projectId: project2.id, userId: manager.id,  role: "SEO_MANAGER" },
    { id: "pm-abc-writer",   projectId: project2.id, userId: writer.id,   role: "WRITER" },
    { id: "pm-abc-reviewer", projectId: project2.id, userId: reviewer.id, role: "REVIEWER" },
    // Project 3
    { id: "pm-bkk-admin",    projectId: project3.id, userId: admin.id,    role: "PROJECT_ADMIN" },
    { id: "pm-bkk-manager",  projectId: project3.id, userId: manager.id,  role: "SEO_MANAGER" },
    { id: "pm-bkk-writer",   projectId: project3.id, userId: writer.id,   role: "WRITER" },
    { id: "pm-bkk-reviewer", projectId: project3.id, userId: reviewer.id, role: "REVIEWER" },
  ];

  for (const m of memberData) {
    await prisma.projectMember.upsert({ where: { id: m.id }, update: {}, create: m });
  }

  // ── Keywords ─────────────────────────────────────────────────────────────────
  const keywordData = [
    // Project 1 - Co Journey Visa
    { id: "kw-schengen",       seedKeyword: "วีซ่าเชงเก้น",         keyword: "วีซ่าเชงเก้นคืออะไร",       relatedKeywords: JSON.stringify(["schengen visa thailand", "วีซ่ายุโรป", "ยื่นวีซ่าเชงเก้น"]), intent: "INFORMATIONAL", funnelStage: "TOFU",  priority: 1, volume: 8100, difficulty: 35, status: "GENERATED", projectId: project1.id },
    { id: "kw-schengen-reject", seedKeyword: "วีซ่าเชงเก้น",         keyword: "วีซ่าเชงเก้นไม่ผ่าน",       relatedKeywords: JSON.stringify(["วีซ่าถูกปฏิเสธ", "schengen rejected"]),                  intent: "INFORMATIONAL", funnelStage: "MOFU",  priority: 2, volume: 3600, difficulty: 28, status: "GENERATED", projectId: project1.id },
    { id: "kw-france-biz",     seedKeyword: "วีซ่าธุรกิจฝรั่งเศส", keyword: "วีซ่าธุรกิจฝรั่งเศส",       relatedKeywords: JSON.stringify(["france business visa", "วีซ่าทำงานฝรั่งเศส"]),            intent: "COMMERCIAL",    funnelStage: "BOFU",  priority: 1, volume: 1200, difficulty: 22, status: "APPROVED",  projectId: project1.id },
    { id: "kw-naati",          seedKeyword: "แปลเอกสาร NAATI",       keyword: "NAATI คืออะไร",              relatedKeywords: JSON.stringify(["naati translation", "แปล NAATI ออสเตรเลีย"]),             intent: "INFORMATIONAL", funnelStage: "TOFU",  priority: 2, volume: 2400, difficulty: 18, status: "GENERATED", projectId: project1.id },
    // Project 2 - ABC Dental
    { id: "kw-dental-implant", seedKeyword: "รากฟันเทียม",           keyword: "รากฟันเทียมราคาเท่าไร",      relatedKeywords: JSON.stringify(["dental implant cost", "รากฟันเทียมกรุงเทพ"]),              intent: "COMMERCIAL",    funnelStage: "BOFU",  priority: 1, volume: 5400, difficulty: 45, status: "GENERATED", projectId: project2.id },
    { id: "kw-dental-braces",  seedKeyword: "จัดฟัน",                 keyword: "จัดฟันใช้เวลานานแค่ไหน",    relatedKeywords: JSON.stringify(["braces duration", "จัดฟันระยะเวลา"]),                      intent: "INFORMATIONAL", funnelStage: "TOFU",  priority: 2, volume: 4200, difficulty: 30, status: "GENERATED", projectId: project2.id },
    { id: "kw-dental-whiten",  seedKeyword: "ฟอกสีฟัน",              keyword: "ฟอกสีฟันที่คลินิกได้ผลไหม", relatedKeywords: JSON.stringify(["teeth whitening results", "ฟอกสีฟัน laser"]),             intent: "INFORMATIONAL", funnelStage: "MOFU",  priority: 3, volume: 2800, difficulty: 25, status: "NEW",       projectId: project2.id },
    // Project 3 - Bangkok Condo
    { id: "kw-condo-buy",      seedKeyword: "buy condo bangkok",      keyword: "how to buy a condo in bangkok", relatedKeywords: JSON.stringify(["bangkok condo guide", "foreigner buy condo thailand"]), intent: "INFORMATIONAL", funnelStage: "TOFU",  priority: 1, volume: 3200, difficulty: 38, status: "GENERATED", projectId: project3.id },
    { id: "kw-condo-invest",   seedKeyword: "bangkok condo investment", keyword: "best areas to invest in bangkok condo", relatedKeywords: JSON.stringify(["bangkok property investment", "condo roi bangkok"]), intent: "COMMERCIAL", funnelStage: "MOFU", priority: 2, volume: 2100, difficulty: 42, status: "NEW", projectId: project3.id },
    { id: "kw-condo-price",    seedKeyword: "condo price sukhumvit",  keyword: "sukhumvit condo price per sqm 2025", relatedKeywords: JSON.stringify(["sukhumvit property price", "condo cost bangkok"]),   intent: "COMMERCIAL",    funnelStage: "BOFU",  priority: 3, volume: 1800, difficulty: 35, status: "NEW",       projectId: project3.id },
  ];

  for (const kw of keywordData) {
    await prisma.keyword.upsert({ where: { id: kw.id }, update: {}, create: kw });
  }

  // ── Sample WordPress Connection ─────────────────────────────────────────────
  const wpConn = await prisma.wordPressConnection.upsert({
    where: { id: "wp-cojour" },
    update: {},
    create: {
      id: "wp-cojour",
      organizationId: org.id,
      name: "Co Journey Visa — WordPress",
      siteUrl: "https://cojourneyvisa.com",
      username: "seo_admin",
      appPasswordEncrypted: "demo-app-password-not-real",
      defaultStatus: "draft",
    },
  });

  // ── Articles ─────────────────────────────────────────────────────────────────
  const SCHENGEN_OUTLINE = JSON.stringify({
    title: "วีซ่าเชงเก้นคืออะไร ใช้เดินทางประเทศไหนได้บ้าง",
    metaDescription: "วีซ่าเชงเก้นคืออะไร ใช้เดินทางกี่ประเทศ ขอที่ไหน ใช้เอกสารอะไรบ้าง อ่านครบจบในบทความนี้",
    estimatedWordCount: 2400,
    sections: [
      { heading: "H2: วีซ่าเชงเก้น (Schengen Visa) คืออะไร", subheadings: ["H3: ประวัติความเป็นมาของพื้นที่เชงเก้น", "H3: ประเทศที่ใช้วีซ่าเชงเก้นได้"], keyPoints: ["27 ประเทศ", "ฟรีเดินทาง"], wordCount: 400 },
      { heading: "H2: วีซ่าเชงเก้นมีกี่ประเภท", subheadings: ["H3: Type A — Transit", "H3: Type C — Short Stay", "H3: Type D — National Visa"], keyPoints: ["ท่องเที่ยว", "ธุรกิจ", "นักเรียน"], wordCount: 500 },
      { heading: "H2: เอกสารที่ต้องใช้ยื่นวีซ่าเชงเก้น", subheadings: ["H3: เอกสารส่วนตัว", "H3: เอกสารการเงิน", "H3: หลักฐานที่พัก"], keyPoints: ["Bank Statement", "ประกันเดินทาง"], wordCount: 600 },
      { heading: "H2: ขั้นตอนการยื่นวีซ่าเชงเก้น", subheadings: ["H3: จองนัดสถานทูต", "H3: เตรียมเอกสาร", "H3: วันสัมภาษณ์"], keyPoints: ["นัดล่วงหน้า 2-3 เดือน"], wordCount: 500 },
    ],
    faqSuggestions: ["วีซ่าเชงเก้น type c ใช้ได้นานแค่ไหน?", "ยื่นวีซ่าเชงเก้นใช้เวลากี่วัน?", "สถานทูตปฏิเสธวีซ่าเชงเก้นเพราะอะไร?"],
  });

  const SCHENGEN_HTML = `<article>
<h1>วีซ่าเชงเก้นคืออะไร ใช้เดินทางประเทศไหนได้บ้าง</h1>

<p><strong>วีซ่าเชงเก้น (Schengen Visa)</strong> คือวีซ่าที่อนุญาตให้ผู้ถือเดินทางเข้า-ออกและเคลื่อนย้ายระหว่างประเทศสมาชิกในเขต <em>Schengen Area</em> ได้อย่างอิสระ โดยไม่ต้องผ่านการตรวจคนเข้าเมืองทุกครั้ง</p>

<h2>วีซ่าเชงเก้นใช้ได้กี่ประเทศ</h2>
<p>ปัจจุบัน (2025) เขตเชงเก้นประกอบด้วย <strong>27 ประเทศ</strong> ได้แก่ ออสเตรีย เบลเยียม สาธารณรัฐเช็ก เดนมาร์ก เอสโตเนีย ฟินแลนด์ ฝรั่งเศส เยอรมนี กรีซ ฮังการี ไอซ์แลนด์ อิตาลี ลัตเวีย ลิกเตนสไตน์ ลิทัวเนีย ลักเซมเบิร์ก มอลตา เนเธอร์แลนด์ นอร์เวย์ โปแลนด์ โปรตุเกส สโลวาเกีย สโลวีเนีย สเปน สวีเดน และสวิตเซอร์แลนด์</p>

<h2>วีซ่าเชงเก้นมีกี่ประเภท</h2>
<ul>
  <li><strong>Type A (Airport Transit Visa)</strong> — สำหรับแวะเปลี่ยนเครื่องในสนามบิน ไม่ได้ออกจากเขต Transit</li>
  <li><strong>Type C (Short-Stay Visa)</strong> — เดินทางท่องเที่ยว ธุรกิจ หรือเยี่ยมครอบครัว ไม่เกิน 90 วัน ใน 180 วัน</li>
  <li><strong>Type D (National/Long-Stay Visa)</strong> — พำนักระยะยาวกว่า 90 วัน เช่น นักเรียน ทำงาน</li>
</ul>

<h2>เอกสารที่ต้องใช้ยื่นวีซ่าเชงเก้น</h2>
<ol>
  <li>หนังสือเดินทาง (อายุเหลือไม่น้อยกว่า 3 เดือน หลังวันเดินทางกลับ)</li>
  <li>รูปถ่ายตามมาตรฐานเชงเก้น</li>
  <li>Bank Statement ย้อนหลัง 3-6 เดือน (มียอดเพียงพอ)</li>
  <li>ประกันเดินทาง ครอบคลุมไม่น้อยกว่า 30,000 EUR</li>
  <li>หลักฐานที่พัก (Booking โรงแรม)</li>
  <li>ตั๋วเครื่องบินไปกลับ</li>
</ol>

<h2>ขั้นตอนการยื่นวีซ่าเชงเก้น</h2>
<p>1. <strong>เลือกสถานทูต</strong> — ยื่นที่สถานทูตของประเทศที่ใช้เวลาอยู่นานที่สุด หรือประเทศแรกที่เข้า<br>
2. <strong>จองนัด</strong> — จองล่วงหน้า 2-3 เดือน โดยเฉพาะช่วง High Season<br>
3. <strong>เตรียมเอกสาร</strong> — รวบรวมให้ครบก่อนวันนัด<br>
4. <strong>ยื่นและรอผล</strong> — โดยทั่วไปใช้เวลา 15 วันทำการ</p>

<div class="cta-box">
  <h3>ต้องการความช่วยเหลือยื่นวีซ่าเชงเก้น?</h3>
  <p>Co Journey Visa ให้บริการรับยื่นวีซ่าเชงเก้นครบวงจร พร้อมทีมผู้เชี่ยวชาญดูแลเอกสารทุกขั้นตอน</p>
  <a href="/contact" class="btn-primary">ปรึกษาฟรี →</a>
</div>

<section class="faq">
  <h2>คำถามที่พบบ่อย</h2>
  <details><summary>วีซ่าเชงเก้น Type C ใช้ได้นานแค่ไหน?</summary><p>ใช้ได้ไม่เกิน 90 วัน ใน 180 วัน นับจากวันที่เข้าเขตเชงเก้นครั้งแรก</p></details>
  <details><summary>ยื่นวีซ่าเชงเก้นใช้เวลากี่วัน?</summary><p>โดยทั่วไป 15 วันทำการ อาจนานกว่านั้นในช่วง High Season</p></details>
</section>
</article>`;

  const SCHENGEN_IMAGE_PROMPT = `Professional travel photography style, European passport stamps and visa documents arranged on a clean white desk, Schengen area map in background, soft natural lighting, shallow depth of field. Colors: navy blue, gold, white. Style: editorial, trustworthy, professional. NO text overlay. Aspect ratio 16:9. Photography, not illustration.`;

  const NAATI_HTML = `<article>
<h1>แปล NAATI คืออะไร ทำไมเอกสารออสเตรเลียต้องใช้</h1>

<p>หากคุณกำลังจะยื่นวีซ่าออสเตรเลีย หรือส่งเอกสารราชการไปออสเตรเลีย คำว่า <strong>NAATI</strong> คือสิ่งที่คุณต้องรู้จักก่อน เพราะเอกสารที่แปลโดยผู้แปล NAATI Certified เท่านั้นถึงจะได้รับการยอมรับจากหน่วยงานราชการออสเตรเลีย</p>

<h2>NAATI คืออะไร</h2>
<p><strong>NAATI</strong> ย่อมาจาก <em>National Accreditation Authority for Translators and Interpreters</em> คือหน่วยงานรัฐบาลออสเตรเลียที่รับผิดชอบออกใบรับรองนักแปลและล่ามอย่างเป็นทางการ ผู้แปลที่ผ่านการรับรองจาก NAATI เรียกว่า <strong>NAATI Certified Translator</strong></p>

<h2>เมื่อไรต้องใช้การแปล NAATI</h2>
<ul>
  <li>ยื่นวีซ่าออสเตรเลียทุกประเภท (Tourist, Student, Skilled, Family)</li>
  <li>ยื่นขอ Permanent Residency (PR)</li>
  <li>ส่งเอกสารการศึกษาไปสถาบันในออสเตรเลีย</li>
  <li>เอกสารทางกฎหมาย เช่น สัญญา, คำพิพากษา</li>
  <li>ใบทะเบียนสมรส, ทะเบียนบ้าน, สูติบัตร</li>
</ul>

<h2>เอกสารที่ Co Journey Visa รับแปล NAATI</h2>
<p>เราให้บริการแปลเอกสารภาษาไทย-อังกฤษ โดยนักแปล NAATI Certified ครอบคลุมเอกสารทุกประเภท ได้แก่:</p>
<ul>
  <li>หนังสือเดินทาง / บัตรประชาชน</li>
  <li>สูติบัตร / ใบสมรส / ทะเบียนบ้าน</li>
  <li>Transcript / ใบปริญญา</li>
  <li>ใบแสดงยอดบัญชีธนาคาร</li>
  <li>เอกสารบริษัท / หนังสือรับรองการทำงาน</li>
</ul>

<div class="cta-box">
  <h3>แปลเอกสาร NAATI รวดเร็ว ถูกต้อง 100%</h3>
  <p>ส่งเอกสารมาได้เลย ทีมผู้เชี่ยวชาญของเราพร้อมให้คำปรึกษาและดำเนินการให้</p>
  <a href="/contact" class="btn-primary">สอบถามราคา →</a>
</div>

<section class="faq">
  <h2>คำถามที่พบบ่อย</h2>
  <details><summary>ใช้เวลานานแค่ไหน?</summary><p>ปกติ 1-3 วันทำการ กรณีด่วนสามารถดำเนินการได้ภายใน 24 ชั่วโมง</p></details>
  <details><summary>ต้องส่งเอกสารตัวจริงมาไหม?</summary><p>ไม่จำเป็น ส่งสแกนความละเอียดสูงมาทาง Email หรือ LINE ได้เลย</p></details>
</section>
</article>`;

  const DENTAL_IMPLANT_HTML = `<article>
<h1>รากฟันเทียม คืออะไร ราคาเท่าไร ต้องทำกี่ครั้ง</h1>

<p><strong>รากฟันเทียม (Dental Implant)</strong> คือวิธีทดแทนฟันที่หายไปด้วยการฝังรากเทียมไทเทเนียมเข้าไปในกระดูกขากรรไกร เพื่อรองรับครอบฟันหรือฟันปลอม ทำให้รู้สึกและใช้งานได้ใกล้เคียงฟันแท้ที่สุด</p>

<h2>ข้อดีของรากฟันเทียม</h2>
<ul>
  <li>ดูเหมือนและใช้งานได้เหมือนฟันแท้</li>
  <li>ทนทาน อาจอยู่ได้ตลอดชีวิตหากดูแลดี</li>
  <li>ไม่ต้องถอดเข้าออก</li>
  <li>ป้องกันการสูญเสียกระดูกขากรรไกร</li>
  <li>ไม่ทำให้ฟันข้างเคียงสึก</li>
</ul>

<h2>ราคารากฟันเทียมที่ ABC Dental</h2>
<table>
  <tr><th>แพ็กเกจ</th><th>ราคา</th><th>รวม</th></tr>
  <tr><td>Standard Implant</td><td>35,000 บาท</td><td>รากฟัน + ครอบฟัน</td></tr>
  <tr><td>Premium Implant</td><td>55,000 บาท</td><td>รากฟัน Premium + ครอบ Zirconia</td></tr>
  <tr><td>All-on-4</td><td>280,000 บาท</td><td>ฟัน 1 ชุด 4 รากฟัน</td></tr>
</table>

<h2>ขั้นตอนการทำรากฟันเทียม</h2>
<ol>
  <li><strong>ตรวจประเมิน</strong> — X-Ray / CT Scan วัดความหนาแน่นกระดูก</li>
  <li><strong>ฝังรากฟัน</strong> — ผ่าตัดเล็กภายใต้การระงับความรู้สึก</li>
  <li><strong>รอ Osseointegration</strong> — 3-6 เดือน รากฟันเชื่อมกับกระดูก</li>
  <li><strong>ใส่ Abutment</strong> — ชิ้นส่วนเชื่อมต่อกับครอบฟัน</li>
  <li><strong>ครอบฟัน</strong> — ครอบฟันถาวร พอร์ซเลนหรือ Zirconia</li>
</ol>

<div class="cta-box">
  <h3>ปรึกษาฟรี ประเมินราคาทันที</h3>
  <p>ทันตแพทย์ผู้เชี่ยวชาญด้านรากฟันเทียม ประสบการณ์กว่า 15 ปี พร้อมดูแลคุณ</p>
  <a href="/appointment" class="btn-primary">จองนัดฟรี →</a>
</div>
</article>`;

  const WISDOM_TOOTH_HTML = `<article>
<h1>ถอนฟันคุด ควรทำไหม อันตรายไหม เจ็บแค่ไหน</h1>

<p>ฟันคุด (Wisdom Tooth) คือฟันกรามซี่สุดท้ายที่ขึ้นช้าที่สุด มักขึ้นช่วงอายุ 17-25 ปี หลายคนมักสงสัยว่า <strong>ถอนฟันคุดจำเป็นไหม</strong> และ <strong>เจ็บมากแค่ไหน</strong></p>

<h2>ต้องถอนฟันคุดเมื่อไร</h2>
<ul>
  <li>ฟันคุดขึ้นผิดทิศ กดทับฟันซี่ข้างเคียง</li>
  <li>มีอาการเจ็บปวดบริเวณฟันคุด</li>
  <li>เกิดการอักเสบหรือติดเชื้อซ้ำๆ</li>
  <li>ทำให้เกิดฟันผุที่ฟันข้างเคียง</li>
  <li>รบกวนการจัดฟัน</li>
</ul>

<h2>ขั้นตอนถอนฟันคุดที่ ABC Dental</h2>
<ol>
  <li>X-Ray ประเมินตำแหน่งฟันคุด</li>
  <li>ฉีดยาชาเฉพาะที่ (ไม่รู้สึกเจ็บระหว่างทำ)</li>
  <li>เอาฟันออกโดยทันตแพทย์ผู้เชี่ยวชาญ</li>
  <li>เย็บแผล (ถ้าจำเป็น)</li>
  <li>รับยาและคำแนะนำดูแลหลังถอน</li>
</ol>

<h2>ราคาถอนฟันคุด</h2>
<p>ราคาเริ่มต้น <strong>2,500 – 8,000 บาท</strong> ต่อซี่ ขึ้นอยู่กับความยากง่ายและตำแหน่งฟันคุด</p>

<div class="cta-box">
  <h3>กังวลเรื่องฟันคุด? ปรึกษาทันตแพทย์ฟรีวันนี้</h3>
  <a href="/appointment" class="btn-primary">จองนัดประเมินฟรี →</a>
</div>
</article>`;

  const articleData = [
    // ── Project 1 - Co Journey Visa ──────────────────────────────────────────
    {
      id: "art-schengen-what",
      title: "วีซ่าเชงเก้นคืออะไร ใช้เดินทางประเทศไหนได้บ้าง",
      slug: "visa-schengen-khu-arai",
      keywordId: "kw-schengen",
      funnelStage: "TOFU", searchIntent: "INFORMATIONAL",
      status: "ARTICLE_DONE",
      brief: "บทความอธิบายวีซ่าเชงเก้นอย่างละเอียด",
      outline: SCHENGEN_OUTLINE,
      htmlContent: SCHENGEN_HTML,
      imagePrompt: SCHENGEN_IMAGE_PROMPT,
      projectId: project1.id, assignedToId: writer.id, reviewerId: reviewer.id,
    },
    {
      id: "art-schengen-reject",
      title: "วีซ่าเชงเก้นไม่ผ่านเกิดจากอะไร และควรแก้ยังไง",
      slug: "visa-schengen-mai-phan",
      keywordId: "kw-schengen-reject",
      funnelStage: "MOFU", searchIntent: "INFORMATIONAL",
      status: "SEO_REVIEW",
      brief: "วิเคราะห์สาเหตุวีซ่าถูกปฏิเสธ",
      htmlContent: `<article><h1>วีซ่าเชงเก้นไม่ผ่านเกิดจากอะไร และควรแก้ยังไง</h1><p>วีซ่าเชงเก้นถูกปฏิเสธเป็นปัญหาที่หลายคนเผชิญ สาเหตุหลักมักเกิดจากเอกสารไม่ครบ ยอดเงินในบัญชีไม่เพียงพอ หรือประวัติการเดินทางที่น่าสงสัย</p><h2>สาเหตุที่วีซ่าเชงเก้นไม่ผ่าน</h2><ul><li>Bank Statement ไม่ผ่านเกณฑ์ (แนะนำขั้นต่ำ 50,000 บาท)</li><li>เอกสารที่พักหรือตั๋วไม่ชัดเจน</li><li>ไม่มีหลักฐานว่าจะเดินทางกลับ</li><li>ประวัติถูก Reject วีซ่าก่อนหน้า</li></ul><h2>วิธีแก้ไขและยื่นใหม่</h2><p>หากถูก Reject ไม่จำเป็นต้องหมดหวัง สามารถยื่นใหม่ได้หากแก้ไขจุดบกพร่อง แนะนำให้ใช้บริการผู้เชี่ยวชาญช่วยตรวจเอกสาร</p></article>`,
      seoTitle: "วีซ่าเชงเก้นไม่ผ่าน เกิดจากอะไร แก้ยังไง | Co Journey Visa",
      metaDescription: "รวมสาเหตุวีซ่าเชงเก้นถูกปฏิเสธ พร้อมวิธีแก้ไขและเตรียมเอกสารใหม่ให้ผ่าน อ่านก่อนยื่นใหม่",
      projectId: project1.id, assignedToId: writer.id, reviewerId: reviewer.id,
    },
    {
      id: "art-france-biz",
      title: "บริการรับยื่นวีซ่าธุรกิจฝรั่งเศสครบวงจร",
      slug: "borisarn-visa-thurakij-farangset",
      keywordId: "kw-france-biz",
      funnelStage: "BOFU", searchIntent: "COMMERCIAL",
      status: "OUTLINE_DONE",
      brief: "หน้าบริการยื่นวีซ่าธุรกิจฝรั่งเศส",
      outline: JSON.stringify({ title: "บริการรับยื่นวีซ่าธุรกิจฝรั่งเศสครบวงจร", estimatedWordCount: 1800, sections: [{ heading: "H2: ทำไมต้องใช้บริการ Co Journey Visa", subheadings: ["H3: ทีมผู้เชี่ยวชาญ", "H3: อัตราสำเร็จสูง"], wordCount: 400 }, { heading: "H2: ขั้นตอนการใช้บริการ", subheadings: ["H3: ปรึกษาฟรี", "H3: เตรียมเอกสาร", "H3: ยื่นและติดตามผล"], wordCount: 600 }], faqSuggestions: ["ค่าบริการรับยื่นวีซ่าธุรกิจเท่าไร?"] }),
      projectId: project1.id, assignedToId: writer.id,
    },
    {
      id: "art-naati",
      title: "แปล NAATI คืออะไร ทำไมเอกสารออสเตรเลียต้องใช้",
      slug: "naati-khu-arai",
      keywordId: "kw-naati",
      funnelStage: "TOFU", searchIntent: "INFORMATIONAL",
      status: "POSTED",
      brief: "อธิบาย NAATI certified translation",
      htmlContent: NAATI_HTML,
      seoTitle: "แปล NAATI คืออะไร เอกสารออสเตรเลียต้องใช้ทำไม | Co Journey",
      metaDescription: "NAATI คืออะไร ทำไมวีซ่าออสเตรเลียต้องใช้การแปลจาก NAATI Certified Translator อธิบายครบในบทความนี้",
      imagePrompt: `Professional document translation service concept: certified translator stamp on official documents, Australian passport with Thai documents side by side, clean minimal office background. Navy blue and gold color palette. Editorial photography style, 16:9.`,
      coverImageUrl: "https://images.unsplash.com/photo-1568992687947-868a62a9f521?w=1200&h=675&fit=crop",
      wordpressUrl: "https://cojourneyvisa.com/naati-khu-arai/",
      wordpressStatus: "publish",
      projectId: project1.id, assignedToId: writer.id, reviewerId: reviewer.id,
    },
    {
      id: "art-visa-guide",
      title: "คู่มือยื่นวีซ่าเชงเก้นด้วยตัวเองสำหรับคนไทย ปี 2025",
      slug: "guide-schengen-self-apply-thai-2025",
      keywordId: "kw-schengen",
      funnelStage: "MOFU", searchIntent: "INFORMATIONAL",
      status: "NEW",
      brief: "คู่มือยื่นวีซ่าด้วยตัวเอง",
      projectId: project1.id, assignedToId: writer.id,
    },
    // ── Project 2 - ABC Dental ───────────────────────────────────────────────
    {
      id: "art-dental-implant",
      title: "รากฟันเทียม คืออะไร ราคาเท่าไร ต้องทำกี่ครั้ง",
      slug: "dental-implant-cost-guide",
      keywordId: "kw-dental-implant",
      funnelStage: "BOFU", searchIntent: "COMMERCIAL",
      status: "ARTICLE_DONE",
      brief: "คู่มือรากฟันเทียมครบถ้วน",
      htmlContent: DENTAL_IMPLANT_HTML,
      imagePrompt: `Professional dental clinic interior: modern dental chair, implant model displayed on clean white surface, soft clinical lighting. Colors: white, light blue, silver. Editorial medical photography. 16:9 aspect ratio.`,
      projectId: project2.id, assignedToId: writer.id, reviewerId: reviewer.id,
    },
    {
      id: "art-dental-braces",
      title: "จัดฟันใช้เวลานานแค่ไหน ขั้นตอนมีอะไรบ้าง",
      slug: "braces-duration-process",
      keywordId: "kw-dental-braces",
      funnelStage: "TOFU", searchIntent: "INFORMATIONAL",
      status: "OUTLINE_DONE",
      brief: "อธิบายกระบวนการจัดฟัน",
      outline: JSON.stringify({ title: "จัดฟันใช้เวลานานแค่ไหน", estimatedWordCount: 2000, sections: [{ heading: "H2: จัดฟันใช้เวลาเฉลี่ยเท่าไร", subheadings: ["H3: จัดฟันโลหะ", "H3: Invisalign"], wordCount: 400 }, { heading: "H2: ขั้นตอนการจัดฟัน", subheadings: ["H3: ตรวจและวางแผน", "H3: ติดเครื่องมือ", "H3: นัดติดตาม", "H3: ถอดและทำรีเทนเนอร์"], wordCount: 700 }], faqSuggestions: ["จัดฟัน Invisalign เร็วกว่าโลหะไหม?"] }),
      projectId: project2.id, assignedToId: writer.id,
    },
    {
      id: "art-dental-whiten",
      title: "ฟอกสีฟัน laser ที่คลินิก vs ฟอกที่บ้าน อะไรดีกว่า",
      slug: "teeth-whitening-clinic-vs-home",
      keywordId: "kw-dental-whiten",
      funnelStage: "MOFU", searchIntent: "INFORMATIONAL",
      status: "SEO_REVIEW",
      brief: "เปรียบเทียบการฟอกสีฟัน",
      htmlContent: `<article><h1>ฟอกสีฟัน Laser ที่คลินิก vs ฟอกที่บ้าน อะไรดีกว่า</h1><p>การฟอกสีฟันมี 2 วิธีหลักคือทำที่คลินิกกับทำที่บ้าน แต่ละแบบมีข้อดี-ข้อเสียต่างกัน</p><h2>ฟอกสีฟันที่คลินิก (Laser Whitening)</h2><p>ใช้เจลฟอกสีฟันความเข้มข้นสูงร่วมกับแสง LED หรือ Laser เห็นผลทันทีใน 45-60 นาที สีฟันสว่างขึ้น 4-8 เฉด เหมาะสำหรับคนที่ต้องการผลรวดเร็ว</p><h2>ฟอกสีฟันที่บ้าน (Home Whitening)</h2><p>ใช้ถาดใส่เจลฟอกที่ทันตแพทย์ทำให้พอดีฟัน ใส่วันละ 30-60 นาที นาน 2-4 สัปดาห์ ราคาถูกกว่า เหมาะสำหรับผลที่ค่อยเป็นค่อยไป</p></article>`,
      seoTitle: "ฟอกสีฟัน Laser คลินิก vs บ้าน ต่างกันอย่างไร | ABC Dental",
      metaDescription: "เปรียบเทียบฟอกสีฟัน Laser ที่คลินิกกับ Home Whitening ราคา ผลลัพธ์ และความปลอดภัย เลือกแบบไหนดี",
      projectId: project2.id, assignedToId: writer.id, reviewerId: reviewer.id,
    },
    {
      id: "art-dental-wisdom",
      title: "ถอนฟันคุด ควรทำไหม อันตรายไหม เจ็บแค่ไหน",
      slug: "wisdom-tooth-removal-guide",
      keywordId: "kw-dental-braces",
      funnelStage: "TOFU", searchIntent: "INFORMATIONAL",
      status: "POSTED",
      brief: "คู่มือการถอนฟันคุด",
      htmlContent: WISDOM_TOOTH_HTML,
      seoTitle: "ถอนฟันคุด เจ็บไหม อันตรายไหม ราคาเท่าไร | ABC Dental Clinic",
      metaDescription: "ถอนฟันคุดเจ็บมากไหม อันตรายไหม ราคาเท่าไร ข้อมูลครบจากทันตแพทย์ผู้เชี่ยวชาญ พร้อมคำแนะนำดูแลหลังถอน",
      imagePrompt: `Dental clinic professional: close-up of dental tools arranged neatly, X-ray light box showing tooth X-ray, clean white background. Soft clinical lighting. Trustworthy medical photography style. 16:9.`,
      coverImageUrl: "https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=1200&h=675&fit=crop",
      wordpressUrl: "https://abcdentalclinic.com/wisdom-tooth-removal-guide/",
      wordpressStatus: "publish",
      projectId: project2.id, assignedToId: writer.id, reviewerId: reviewer.id,
    },
    {
      id: "art-dental-cleaning",
      title: "ขูดหินปูน ควรทำบ่อยแค่ไหน ราคาเท่าไร",
      slug: "dental-scaling-frequency-cost",
      keywordId: "kw-dental-implant",
      funnelStage: "TOFU", searchIntent: "INFORMATIONAL",
      status: "NEW",
      brief: "คู่มือการขูดหินปูน",
      projectId: project2.id, assignedToId: writer.id,
    },
    // ── Project 3 - Bangkok Condo ────────────────────────────────────────────
    {
      id: "art-condo-guide",
      title: "How to Buy a Condo in Bangkok: Complete 2025 Guide",
      slug: "how-to-buy-condo-bangkok-2025",
      keywordId: "kw-condo-buy",
      funnelStage: "TOFU", searchIntent: "INFORMATIONAL",
      status: "OUTLINE_DONE",
      brief: "Complete buyer guide for Bangkok condos",
      outline: JSON.stringify({ title: "How to Buy a Condo in Bangkok: Complete 2025 Guide", estimatedWordCount: 3000, sections: [{ heading: "H2: Can Foreigners Buy Condos in Thailand?", subheadings: ["H3: 49% Freehold Quota Rule", "H3: Required Documents"], wordCount: 500 }, { heading: "H2: Step-by-Step Buying Process", subheadings: ["H3: Finding the Right Property", "H3: Due Diligence", "H3: Transfer Process"], wordCount: 800 }, { heading: "H2: Costs & Fees Breakdown", subheadings: ["H3: Transfer Fees", "H3: Property Tax"], wordCount: 400 }], faqSuggestions: ["Can foreigners own land in Thailand?", "What taxes do I pay when buying a condo in Bangkok?"] }),
      projectId: project3.id, assignedToId: writer.id,
    },
    // Stage 1: Outline ready — waiting for article generation
    {
      id: "art-condo-foreigner",
      title: "Can Foreigners Buy Condos in Thailand? Rules Explained",
      slug: "can-foreigners-buy-condo-thailand",
      keywordId: "kw-condo-buy",
      funnelStage: "TOFU", searchIntent: "INFORMATIONAL",
      status: "OUTLINE_APPROVED",
      brief: "Foreign ownership rules for Thai condos — target: expats & international investors researching Thai property law.",
      outline: JSON.stringify({
        title: "Can Foreigners Buy Condos in Thailand? Rules Explained",
        estimatedWordCount: 2500,
        sections: [
          { heading: "H2: Can Foreigners Own Property in Thailand?", subheadings: ["H3: Freehold vs Leasehold Ownership", "H3: The 49% Foreign Quota Rule"], keyPoints: ["condominium act B.E. 2522", "foreign quota", "Chanote title deed"], wordCount: 450 },
          { heading: "H2: Step-by-Step Buying Process for Foreigners", subheadings: ["H3: Property Search & Viewings", "H3: Due Diligence Checklist", "H3: Sale & Purchase Agreement", "H3: Transfer at Land Department"], keyPoints: ["legal due diligence", "SPA contract", "title deed transfer"], wordCount: 700 },
          { heading: "H2: Required Documents", subheadings: ["H3: Buyer Documents", "H3: Foreign Exchange Transfer (FETF)"], keyPoints: ["passport copy", "FETF form", "bank transfer proof"], wordCount: 350 },
          { heading: "H2: Costs & Taxes Breakdown", subheadings: ["H3: Transfer Fee (2%)", "H3: Stamp Duty & Withholding Tax", "H3: Sinking Fund & Common Fees"], keyPoints: ["2% transfer fee split", "1% stamp duty", "sinking fund one-time"], wordCount: 400 },
          { heading: "H2: Common Mistakes to Avoid", subheadings: ["H3: Not Checking Foreign Quota First", "H3: Skipping Independent Legal Review"], keyPoints: ["quota availability", "independent lawyer", "developer credibility"], wordCount: 300 },
          { heading: "H2: Frequently Asked Questions", subheadings: [], keyPoints: [], wordCount: 300 },
        ],
        faqSuggestions: ["Can foreigners own land in Thailand?", "What is the 49% foreign quota rule?", "Do foreigners pay property tax in Thailand?", "Can I get a mortgage as a foreigner in Thailand?", "Is buying a Bangkok condo a good investment?"],
      }),
      projectId: project3.id, assignedToId: writer.id,
    },
    // Stage 2: Full article generated — ready for SEO review
    {
      id: "art-condo-roi",
      title: "Bangkok Condo ROI: Expected Rental Yields by Area 2025",
      slug: "bangkok-condo-roi-rental-yields",
      keywordId: "kw-condo-invest",
      funnelStage: "MOFU", searchIntent: "COMMERCIAL",
      status: "ARTICLE_DONE",
      brief: "ROI and rental yield analysis for Bangkok — target: investors comparing yield by neighborhood.",
      outline: JSON.stringify({
        title: "Bangkok Condo ROI: Expected Rental Yields by Area 2025",
        estimatedWordCount: 2800,
        sections: [
          { heading: "H2: Bangkok Condo Rental Yield Overview 2025", subheadings: ["H3: Yield by Zone (Table)", "H3: Gross vs Net Yield Explained"], keyPoints: ["gross yield 4.5–6.5%", "net yield after costs", "vacancy rate"], wordCount: 500 },
          { heading: "H2: Top 3 High-Yield Areas", subheadings: ["H3: Ratchada–Rama 9", "H3: Sukhumvit (Thong Lo–Ekkamai)", "H3: Silom–Sathorn"], keyPoints: ["MRT proximity", "expat demand", "corporate rentals"], wordCount: 700 },
          { heading: "H2: Net vs Gross Yield — Real Return Calculation", subheadings: ["H3: Common Deductions", "H3: Sample ROI Calculation"], keyPoints: ["common fee", "management fee 8–12%", "income tax"], wordCount: 450 },
          { heading: "H2: 5 Factors That Boost Condo ROI", subheadings: [], keyPoints: ["BTS/MRT proximity", "furnished premium", "short-term rental potential"], wordCount: 400 },
          { heading: "H2: Frequently Asked Questions", subheadings: [], keyPoints: [], wordCount: 300 },
        ],
        faqSuggestions: ["What is the average rental yield in Bangkok 2025?", "Is Bangkok condo investment still profitable?", "New vs second-hand condo — which yields more?"],
      }),
      htmlContent: `<article>
<h1>Bangkok Condo ROI: Expected Rental Yields by Area 2025</h1>
<p>Bangkok's property market has attracted international investors for decades, but <strong>actual rental yields vary dramatically by location</strong>. In 2025, the city-wide average rental yield sits around <strong>4.5–6.5% gross</strong>, while high-demand corridors like Sukhumvit and Ratchada can push past 7%.</p>
<p>This guide breaks down ROI data by area, property type, and investment strategy — so you can make a data-driven decision before committing capital.</p>

<h2>Bangkok Condo Rental Yield Overview 2025</h2>
<p>Here's a snapshot of average gross rental yields across Bangkok's key investment zones:</p>
<table><thead><tr><th>Area</th><th>Avg. Gross Yield</th><th>Price per sqm</th><th>Target Renter</th></tr></thead>
<tbody>
<tr><td>Sukhumvit (BTS)</td><td>5.5–7.0%</td><td>฿120,000–250,000</td><td>Expats, long-stay tourists</td></tr>
<tr><td>Silom / Sathorn</td><td>5.0–6.5%</td><td>฿130,000–280,000</td><td>Business professionals</td></tr>
<tr><td>Ratchada / Rama 9</td><td>5.5–7.5%</td><td>฿80,000–150,000</td><td>Young Thai professionals</td></tr>
<tr><td>Bang Na / Bearing</td><td>4.5–6.0%</td><td>฿60,000–100,000</td><td>Budget renters, locals</td></tr>
<tr><td>Lat Phrao</td><td>4.0–5.5%</td><td>฿70,000–110,000</td><td>Thai families</td></tr>
</tbody></table>

<h2>Top 3 High-Yield Areas in Bangkok</h2>

<h3>1. Ratchada–Rama 9 (The Rising Star)</h3>
<p>The Ratchada–Rama 9 corridor has emerged as Bangkok's <strong>best-value investment zone</strong>. The MRT line running through its core has attracted young professionals and expats, creating consistent rental demand with low vacancy rates.</p>
<ul>
<li>Average rental yield: <strong>5.5–7.5%</strong></li>
<li>Entry price: from ฿2.5M for a 30 sqm studio</li>
<li>Average rent: ฿12,000–22,000/month for studios</li>
<li>Vacancy rate: &lt;10% (one of the lowest in Bangkok)</li>
</ul>
<p>Top projects: The Base Rama 9, Life Asoke Rama 9, Ideo Mobi Rama 9</p>

<h3>2. Sukhumvit — Thong Lo to Ekkamai</h3>
<p>The premium expat corridor delivers consistent returns driven by high-income international renters. While entry costs are higher, monthly rents easily justify the investment.</p>
<ul>
<li>Average rental yield: <strong>5.5–7.0%</strong></li>
<li>Entry price: from ฿4M for a 25 sqm studio</li>
<li>Average rent: ฿25,000–50,000/month for 1-bed units</li>
<li>Ideal tenant: Expat professionals, digital nomads</li>
</ul>

<h3>3. Silom–Sathorn (The Business Hub)</h3>
<p>Bangkok's CBD condo market targets corporate renters on company housing allowances — making it resilient even during economic slowdowns.</p>
<ul>
<li>Average rental yield: <strong>5.0–6.5%</strong></li>
<li>Best performing unit: 2-bedroom (fewer vacancies)</li>
<li>Company lease contracts common (12–24 month terms)</li>
</ul>

<h2>Net vs Gross Yield — What's the Real Return?</h2>
<p>Most listings quote <strong>gross yield</strong>, but your net return after deductions is what actually lands in your pocket:</p>
<table><thead><tr><th>Cost Item</th><th>Typical Amount</th></tr></thead>
<tbody>
<tr><td>Condo common fee</td><td>฿30–65/sqm/month</td></tr>
<tr><td>Property management fee</td><td>8–12% of rent</td></tr>
<tr><td>Maintenance &amp; repairs</td><td>฿20,000–50,000/year</td></tr>
<tr><td>Income tax on rental</td><td>5–37% progressive</td></tr>
<tr><td>Vacancy loss allowance</td><td>10–15% annually</td></tr>
</tbody></table>
<p><strong>Rule of thumb:</strong> Subtract 1.5–2% from gross yield to estimate net. A 6.5% gross yield typically nets <strong>4.5–5.0%</strong> — still competitive versus fixed deposits (&lt;2%).</p>

<h2>5 Factors That Boost Condo ROI in Bangkok</h2>
<ol>
<li><strong>BTS/MRT proximity:</strong> Units within 300m of a station command 15–25% higher rents and resell faster</li>
<li><strong>Fully furnished unit:</strong> Achieves 20–30% higher monthly rents vs unfurnished</li>
<li><strong>Floor level:</strong> Higher floors (15+) attract premium rents, especially with city or river views</li>
<li><strong>Short-term rental eligibility:</strong> Projects allowing Airbnb can achieve 8–12% gross yields</li>
<li><strong>Developer reputation:</strong> AP Thailand, Sansiri, Origin projects hold value and attract quality tenants</li>
</ol>

<h2>Frequently Asked Questions</h2>

<h3>What is the average rental yield for Bangkok condos in 2025?</h3>
<p>The Bangkok condo rental market averages <strong>4.5–6.5% gross yield</strong> in 2025, with inner-city locations near BTS/MRT performing at the higher end. After deducting management fees, taxes, and vacancy, net yields typically fall between <strong>3.5–5.0%</strong>.</p>

<h3>Is Bangkok condo investment still profitable in 2025?</h3>
<p>Yes, particularly in strategic locations. Post-pandemic tourism recovery has tightened rental demand, and a growing expat community sustains the premium rental segment. Emerging BTS extensions (Bang Na–Suvarnabhumi corridor) show strong appreciation potential for early investors.</p>

<h3>New project vs second-hand condo — which yields more?</h3>
<p>Second-hand units in established locations often outperform new off-plan projects for immediate yield. New projects offer developer payment plans and potential capital gain on completion, but yield calculations only start once construction finishes and tenants move in — typically 2–3 years after purchase.</p>
</article>`,
      seoTitle: "Bangkok Condo ROI: Rental Yields by Area 2025 [Data Guide]",
      metaDescription: "Compare Bangkok condo rental yields by area in 2025. Sukhumvit, Silom, Ratchada yield data, net vs gross ROI explained, plus top tips to maximize returns.",
      projectId: project3.id, assignedToId: writer.id,
    },
    // Stage 3: SEO reviewed + approved — ready to publish
    {
      id: "art-condo-areas",
      title: "Best Areas to Buy a Condo in Bangkok for Investment 2025",
      slug: "best-areas-invest-condo-bangkok",
      keywordId: "kw-condo-invest",
      funnelStage: "MOFU", searchIntent: "COMMERCIAL",
      status: "APPROVED",
      brief: "Investment area guide for Bangkok condos — target: property investors comparing neighborhoods.",
      outline: JSON.stringify({
        title: "Best Areas to Buy a Condo in Bangkok for Investment 2025",
        estimatedWordCount: 2600,
        sections: [
          { heading: "H2: What Makes a Bangkok Area Good for Condo Investment?", subheadings: ["H3: BTS/MRT Access", "H3: Rental Demand Drivers", "H3: Capital Appreciation Potential"], keyPoints: ["transit proximity", "expat demand", "new developments"], wordCount: 450 },
          { heading: "H2: Top 5 Bangkok Areas for Condo Investment", subheadings: ["H3: Sukhumvit", "H3: Ratchada–Rama 9", "H3: Silom–Sathorn", "H3: Lat Phrao–Ladprao", "H3: Bang Na–Bearing"], keyPoints: ["yield comparison", "entry price", "tenant profile"], wordCount: 900 },
          { heading: "H2: Emerging Areas with High Growth Potential", subheadings: ["H3: Bang Sue–Mo Chit", "H3: Samut Prakan Corridor"], keyPoints: ["infrastructure investment", "BTS extension", "price upside"], wordCount: 400 },
          { heading: "H2: Area Comparison Table", subheadings: [], keyPoints: [], wordCount: 200 },
          { heading: "H2: Frequently Asked Questions", subheadings: [], keyPoints: [], wordCount: 300 },
        ],
        faqSuggestions: ["Which area of Bangkok has the best rental yield?", "Is Sukhumvit still the best investment area?", "What is the cheapest area to buy a condo in Bangkok?"],
      }),
      htmlContent: `<article>
<h1>Best Areas to Buy a Condo in Bangkok for Investment 2025</h1>
<p>Choosing the right Bangkok neighborhood is <strong>the single most important decision</strong> in Thai condo investment. The same ฿4M budget can buy a studio in a high-demand Sukhumvit pocket with 6.5% yield — or a 2-bedroom in a fringe area that sits vacant for months.</p>
<p>This guide ranks Bangkok's top investment zones by rental yield, capital appreciation potential, and ease of tenant sourcing in 2025.</p>

<h2>What Makes a Bangkok Area Good for Investment?</h2>
<p>Three factors consistently separate high-performing Bangkok investment areas from underperformers:</p>
<ul>
<li><strong>BTS or MRT within 500m:</strong> Transit access is non-negotiable for expat tenants and Thai professionals alike</li>
<li><strong>Strong employment hub nearby:</strong> Office concentrations, hospitals, universities create stable rental demand</li>
<li><strong>Controlled new supply:</strong> Areas with limited new development maintain rental rates and resale values</li>
</ul>

<h2>Top 5 Bangkok Areas for Condo Investment</h2>

<h3>1. Sukhumvit — Premium Expat Belt</h3>
<p>Sukhumvit remains Bangkok's most liquid condo investment market. From On Nut (affordable, high yield) to Thong Lo (premium, capital gain), the BTS spine offers something for every budget.</p>
<ul>
<li>Best sub-zones: On Nut (BTS), Thong Lo (BTS), Asok (BTS+MRT)</li>
<li>Average gross yield: 5.5–7.0%</li>
<li>Entry price: ฿2.8M (On Nut) to ฿8M+ (Thong Lo)</li>
<li>Tenant profile: Expats, digital nomads, Thai professionals</li>
</ul>

<h3>2. Ratchada–Rama 9 — Best Value Play</h3>
<p>The Ratchada–Rama 9 corridor offers the <strong>best yield-to-price ratio in Bangkok</strong> right now. Anchored by the MRT, the area hosts major office towers including G Tower and AIA Capital Center, keeping rental demand exceptionally tight.</p>
<ul>
<li>Average gross yield: 5.5–7.5%</li>
<li>Entry price: from ฿2.2M for studios</li>
<li>Vacancy rate: &lt;10%</li>
<li>Upside: new commercial developments planned through 2026</li>
</ul>

<h3>3. Silom–Sathorn — Corporate Tenant Gold</h3>
<p>Bangkok's original CBD attracts corporate renters on company housing allowances — the most reliable tenant category. Sathorn Road hosts embassies, multinationals, and law firms, ensuring steady demand for quality 2-bed units.</p>
<ul>
<li>Average gross yield: 5.0–6.5%</li>
<li>Best unit type: 2-bedroom (65–75 sqm) for corporate leases</li>
<li>Typical lease: 12–24 months, company-sponsored</li>
</ul>

<h3>4. Lat Phrao–Ladprao — Thai Middle-Class Value</h3>
<p>For investors targeting Thai professionals rather than expats, Lat Phrao offers solid fundamentals at lower entry prices. The Yellow Line BTS extension (operational 2024) has catalyzed demand growth.</p>
<ul>
<li>Average gross yield: 4.5–5.5%</li>
<li>Entry price: from ฿1.8M</li>
<li>Tenant: Thai families, young professionals</li>
</ul>

<h3>5. Bang Na–Bearing — Affordable + Airport Upside</h3>
<p>The Bang Na corridor offers the most affordable entry point on the BTS network. Proximity to Suvarnabhumi Airport creates a niche expat rental market (airline staff, airport workers), and the planned BTS extension to Bang Sao Thong adds future appreciation potential.</p>
<ul>
<li>Average gross yield: 4.5–6.0%</li>
<li>Entry price: from ฿1.5M</li>
<li>Emerging demand: industrial worker housing (Eastern Seaboard spillover)</li>
</ul>

<h2>Area Comparison at a Glance</h2>
<table><thead><tr><th>Area</th><th>Gross Yield</th><th>Entry Price</th><th>Best For</th><th>Risk Level</th></tr></thead>
<tbody>
<tr><td>Sukhumvit</td><td>5.5–7.0%</td><td>฿2.8M+</td><td>Expat rental, liquidity</td><td>Low</td></tr>
<tr><td>Ratchada–Rama 9</td><td>5.5–7.5%</td><td>฿2.2M+</td><td>Best yield/price ratio</td><td>Low–Med</td></tr>
<tr><td>Silom–Sathorn</td><td>5.0–6.5%</td><td>฿3.5M+</td><td>Corporate tenants</td><td>Low</td></tr>
<tr><td>Lat Phrao</td><td>4.5–5.5%</td><td>฿1.8M+</td><td>Long-term Thai tenants</td><td>Low–Med</td></tr>
<tr><td>Bang Na</td><td>4.5–6.0%</td><td>฿1.5M+</td><td>Affordable entry, growth</td><td>Medium</td></tr>
</tbody></table>

<h2>Frequently Asked Questions</h2>

<h3>Which Bangkok area has the best condo rental yield in 2025?</h3>
<p>Ratchada–Rama 9 currently offers the best yield-to-price ratio at <strong>5.5–7.5% gross</strong>, followed by Sukhumvit at 5.5–7.0%. Silom–Sathorn is more stable with lower vacancy, making it preferred for conservative investors.</p>

<h3>Is Sukhumvit still the best investment area in Bangkok?</h3>
<p>Sukhumvit remains the most liquid market — easiest to rent and resell — but no longer offers the best yields due to high entry prices. For pure ROI, Ratchada–Rama 9 outperforms. For capital preservation and exit flexibility, Sukhumvit wins.</p>

<h3>What is the cheapest area to buy a Bangkok condo for investment?</h3>
<p>Bang Na–Bearing offers entry points from ฿1.5M with decent yields on the BTS network. Lat Phrao starts from ฿1.8M. Both suit budget investors willing to target Thai tenants rather than the expat premium market.</p>
</article>`,
      seoTitle: "Best Areas to Buy a Condo in Bangkok 2025 [Investment Guide]",
      metaDescription: "Discover the best Bangkok areas for condo investment in 2025. Compare yields, prices, and tenant demand across Sukhumvit, Ratchada, Silom, Lat Phrao, and Bang Na.",
      imagePrompt: "Professional aerial photography of Bangkok skyline at golden hour, multiple high-rise condo towers along BTS Skytrain line, warm orange sunset light, modern metropolitan cityscape, sharp architectural details, editorial magazine style, 16:9 format — no text overlay",
      projectId: project3.id, assignedToId: writer.id,
    },
    // Stage 4: Outline only — article not yet generated
    {
      id: "art-condo-sukhumvit",
      title: "Sukhumvit Condo Prices Per Sqm 2025: What to Expect",
      slug: "sukhumvit-condo-price-per-sqm-2025",
      keywordId: "kw-condo-price",
      funnelStage: "BOFU", searchIntent: "COMMERCIAL",
      status: "OUTLINE_DONE",
      brief: "Sukhumvit condo price guide — target: buyers actively comparing properties along BTS Sukhumvit line.",
      outline: JSON.stringify({
        title: "Sukhumvit Condo Prices Per Sqm 2025: What to Expect",
        estimatedWordCount: 2200,
        sections: [
          { heading: "H2: Sukhumvit Condo Price Ranges by BTS Station", subheadings: ["H3: Asok–Nana (BTS/MRT Hub)", "H3: Phrom Phong–Thong Lo (Upscale)", "H3: On Nut–Udom Suk (Affordable End)"], keyPoints: ["price per sqm by zone", "BTS station proximity premium", "new vs resale"], wordCount: 600 },
          { heading: "H2: What Drives Condo Prices in Sukhumvit?", subheadings: ["H3: Floor Level Premium", "H3: View & Orientation", "H3: Developer Brand Effect"], keyPoints: ["high floor premium 15–25%", "city view premium", "branded developer projects"], wordCount: 450 },
          { heading: "H2: New Launch vs Resale — Price Comparison 2025", subheadings: ["H3: New Projects (Off-Plan)", "H3: Resale Market"], keyPoints: ["off-plan payment terms", "resale negotiation room", "transfer cost difference"], wordCount: 400 },
          { heading: "H2: Sukhumvit Price Forecast 2025–2027", subheadings: [], keyPoints: ["tourism recovery", "expat population growth", "supply pipeline"], wordCount: 350 },
          { heading: "H2: Frequently Asked Questions", subheadings: [], keyPoints: [], wordCount: 300 },
        ],
        faqSuggestions: ["How much does a condo in Sukhumvit cost?", "Is Sukhumvit condo a good buy in 2025?", "What is the price difference between BTS Asok and On Nut?"],
      }),
      projectId: project3.id, assignedToId: writer.id,
    },
  ];

  for (const { id, ...data } of articleData) {
    await prisma.article.upsert({
      where: { id },
      update: {
        status: data.status,
        htmlContent: (data as any).htmlContent ?? undefined,
        outline: (data as any).outline ?? undefined,
        seoTitle: (data as any).seoTitle ?? undefined,
        metaDescription: (data as any).metaDescription ?? undefined,
        imagePrompt: (data as any).imagePrompt ?? undefined,
        coverImageUrl: (data as any).coverImageUrl ?? undefined,
        wordpressUrl: (data as any).wordpressUrl ?? undefined,
        wordpressStatus: (data as any).wordpressStatus ?? undefined,
      },
      create: { id, ...data, createdById: admin.id },
    });
  }

  // Link project1 to WordPress connection
  await prisma.project.update({
    where: { id: project1.id },
    data: { wordpressConnectionId: wpConn.id },
  });

  // ── Prompt Templates ─────────────────────────────────────────────────────────
  const promptTemplates = [
    {
      id: "prompt-keyword-research",
      name: "Keyword Research - Default",
      type: "KEYWORD_RESEARCH_PROMPT",
      description: "วิเคราะห์ keyword จาก seed keyword",
      promptText: `คุณเป็น SEO Expert ผู้เชี่ยวชาญด้านตลาดไทย

โปรเจ็กต์: {{project_name}}
เว็บไซต์: {{website}}
ประเภทธุรกิจ: {{business_type}}
กลุ่มเป้าหมาย: {{target_audience}}
ภาษา: {{language}}
Seed Keyword: {{seed_keyword}}

งาน: วิเคราะห์และสร้าง keyword cluster

ส่งผลลัพธ์เป็น JSON:
{
  "mainKeyword": "...",
  "relatedKeywords": ["..."],
  "longTailKeywords": ["..."],
  "intent": "INFORMATIONAL|NAVIGATIONAL|TRANSACTIONAL|COMMERCIAL",
  "funnelStage": "TOFU|MOFU|BOFU",
  "estimatedVolume": 0,
  "difficulty": 0,
  "contentIdeas": ["..."]
}`,
      variables: JSON.stringify(["project_name", "website", "business_type", "target_audience", "language", "seed_keyword"]),
      modelProvider: "CLAUDE", modelName: "claude-sonnet-4-6", temperature: 0.5, maxTokens: 2000,
    },
    {
      id: "prompt-content-map",
      name: "Content Map Generator - Default",
      type: "CONTENT_MAP_PROMPT",
      description: "สร้าง content map จาก keywords",
      promptText: `คุณเป็น Content Strategist

โปรเจ็กต์: {{project_name}}
เว็บไซต์: {{website}}
กลุ่มเป้าหมาย: {{target_audience}}
Keywords: {{related_keywords}}

งาน: สร้าง Content Map ครอบคลุม TOFU/MOFU/BOFU

ส่งผลลัพธ์เป็น JSON:
{
  "contentMap": [
    { "funnelStage": "TOFU|MOFU|BOFU", "intent": "...", "keyword": "...", "proposedTitle": "...", "contentType": "blog|landing|faq", "priority": 1 }
  ]
}`,
      variables: JSON.stringify(["project_name", "website", "target_audience", "related_keywords"]),
      modelProvider: "CLAUDE", modelName: "claude-sonnet-4-6", temperature: 0.6, maxTokens: 3000,
    },
    {
      id: "prompt-outline",
      name: "Article Outline Generator - Default",
      type: "OUTLINE_PROMPT",
      description: "สร้าง outline บทความ SEO",
      promptText: `คุณเป็น SEO Content Strategist

บทความ: {{article_title}}
Keyword หลัก: {{main_keyword}}
Keywords ที่เกี่ยวข้อง: {{related_keywords}}
Funnel Stage: {{funnel_stage}}
Search Intent: {{search_intent}}
Brand Voice: {{brand_voice}}

งาน: สร้าง outline บทความ SEO ที่ละเอียด

ส่งผลลัพธ์เป็น JSON:
{
  "title": "...",
  "metaDescription": "...",
  "sections": [
    { "heading": "H2: ...", "subheadings": ["H3: ..."], "keyPoints": ["..."], "wordCount": 300 }
  ],
  "estimatedWordCount": 2500,
  "faqSuggestions": ["คำถาม?"]
}`,
      variables: JSON.stringify(["article_title", "main_keyword", "related_keywords", "funnel_stage", "search_intent", "brand_voice"]),
      modelProvider: "CLAUDE", modelName: "claude-sonnet-4-6", temperature: 0.7, maxTokens: 3000,
    },
    {
      id: "prompt-article-writer",
      name: "Article HTML Writer - 15-Step Mega Prompt (SEO/AEO/E-E-A-T)",
      type: "ARTICLE_WRITER_PROMPT",
      isActive: true,
      description: "เขียนบทความ HTML ครบถ้วน: 15-ขั้นตอน SEO, AI Search, AEO, GEO, E-E-A-T, Conversion-focused — ได้คะแนน 10/10",
      promptText: MEGA_ARTICLE_WRITER_PROMPT,
      variables: JSON.stringify([
        "article_title", "main_keyword", "related_keywords", "search_intent", "funnel_stage",
        "website", "brand_name", "business_type", "target_audience", "language",
        "brand_voice", "html_template", "cta_text", "contact_block",
        "reference_rules", "forbidden_claims", "compliance_notes", "internal_links", "outline",
        "industry", "content_goal", "conversion_goal", "product_or_service",
        "unique_selling_points", "trust_signals", "author_profile", "reviewer_profile", "official_sources",
        "brief",
      ]),
      modelProvider: "CLAUDE", modelName: "claude-sonnet-4-6", temperature: 0.8, maxTokens: 16000,
    },
    {
      id: "prompt-article-audit",
      name: "Article AI Audit - Score 1-10 (SEO/AEO/E-E-A-T)",
      type: "ARTICLE_AUDIT_PROMPT",
      isActive: true,
      description: "ตรวจสอบคุณภาพบทความ ให้คะแนน 1-10 ระบุจุดที่ขาดและแนะนำการปรับปรุง",
      promptText: ARTICLE_AUDIT_PROMPT,
      variables: JSON.stringify([
        "article_title", "main_keyword", "related_keywords", "search_intent", "funnel_stage",
        "html_content", "seo_title", "meta_description",
      ]),
      modelProvider: "CLAUDE", modelName: "claude-sonnet-4-6", temperature: 0.3, maxTokens: 3000,
    },
    {
      id: "prompt-article-fix",
      name: "Article AI Fix - Auto-Fix to 10/10",
      type: "ARTICLE_FIX_PROMPT",
      isActive: true,
      description: "แก้ไขบทความอัตโนมัติตามผล Audit เพื่อให้ได้คะแนน 10/10",
      promptText: ARTICLE_FIX_PROMPT,
      variables: JSON.stringify([
        "article_title", "main_keyword", "search_intent",
        "html_content", "seo_title", "meta_description",
        "audit_score", "critical_gaps", "recommendations",
      ]),
      modelProvider: "CLAUDE", modelName: "claude-sonnet-4-6", temperature: 0.7, maxTokens: 16000,
    },
    {
      id: "prompt-seo-check",
      name: "SEO/AEO/E-E-A-T Content Quality Reviewer",
      type: "SEO_CHECK_PROMPT",
      description: "ตรวจสอบคุณภาพบทความ: SEO, AEO, E-E-A-T, Conversion, Risk",
      promptText: `You are an expert SEO, AEO, and content quality reviewer.

Review this article.

Article title: {{article_title}}
Main keyword: {{main_keyword}}
Search intent: {{search_intent}}
Funnel: {{funnel_stage}}
HTML content: {{html_content}}

Return JSON:
{
  "seoScore": 0-100,
  "aeoScore": 0-100,
  "conversionScore": 0-100,
  "riskLevel": "LOW | MEDIUM | HIGH",
  "summary": "",
  "issues": [],
  "recommendations": [],
  "approvalRecommendation": "APPROVE | REVISION_REQUIRED"
}`,
      variables: JSON.stringify(["article_title", "main_keyword", "search_intent", "funnel_stage", "html_content"]),
      modelProvider: "CLAUDE", modelName: "claude-sonnet-4-6", temperature: 0.3, maxTokens: 2000,
    },
    {
      id: "prompt-image-generator",
      name: "Image Prompt Generator - SEO Cover Image",
      type: "IMAGE_PROMPT_GENERATOR",
      description: "สร้าง professional cover image prompt สำหรับบทความ SEO",
      promptText: `You are an expert AI image prompt creator for SEO article cover images.

Create a professional cover image prompt for this article.

Article title: {{article_title}}
Main keyword: {{main_keyword}}
Business: {{business_type}}
Target audience: {{target_audience}}
Brand image style: {{image_style}}

Return as JSON:
{
  "coverPrompt": "...",
  "altText": "...",
  "suggestedFileName": "...",
  "negativePrompt": "...",
  "style": "...",
  "aspectRatio": "16:9",
  "inlinePrompts": [
    { "purpose": "...", "prompt": "..." }
  ]
}`,
      variables: JSON.stringify(["article_title", "main_keyword", "business_type", "target_audience", "image_style"]),
      modelProvider: "CLAUDE", modelName: "claude-sonnet-4-6", temperature: 0.9, maxTokens: 1000,
    },
    {
      id: "prompt-wordpress",
      name: "WordPress Publish Formatter",
      type: "WORDPRESS_PUBLISH_PROMPT",
      description: "เตรียม content สำหรับ WordPress",
      promptText: `เตรียม content สำหรับ WordPress draft

Title: {{article_title}}

ส่งผลลัพธ์เป็น JSON:
{
  "title": "...", "content": "...", "excerpt": "...",
  "status": "draft", "categories": ["..."], "tags": ["..."],
  "yoastSeoTitle": "...", "yoastMetaDescription": "..."
}`,
      variables: JSON.stringify(["article_title"]),
      modelProvider: "CLAUDE", modelName: "claude-sonnet-4-6", temperature: 0.3, maxTokens: 2000,
    },
  ];

  for (const pt of promptTemplates) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ptAny = pt as any;
    await prisma.promptTemplate.upsert({
      where: { id: ptAny.id },
      update: { name: ptAny.name, promptText: ptAny.promptText, description: ptAny.description, maxTokens: ptAny.maxTokens, isActive: ptAny.isActive },
      create: { ...ptAny, organizationId: org.id, createdById: admin.id },
    });
  }

  // ── Sample Reviews ────────────────────────────────────────────────────────────
  await prisma.review.upsert({
    where: { id: "review-schengen-reject" },
    update: {},
    create: {
      id: "review-schengen-reject",
      articleId: "art-schengen-reject",
      reviewerId: reviewer.id,
      status: "PENDING",
      seoScore: 82,
      aeoScore: 76,
      conversionScore: 68,
      riskLevel: "LOW",
      notes: JSON.stringify({ issues: ["Meta description สั้นเกินไป", "เพิ่ม internal links"], suggestions: ["ใส่ keyword ใน alt text", "เพิ่ม structured data"] }),
    },
  });

  // ── Activity Logs ─────────────────────────────────────────────────────────────
  const logCount = await prisma.activityLog.count({ where: { organizationId: org.id } });
  if (logCount === 0) {
    await prisma.activityLog.createMany({
      data: [
        { organizationId: org.id, userId: admin.id, action: "CREATE", entityType: "Project", entityId: project1.id, newValue: JSON.stringify({ name: "Co Journey Visa" }) },
        { organizationId: org.id, userId: admin.id, action: "CREATE", entityType: "Project", entityId: project2.id, newValue: JSON.stringify({ name: "ABC Dental Clinic" }) },
        { organizationId: org.id, userId: admin.id, action: "CREATE", entityType: "Project", entityId: project3.id, newValue: JSON.stringify({ name: "Bangkok Condo Leads" }) },
        { organizationId: org.id, userId: admin.id, action: "CREATE", entityType: "BrandTemplate", entityId: coJourneyTemplate.id, newValue: JSON.stringify({ name: "Co Journey Visa Template" }) },
        { organizationId: org.id, userId: writer.id, action: "GENERATE_ARTICLE", entityType: "Article", entityId: "art-schengen-what", newValue: JSON.stringify({}) },
        { organizationId: org.id, userId: reviewer.id, action: "SEO_REVIEW", entityType: "Article", entityId: "art-schengen-reject", newValue: JSON.stringify({ status: "SEO_REVIEW" }) },
      ],
    });
  }

  console.log("✅ Seed complete!");
  console.log("\n📋 Test accounts:");
  console.log("  admin@example.com     / admin123");
  console.log("  manager@example.com   / manager123");
  console.log("  planner@example.com   / planner123");
  console.log("  writer@example.com    / writer123");
  console.log("  reviewer@example.com  / reviewer123");
  console.log("  publisher@example.com / publisher123");
}

main().catch(console.error).finally(() => prisma.$disconnect());
