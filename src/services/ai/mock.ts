/**
 * Mock AI output generators — one per job type.
 * Replace callAIProvider() in runner.ts to switch to real APIs.
 * Each function must return data that matches the corresponding *Output type.
 */

import type {
  KeywordOutput, ContentMapOutput, ContentMapEntry,
  OutlineOutput, SeoCheckOutput, ImagePromptOutput, WordPressOutput,
} from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── 1. Keyword Research ───────────────────────────────────────────────────────

export function mockKeywordResearch(seedKeyword: string, language = "th"): KeywordOutput {
  const kw = seedKeyword.trim();
  const prefix = language === "th" ? "" : "";
  return {
    mainKeyword: kw,
    relatedKeywords: [
      `${kw} คืออะไร`,
      `${kw} วิธีสมัคร`,
      `ยื่น${kw}ด้วยตัวเอง`,
      `เอกสารสมัคร${kw}`,
      `ค่าธรรมเนียม${kw}`,
      `${kw} 2567`,
      `${kw} ใช้เวลานานแค่ไหน`,
      `${kw} ถูกปฏิเสธ ทำยังไง`,
    ],
    longTailKeywords: [
      `${kw} สำหรับคนไทย 2567 ฉบับสมบูรณ์`,
      `วิธีสมัคร${kw}ด้วยตัวเองแบบ step by step`,
      `${kw} ต้องใช้เอกสารอะไรบ้าง 2567`,
      `${kw} แตกต่างจาก${kw}ประเภทอื่นยังไง`,
      `ศูนย์ยื่น${kw}ที่ไหนบ้างในกรุงเทพ`,
    ],
    intent: "INFORMATIONAL",
    funnelStage: "TOFU",
    estimatedVolume: rand(800, 12000),
    difficulty: rand(20, 65),
    contentIdeas: [
      `${kw} คืออะไร ครบทุกข้อมูลที่ต้องรู้ก่อนยื่น`,
      `ขั้นตอนยื่น${kw} ด้วยตัวเองแบบละเอียด 2567`,
      `เอกสารที่ต้องใช้ในการยื่น${kw} รายการครบถ้วน`,
      `${kw} ใช้เวลานานแค่ไหน อัปเดตล่าสุด`,
      `ค่าธรรมเนียม${kw} อยู่ที่เท่าไหร่ มีค่าใช้จ่ายอะไรบ้าง`,
    ],
  };
}

// ── 2. Content Map ────────────────────────────────────────────────────────────

export function mockContentMap(keywords: string[], projectName = ""): ContentMapOutput {
  const intents = ["INFORMATIONAL", "COMMERCIAL", "TRANSACTIONAL"] as const;
  const contentTypes = ["blog", "guide", "landing", "faq", "comparison"] as const;

  function makeEntry(kw: string, idx: number): ContentMapEntry {
    const stage = idx % 3 === 0 ? "TOFU" : idx % 3 === 1 ? "MOFU" : "BOFU";
    const intent = intents[idx % 3];
    const type = contentTypes[idx % contentTypes.length];
    return {
      funnelStage: stage,
      intent,
      keyword: kw,
      proposedTitle:
        stage === "TOFU" ? `${kw} คืออะไร? คู่มือฉบับสมบูรณ์ 2567` :
        stage === "MOFU" ? `วิธีเลือก${kw} ที่เหมาะกับคุณ — เปรียบเทียบข้อดีข้อเสีย` :
        `สมัคร${kw} กับ${projectName} — บริการครบจบในที่เดียว`,
      contentType: type,
      wordCountTarget: stage === "TOFU" ? rand(1500, 2500) : stage === "MOFU" ? rand(2000, 3500) : rand(1000, 2000),
      priority: idx + 1,
      notes: stage === "BOFU" ? "High conversion potential — include CTA above the fold" : undefined,
    };
  }

  const all = keywords.map((kw, i) => makeEntry(kw, i));
  return {
    totalArticles: all.length,
    tofu:  all.filter((e) => e.funnelStage === "TOFU"),
    mofu:  all.filter((e) => e.funnelStage === "MOFU"),
    bofu:  all.filter((e) => e.funnelStage === "BOFU"),
  };
}

// ── 3. Outline ────────────────────────────────────────────────────────────────

export function mockOutline(title: string, keyword: string): OutlineOutput {
  const kw = keyword || title;
  return {
    title,
    seoTitle: `${title} | คู่มือครบถ้วน 2567`,
    metaDescription: `อ่าน${title}ฉบับสมบูรณ์ — ครอบคลุมเอกสาร ขั้นตอน ค่าธรรมเนียม และเคล็ดลับจากผู้เชี่ยวชาญ อัปเดตปี 2567`,
    estimatedWordCount: 2800,
    sections: [
      {
        h2: `${kw} คืออะไร`,
        h3s: ["คำนิยามและที่มา", "ประเภทของ" + kw, "ข้อแตกต่างจากประเภทอื่น"],
        keyPoints: ["อธิบายพื้นฐานให้เข้าใจง่าย", "ใส่ตารางเปรียบเทียบ", "ตอบคำถาม 'เหมาะกับใคร'"],
        estimatedWords: 500,
      },
      {
        h2: "เอกสารที่ต้องใช้",
        h3s: ["เอกสารบังคับ (ขาดไม่ได้)", "เอกสารเสริมที่แนะนำ", "เคล็ดลับการจัดเตรียม"],
        keyPoints: ["รายการ checklist", "ตัวอย่างเอกสารที่ถูกปฏิเสธ", "ลิงก์แบบฟอร์มดาวน์โหลด"],
        estimatedWords: 700,
      },
      {
        h2: "ขั้นตอนการยื่น step by step",
        h3s: ["ขั้นตอนที่ 1 — นัดหมาย", "ขั้นตอนที่ 2 — ยื่นเอกสาร", "ขั้นตอนที่ 3 — ชำระค่าธรรมเนียม", "ขั้นตอนที่ 4 — รอผล"],
        keyPoints: ["ภาพ timeline", "เวลาที่ใช้แต่ละขั้นตอน", "จุดที่ผิดพลาดบ่อย"],
        estimatedWords: 800,
      },
      {
        h2: "ค่าธรรมเนียมและระยะเวลา",
        h3s: ["ค่าธรรมเนียมทางการ", "ค่าใช้จ่ายแฝงที่ต้องรู้", "ระยะเวลาพิจารณา"],
        keyPoints: ["ตารางค่าธรรมเนียม", "เปรียบเทียบช่องทาง", "ข้อมูลล่าสุดปี 2567"],
        estimatedWords: 400,
      },
      {
        h2: `FAQ — คำถามที่พบบ่อยเกี่ยวกับ${kw}`,
        h3s: [],
        keyPoints: ["ตอบ 5-7 คำถามยอดนิยม", "ใส่ Schema Markup FAQPage"],
        estimatedWords: 400,
      },
    ],
    faqItems: [
      { question: `${kw} ต้องใช้เอกสารอะไรบ้าง?`, answer: "เอกสารหลักที่ต้องใช้ประกอบด้วย หนังสือเดินทาง (มีอายุ 6 เดือนขึ้นไป) รูปถ่ายตามขนาดที่กำหนด หลักฐานการเงิน และแบบฟอร์มใบสมัคร" },
      { question: `${kw} ใช้เวลานานแค่ไหน?`, answer: "โดยทั่วไปใช้เวลา 15-30 วันทำการ ขึ้นอยู่กับช่วงเวลาและความสมบูรณ์ของเอกสาร" },
      { question: `ยื่น${kw}ด้วยตัวเองได้ไหม?`, answer: "ได้ครับ สามารถยื่นด้วยตัวเองหรือใช้บริการตัวแทนก็ได้ ตัวแทนช่วยประหยัดเวลาและลดความเสี่ยงเอกสารผิดพลาด" },
      { question: `${kw} ถูกปฏิเสธควรทำยังไง?`, answer: "หากถูกปฏิเสธ ควรอ่านหนังสือปฏิเสธให้ละเอียด แก้ไขจุดบกพร่อง และยื่นใหม่พร้อมเอกสารที่ครบถ้วนกว่าเดิม" },
      { question: `ค่าธรรมเนียม${kw} เท่าไหร่ 2567?`, answer: "ค่าธรรมเนียมขึ้นอยู่กับประเภทและช่องทางที่ยื่น กรุณาตรวจสอบอัตราล่าสุดจากเว็บไซต์ทางการ" },
    ],
  };
}

// ── 4. Article HTML (Elementor-ready) ─────────────────────────────────────────

export function mockArticleHtml(
  title: string,
  keyword: string,
  ctaText = "ติดต่อทีมงานเพื่อรับคำปรึกษาฟรี",
  contactBlock = "",
  brandVoice = ""
): string {
  const kw = keyword || title;
  const year = new Date().getFullYear() + 543; // Thai year
  return `<article class="seo-article entry-content" itemscope itemtype="https://schema.org/Article">

  <h1>${title}</h1>

  <!-- Quick Answer / Featured Snippet Box -->
  <div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:20px 24px;margin:0 0 28px;border-radius:0 8px 8px 0;">
    <p style="margin:0;font-size:15px;line-height:1.6;"><strong>📌 สรุปสั้น:</strong> <strong>${kw}</strong> คือหนึ่งในหัวข้อที่ผู้คนค้นหามากที่สุดในปี ${year} บทความนี้รวบรวมข้อมูลสำคัญ ขั้นตอน และคำแนะนำจากผู้เชี่ยวชาญไว้ครบถ้วนในที่เดียว</p>
  </div>

  <p>${kw} เป็นหัวข้อที่มีความสำคัญอย่างมากในปัจจุบัน โดยเฉพาะสำหรับผู้ที่กำลังมองหาข้อมูลที่ถูกต้องและเป็นปัจจุบัน บทความนี้จะพาคุณทำความเข้าใจทุกแง่มุมอย่างละเอียด ตั้งแต่พื้นฐานจนถึงขั้นตอนปฏิบัติจริง</p>

  <h2>${kw} คืออะไร และทำไมถึงสำคัญ</h2>
  <p>${kw} หมายถึง กระบวนการหรือแนวทางที่ได้รับการยอมรับและพิสูจน์ประสิทธิภาพมาแล้วในระดับสากล โดยมีการนำมาใช้งานจริงในหลากหลายบริบท ทั้งในระดับบุคคลและองค์กร</p>
  <p>ข้อมูลจากการวิจัยล่าสุดพบว่า ผู้ที่มีความเข้าใจใน${kw}อย่างถ่องแท้มีโอกาสประสบความสำเร็จสูงกว่าผู้ที่ไม่มีความรู้ถึง <strong>3.5 เท่า</strong> ซึ่งเป็นตัวเลขที่น่าสนใจและควรพิจารณาอย่างจริงจัง</p>

  <!-- Comparison Table -->
  <div style="overflow-x:auto;margin:24px 0;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="padding:12px 16px;border:1px solid #e2e8f0;text-align:left;font-weight:600;">หัวข้อ</th>
          <th style="padding:12px 16px;border:1px solid #e2e8f0;text-align:left;font-weight:600;">รายละเอียด</th>
          <th style="padding:12px 16px;border:1px solid #e2e8f0;text-align:left;font-weight:600;">ข้อควรรู้</th>
        </tr>
      </thead>
      <tbody>
        <tr><td style="padding:12px 16px;border:1px solid #e2e8f0;">ระยะเวลาโดยเฉลี่ย</td><td style="padding:12px 16px;border:1px solid #e2e8f0;">7–15 วันทำการ</td><td style="padding:12px 16px;border:1px solid #e2e8f0;">ขึ้นอยู่กับความสมบูรณ์ของข้อมูล</td></tr>
        <tr style="background:#fafafa;"><td style="padding:12px 16px;border:1px solid #e2e8f0;">ค่าใช้จ่ายเฉลี่ย</td><td style="padding:12px 16px;border:1px solid #e2e8f0;">ตามอัตราที่กำหนด</td><td style="padding:12px 16px;border:1px solid #e2e8f0;">อัปเดตปี ${year}</td></tr>
        <tr><td style="padding:12px 16px;border:1px solid #e2e8f0;">เอกสารที่ต้องเตรียม</td><td style="padding:12px 16px;border:1px solid #e2e8f0;">3–5 รายการหลัก</td><td style="padding:12px 16px;border:1px solid #e2e8f0;">ตรวจสอบรายการล่าสุดก่อนดำเนินการ</td></tr>
        <tr style="background:#fafafa;"><td style="padding:12px 16px;border:1px solid #e2e8f0;">อัตราความสำเร็จ</td><td style="padding:12px 16px;border:1px solid #e2e8f0;">85–92%</td><td style="padding:12px 16px;border:1px solid #e2e8f0;">เมื่อเตรียมข้อมูลครบถ้วน</td></tr>
      </tbody>
    </table>
  </div>

  <h2>ขั้นตอนการดำเนินการ ${kw} แบบ Step-by-Step</h2>
  <p>การเข้าใจขั้นตอนที่ถูกต้องจะช่วยให้คุณประหยัดเวลาและหลีกเลี่ยงข้อผิดพลาดที่พบบ่อย ขั้นตอนต่อไปนี้ได้รับการรวบรวมจากประสบการณ์จริงของทีมผู้เชี่ยวชาญ:</p>
  <ol>
    <li><strong>ศึกษาข้อมูลเบื้องต้น</strong> — รวบรวมข้อมูลที่จำเป็นและทำความเข้าใจเงื่อนไขทั้งหมดก่อนเริ่มต้น</li>
    <li><strong>เตรียมเอกสาร</strong> — ตรวจสอบรายการเอกสารที่ต้องใช้และจัดเตรียมให้ครบถ้วน</li>
    <li><strong>ยื่นคำขอ</strong> — ดำเนินการยื่นผ่านช่องทางที่ถูกต้องและได้รับการรับรอง</li>
    <li><strong>ติดตามสถานะ</strong> — ตรวจสอบความคืบหน้าผ่านระบบที่กำหนด</li>
    <li><strong>รับผล</strong> — รับเอกสารหรือผลลัพธ์และตรวจสอบความถูกต้อง</li>
  </ol>

  <!-- Info Box -->
  <div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:16px 20px;margin:24px 0;border-radius:0 8px 8px 0;">
    <p style="margin:0;font-size:14px;color:#1e40af;"><strong>💡 เคล็ดลับจากผู้เชี่ยวชาญ:</strong> การเตรียมข้อมูลให้ครบถ้วนตั้งแต่ต้นจะช่วยลดระยะเวลาดำเนินการได้ถึง 40% และเพิ่มโอกาสสำเร็จในครั้งแรก</p>
  </div>

  <h2>สิ่งที่ควรระวังและข้อผิดพลาดที่พบบ่อย</h2>
  <p>จากประสบการณ์ดูแลลูกค้ามากกว่า 10,000 ราย ทีมงานพบว่ามีข้อผิดพลาดที่เกิดขึ้นซ้ำๆ ซึ่งสามารถหลีกเลี่ยงได้ง่าย:</p>
  <ul>
    <li>❌ <strong>เอกสารไม่ครบ</strong> — ตรวจสอบรายการทุกครั้งก่อนยื่น</li>
    <li>❌ <strong>ข้อมูลล้าสมัย</strong> — ข้อกำหนดมีการเปลี่ยนแปลงบ่อย ตรวจสอบปีล่าสุดเสมอ</li>
    <li>❌ <strong>เลือกช่องทางผิด</strong> — มีหลายช่องทาง แต่ละช่องมีเงื่อนไขต่างกัน</li>
    <li>❌ <strong>ไม่เผื่อเวลา</strong> — ควรเริ่มดำเนินการล่วงหน้าอย่างน้อย 4–6 สัปดาห์</li>
  </ul>

  <!-- FAQ with Schema -->
  <section itemscope itemtype="https://schema.org/FAQPage">
    <h2>คำถามที่พบบ่อยเกี่ยวกับ ${kw}</h2>

    <div itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
      <h3 itemprop="name">${kw} ใช้เวลานานแค่ไหน?</h3>
      <div itemprop="acceptedAnswer" itemscope itemtype="https://schema.org/Answer">
        <p itemprop="text">โดยทั่วไปใช้เวลา 7–15 วันทำการ ขึ้นอยู่กับความสมบูรณ์ของเอกสารและช่วงเวลาที่ยื่น ช่วง High Season อาจใช้เวลานานกว่าปกติ 30–50%</p>
      </div>
    </div>

    <div itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
      <h3 itemprop="name">ต้องเตรียมอะไรบ้างสำหรับ${kw}?</h3>
      <div itemprop="acceptedAnswer" itemscope itemtype="https://schema.org/Answer">
        <p itemprop="text">เอกสารหลักที่ต้องเตรียมประกอบด้วย: (1) บัตรประจำตัวหรือหนังสือเดินทาง (2) หลักฐานการเงินย้อนหลัง 3 เดือน (3) แบบฟอร์มที่กรอกครบถ้วน และ (4) เอกสารเพิ่มเติมตามกรณีเฉพาะ</p>
      </div>
    </div>

    <div itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
      <h3 itemprop="name">ค่าใช้จ่ายของ${kw} เท่าไหร่ในปี ${year}?</h3>
      <div itemprop="acceptedAnswer" itemscope itemtype="https://schema.org/Answer">
        <p itemprop="text">ค่าใช้จ่ายขึ้นอยู่กับประเภทและช่องทางที่เลือก แนะนำให้ติดต่อทีมงานโดยตรงเพื่อรับข้อมูลค่าใช้จ่ายที่แม่นยำและเป็นปัจจุบัน</p>
      </div>
    </div>

    <div itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
      <h3 itemprop="name">ดำเนินการเองได้ไหม หรือต้องใช้ผู้เชี่ยวชาญ?</h3>
      <div itemprop="acceptedAnswer" itemscope itemtype="https://schema.org/Answer">
        <p itemprop="text">สามารถดำเนินการเองได้ แต่การใช้ผู้เชี่ยวชาญจะช่วยลดความเสี่ยงในการเตรียมเอกสารผิดพลาด และประหยัดเวลาได้อย่างมีนัยสำคัญ โดยเฉพาะสำหรับกรณีที่มีความซับซ้อน</p>
      </div>
    </div>
  </section>

  <!-- CTA Block -->
  <div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:2px solid #16a34a;padding:32px;text-align:center;margin:32px 0;border-radius:12px;">
    <h3 style="color:#15803d;margin:0 0 8px;font-size:20px;">พร้อมช่วยคุณทุกขั้นตอน</h3>
    <p style="color:#166534;margin:0 0 20px;font-size:15px;">${ctaText}</p>
    <a href="/contact" style="display:inline-block;background:#16a34a;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">ปรึกษาฟรี — ไม่มีค่าใช้จ่าย</a>
  </div>

  ${contactBlock ? `<div class="contact-block">${contactBlock}</div>` : ""}

</article>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "${title}",
  "description": "${kw} — คู่มือครบถ้วนปี ${year} ครอบคลุมขั้นตอน เอกสาร ค่าใช้จ่าย และคำแนะนำจากผู้เชี่ยวชาญ",
  "author": { "@type": "Organization", "name": "Co Journey Visa" },
  "datePublished": "${new Date().toISOString().split("T")[0]}",
  "dateModified": "${new Date().toISOString().split("T")[0]}"
}
</script>`;
}

// ── 5. SEO Check ──────────────────────────────────────────────────────────────

export function mockSeoCheck(title: string, keyword: string): SeoCheckOutput {
  const seoScore   = rand(70, 92);
  const aeoScore   = rand(65, 88);
  const convScore  = rand(60, 85);
  const riskLevel: "LOW" | "MEDIUM" | "HIGH" = seoScore >= 80 ? "LOW" : seoScore >= 65 ? "MEDIUM" : "HIGH";

  return {
    seoScore,
    aeoScore,
    conversionScore: convScore,
    riskLevel,
    issues: [
      { severity: "warning",  message: `Meta description ควรอยู่ระหว่าง 150–160 ตัวอักษร (ปัจจุบัน ${rand(90, 145)} ตัวอักษร)` },
      { severity: "info",     message: `Keyword density ของ "${keyword}" อยู่ที่ ${(rand(8, 18) / 10).toFixed(1)}% (เป้าหมาย 1.5–2.5%)` },
      ...(seoScore < 80 ? [{ severity: "warning" as const, message: "ขาด internal links ไปยังบทความที่เกี่ยวข้อง — ควรมีอย่างน้อย 2–3 จุด" }] : []),
      ...(aeoScore < 75 ? [{ severity: "info" as const, message: "เพิ่ม FAQ Section พร้อม Schema Markup เพื่อเพิ่ม AEO score" }] : []),
    ],
    suggestions: [
      "เพิ่ม heading H2 ที่มี keyword หลักอย่างน้อย 1 ตำแหน่ง",
      "ใส่ alt text ของรูปภาพทุกรูปให้มี keyword",
      "เชื่อม internal link ไปยังบทความ MOFU/BOFU ที่เกี่ยวข้อง",
      "ตรวจสอบ Core Web Vitals — LCP ควรน้อยกว่า 2.5 วินาที",
      ...(convScore < 70 ? ["เพิ่ม CTA ที่ชัดเจนและมองเห็นได้ง่ายในครึ่งบนของหน้า"] : []),
    ],
    passed: seoScore >= 70,
  };
}

// ── 6. SEO Metadata ───────────────────────────────────────────────────────────

export function mockSeoMetadata(title: string, keyword: string, brandName = "") {
  const brand = brandName || "Co Journey";
  return {
    seoTitle: `${title} | ${brand}`,
    metaDescription: `อ่าน${title}ฉบับสมบูรณ์ — เอกสาร ขั้นตอน ค่าธรรมเนียม ครบในที่เดียว อัปเดตปี 2567 โดยผู้เชี่ยวชาญจาก${brand}`,
    faqSchema: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: `${title} คืออะไร?`,
          acceptedAnswer: { "@type": "Answer", text: "เนื้อหาจะถูกสร้างโดย AI เมื่อเชื่อมต่อ API จริง" },
        },
        {
          "@type": "Question",
          name: `ต้องใช้เอกสารอะไรสำหรับ${keyword}?`,
          acceptedAnswer: { "@type": "Answer", text: "หนังสือเดินทาง รูปถ่าย หลักฐานการเงิน และแบบฟอร์มใบสมัคร" },
        },
      ],
    }),
  };
}

// ── 7. Image Prompt ───────────────────────────────────────────────────────────

export function mockImagePrompt(title: string, brandVoice = ""): ImagePromptOutput {
  return {
    coverPrompt: `Professional Thai visa consultation scene, warm natural office lighting, muted green and white color palette, high resolution photography, relevant to "${title}", trustworthy and friendly atmosphere, no text overlays`,
    altText: `${title} — บริการจาก Co Journey Visa`,
    negativePrompt: "cartoon, anime, lowres, watermark, text, logo, unrealistic, blurry, dark, dramatic",
    style: "photorealistic, professional, warm, trustworthy",
    aspectRatio: "16:9",
    inlinePrompts: [
      {
        purpose: "step-diagram",
        prompt: `Clean infographic showing step-by-step process for "${title}", numbered steps 1-5, minimal flat design, green and white, Thai language labels, professional`,
      },
      {
        purpose: "document-checklist",
        prompt: `Document checklist illustration for "${title}", organized layout, green checkmarks, clean minimal style, professional business context`,
      },
    ],
  };
}

// ── 8. WordPress Draft ────────────────────────────────────────────────────────

export function mockWordPressDraft(
  title: string,
  slug: string,
  siteUrl: string,
  keyword: string
): WordPressOutput {
  const wpId = rand(1000, 99999);
  return {
    wordpressUrl: `${siteUrl.replace(/\/$/, "")}/?p=${wpId}`,
    wordpressId:  wpId,
    status: "draft",
    slug: slug || title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
    categories: ["วีซ่า", "Travel"],
    tags: [keyword, "วีซ่า", "ท่องเที่ยว", "2567"],
  };
}
