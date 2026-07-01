export interface MarsAgent {
  id: string;
  name: string;
  emoji: string;
  color: string;          // tailwind bg class for badge
  textColor: string;
  description: string;
  quickPrompts: string[];
}

// Pinterest-style muted pastels — identifiable but not loud
export const AGENTS: MarsAgent[] = [
  {
    id: "writer",
    name: "Writer",
    emoji: "✍️",
    color: "bg-[#FFF0F0]",
    textColor: "text-[#9B2525]",
    description: "เขียนบทความ SEO 10/10 ระดับโปร",
    quickPrompts: [
      "เขียนบทความเรื่อง วีซ่าเชงเก้น ให้ติด Google หน้าแรก",
      "ช่วยสร้าง outline สำหรับ keyword 'รากฟันเทียม ราคา'",
      "เขียน meta description ที่ดึงดูด CTR",
    ],
  },
  {
    id: "backlink",
    name: "Backlink",
    emoji: "🔗",
    color: "bg-[#EEF3FF]",
    textColor: "text-[#2B4FAD]",
    description: "วางแผนและหา backlink คุณภาพสูง",
    quickPrompts: [
      "ช่วยหาแหล่ง backlink สำหรับเว็บท่องเที่ยว",
      "วางแผน outreach ขอ backlink จากเว็บ DR50+",
      "วิเคราะห์ backlink profile ของคู่แข่ง",
    ],
  },
  {
    id: "image",
    name: "Image",
    emoji: "🎨",
    color: "bg-[#F5EEFF]",
    textColor: "text-[#6B35A8]",
    description: "สร้าง prompt รูปภาพและปกบทความ",
    quickPrompts: [
      "สร้าง image prompt สำหรับบทความวีซ่า",
      "ออกแบบปกบทความที่ดึงดูด engagement",
      "เขียน alt text ที่ดีสำหรับ SEO",
    ],
  },
  {
    id: "audit",
    name: "SEO Audit",
    emoji: "🔍",
    color: "bg-[#FFF7ED]",
    textColor: "text-[#9A4A00]",
    description: "ตรวจคุณภาพบทความ ให้คะแนน E-E-A-T",
    quickPrompts: [
      "ตรวจบทความนี้ให้คะแนน 1-10",
      "บทความได้ 7/10 ต้องแก้อะไรให้ได้ 10/10",
      "ตรวจ on-page SEO ให้ครบทุกจุด",
    ],
  },
  {
    id: "analysis",
    name: "Analysis",
    emoji: "📊",
    color: "bg-[#EDFAF4]",
    textColor: "text-[#1A6A46]",
    description: "วิเคราะห์ keyword, ranking, คู่แข่ง",
    quickPrompts: [
      "วิเคราะห์ keyword cluster สำหรับ 'วีซ่ายุโรป'",
      "ช่วยดู search intent ของ 'รากฟันเทียม ราคา'",
      "คู่แข่งอันดับ 1 Google ทำอะไรได้ดีกว่าเรา",
    ],
  },
  {
    id: "ux",
    name: "UX / UI",
    emoji: "✨",
    color: "bg-[#F0F4FF]",
    textColor: "text-[#2840A0]",
    description: "ปรับเว็บและบทความให้อ่านง่าย Convert ดีขึ้น",
    quickPrompts: [
      "ตรวจ readability ของบทความนี้",
      "แนะนำการจัดวาง CTA ที่ดีกว่านี้",
      "ปรับ UX หน้า Landing ให้ bounce rate ลด",
    ],
  },
  {
    id: "report",
    name: "Report",
    emoji: "📈",
    color: "bg-[#FFF8EE]",
    textColor: "text-[#8A4A10]",
    description: "สรุปผล SEO เป็น report ส่งลูกค้า",
    quickPrompts: [
      "สรุป SEO performance เดือนนี้เป็น report",
      "สร้าง executive summary ส่ง client",
      "แปลงตัวเลข organic traffic เป็นเรื่องราว",
    ],
  },
];

// ── Route user input to an agent ─────────────────────────────────────────────

export function detectAgent(input: string): MarsAgent {
  const t = input.toLowerCase();

  if (/เขียน|write|article|บทความ|content|outline|draft|keyword.*เขียน|ต้องการบทความ/.test(t))
    return AGENTS.find((a) => a.id === "writer")!;

  if (/backlink|link.?build|domain.?rating|dr\d|outreach|anchor.?text|referring/.test(t))
    return AGENTS.find((a) => a.id === "backlink")!;

  if (/รูป|image|cover|ปก|thumbnail|visual|alt.?text|prompt.*รูป|design.*บทความ/.test(t))
    return AGENTS.find((a) => a.id === "image")!;

  if (/audit|ตรวจ|score|คะแนน|quality|e.?e.?a.?t|on.?page|check|review.*บทความ/.test(t))
    return AGENTS.find((a) => a.id === "audit")!;

  if (/analys|วิเคราะห์|keyword.?research|ranking|competitor|traffic|serp|intent/.test(t))
    return AGENTS.find((a) => a.id === "analysis")!;

  if (/ux|ui|design|readab|อ่านง่าย|user.?experience|หน้าตา|cta|conversion|bounce/.test(t))
    return AGENTS.find((a) => a.id === "ux")!;

  if (/report|รายงาน|สรุป|dashboard|metric|kpi|performance|result|client.*result/.test(t))
    return AGENTS.find((a) => a.id === "report")!;

  // Default — ask clarifying question
  return AGENTS.find((a) => a.id === "analysis")!;
}

// ── Generate agent response ───────────────────────────────────────────────────

export function buildResponse(input: string, agent: MarsAgent): string {
  const t = input.toLowerCase();

  if (agent.id === "writer") {
    if (/outline/.test(t)) {
      return `### Outline สำหรับ "${input.replace(/outline|ช่วย|สร้าง/gi, "").trim()}"

**H1:** [ชื่อบทความ] — คู่มือครบถ้วน ${new Date().getFullYear() + 543}

**H2: คืออะไร และทำไมถึงสำคัญ**
- นิยาม + ความสำคัญ
- สถิติที่น่าสนใจ (E-E-A-T signal)

**H2: ขั้นตอน / วิธีการ Step-by-Step**
- ขั้นตอนที่ 1–5 พร้อม numbered list
- Tips จากผู้เชี่ยวชาญ

**H2: เปรียบเทียบ / ตาราง**
- ตาราง comparison (Featured Snippet ready)

**H2: ข้อควรระวัง / ความผิดพลาดที่พบบ่อย**

**H2: FAQ — 5 คำถามยอดนิยม** (FAQPage Schema)

**H3 CTA Block:** ก่อน FAQ

---
**ประมาณการ:** 2,200–2,800 คำ · Keyword density 1.5% · 3–5 internal links
→ กด **Generate Article** ใน Article detail เพื่อให้ AI เขียนต่อได้เลย`;
    }

    if (/meta.?desc/.test(t)) {
      return `### Meta Description Template

\`\`\`
[keyword] — [benefit หลัก] [ตัวเลข/ข้อเท็จจริง]. [CTA ที่ชัดเจน].
\`\`\`

**ตัวอย่าง:**
> วีซ่าเชงเก้น — เดินทาง 27 ประเทศยุโรปด้วยวีซ่าใบเดียว อัปเดตเอกสาร 2568 ครบจบ. ปรึกษาทีมผู้เชี่ยวชาญฟรี →

**เกณฑ์ที่ดี:**
- 150–160 ตัวอักษร
- มี keyword หลักใน 50 ตัวแรก
- มี number หรือ year เพิ่ม CTR
- จบด้วย action word`;
    }

    return `### แผนการเขียนบทความ SEO 10/10

**Topic:** ${input}

**15-Step Framework ที่ใช้:**
1. **Search Intent Analysis** — informational / commercial / transactional
2. **Semantic keyword cluster** — LSI + related terms
3. **E-E-A-T signals** — ตัวเลข, สถิติ, อ้างอิงแหล่งน่าเชื่อถือ
4. **Featured Snippet optimization** — definition box + numbered list
5. **FAQ Schema** — 5–8 คำถาม + JSON-LD

**ขั้นตอนถัดไป:**
1. ไปที่ **Articles → New Article**
2. ใส่ title และ keyword
3. เลือก **Full Auto** → ระบบจะสร้าง Outline + บทความ + SEO Check ให้ทันที

→ ค่าใช้จ่ายประมาณ **$0.06 ต่อบทความ** เมื่อ connect Claude API`;
  }

  if (agent.id === "backlink") {
    return `### Backlink Strategy สำหรับ "${input.replace(/backlink|ช่วย|หา/gi, "").trim()}"

**Priority 1 — Quick Wins (DR 20–50)**
- Guest post บน blog ท่องเที่ยว / ไลฟ์สไตล์ไทย
- Comment + engage ใน niche community (Pantip, Reddit Thailand)
- Business citation: Google My Business, Yelp, TripAdvisor

**Priority 2 — Link-Worthy Content**
- สร้าง infographic + data study ที่คนอยาก share
- Ultimate guide ที่ครอบคลุมกว่า competitor
- Free tool หรือ checklist (เช่น "Visa Checklist Generator")

**Priority 3 — Outreach (DR 50+)**
\`\`\`
Subject: Collaboration opportunity — [your site] + [target site]

Hi [Name],
I noticed your article on [topic] and think our guide on
[related topic] would add value for your readers...
\`\`\`

**KPIs to track:**
- Referring domains เพิ่ม +10/เดือน
- DR target: จาก 20 → 35 ใน 6 เดือน
- Anchor text diversity: brand 40%, generic 30%, keyword 30%`;
  }

  if (agent.id === "image") {
    return `### Image Brief สำหรับบทความ

**Cover Image Prompt (Midjourney/DALL-E):**
\`\`\`
Professional editorial photography, [topic] concept,
clean white background with subtle warm tones,
minimal modern design, no text overlay,
16:9 ratio, high resolution, trustworthy atmosphere
\`\`\`

**Alt Text Formula:**
\`\`\`
[keyword หลัก] + [context] + [action/benefit]
ตัวอย่าง: "วีซ่าเชงเก้น 2568 — เอกสารที่ต้องเตรียมก่อนยื่น"
\`\`\`

**Image SEO Checklist:**
- [ ] File name: \`visa-schengen-2568.jpg\` (ไม่ใช่ IMG_001.jpg)
- [ ] Alt text ทุกรูปมี keyword
- [ ] Compress ให้ต่ำกว่า 100KB (WebP)
- [ ] Lazy loading เปิดอยู่
- [ ] Featured image ratio 16:9 / 1200×630px

→ ไปที่ **Article detail → แท็บ Image** เพื่อ generate prompt อัตโนมัติ`;
  }

  if (agent.id === "audit") {
    return `### SEO Audit Framework — 5 มิติ (รวม 10 คะแนน)

| มิติ | คะแนน | เช็คอะไร |
|------|--------|----------|
| **SEO Technical** | /2 | H1 unique, keyword density 1–2%, meta tags |
| **AI Search Ready** | /2 | Direct answer ใน 150 คำแรก, FAQ Schema |
| **E-E-A-T** | /2 | ตัวเลข/สถิติ, author expertise, citations |
| **UX & Readability** | /2 | ย่อหน้าสั้น, lists, visual breaks |
| **Conversion & Intent** | /2 | ตอบ intent ตรง, CTA ชัดเจน |

**เกณฑ์ตัดสิน:**
- 🔴 < 6 = ต้องแก้ก่อน publish
- 🟡 6–7 = แก้ได้หรือ publish แบบระวัง
- 🟢 8–10 = พร้อม publish

→ ไปที่ **Article detail → แท็บ AI Audit** → กด **Run Audit** ให้ AI ให้คะแนนและ fix อัตโนมัติ`;
  }

  if (agent.id === "analysis") {
    return `### SEO Analysis: "${input}"

**Search Intent:**
- Primary: Informational (ต้องการเรียนรู้)
- Secondary: Commercial (กำลังตัดสินใจ)

**Keyword Cluster:**
\`\`\`
Core:        ${input}
Supporting:  ${input} คืออะไร, ${input} วิธีทำ
Long-tail:   ${input} สำหรับมือใหม่ 2568
Question:    ทำไมต้อง ${input}, ${input} ดีไหม
\`\`\`

**SERP Analysis (ประมาณการ):**
- Position 1–3: มักเป็น guide ยาว 2,500+ คำ
- Featured snippet: definition box + numbered list
- People Also Ask: 4–6 คำถามที่ต้องตอบในบทความ

**Competitive Gap:**
- สร้างเนื้อหาที่ specific กว่า + อัปเดตกว่า competitor
- เพิ่ม original data/study เพื่อ E-E-A-T

→ ไปที่ **Projects → Keywords** เพื่อเพิ่ม keyword cluster และวางแผนบทความ`;
  }

  if (agent.id === "ux") {
    return `### UX/UI Review Framework

**Readability Score (Flesch-Kincaid adapted for Thai):**
- ย่อหน้าควรไม่เกิน **3–4 ประโยค** (120 คำ)
- ใช้ **H2 ทุก 300–400 คำ** เพื่อ visual break
- **Bold** คำสำคัญครั้งแรกที่ปรากฏ

**Mobile UX Checklist:**
- [ ] Font ≥ 16px บน mobile
- [ ] CTA button ≥ 44px tap target
- [ ] ไม่มี horizontal scroll
- [ ] Above-the-fold content ตอบ intent ใน 3 วินาที

**Conversion Optimization:**
\`\`\`
Hero section   → Hook + Value prop ชัดใน 1 ประโยค
After intro    → Soft CTA (อ่านต่อ / ดูราคา)
After H2 ที่ 2 → Hard CTA (ปรึกษาฟรี / สมัครเลย)
Before FAQ     → Social proof (testimonial/จำนวนลูกค้า)
\`\`\`

**ปัญหาที่พบบ่อยสุดใน SEO articles:**
- CTA อยู่แค่ท้ายบทความ (คนอ่านไม่ถึง)
- ไม่มี sticky header หรือ floating CTA บน mobile
- ตัวอักษรสีเทาบนพื้นขาว (contrast ต่ำ)`;
  }

  if (agent.id === "report") {
    return `### SEO Monthly Report Template

**Executive Summary (1 หน้า):**
\`\`\`
📈 Organic Traffic: +X% MoM (Y,YYY sessions)
🔑 Ranking Keywords: Z keywords ใน Top 10
✍️ Content Published: N บทความ
🔗 New Backlinks: M referring domains
\`\`\`

**Highlights this month:**
- บทความที่ perform ดีที่สุด: [title] — [sessions]
- Keyword ที่ขึ้นอันดับมากที่สุด: [keyword] pos [X→Y]
- Quick win ถัดไป: optimize [X] บทความที่อยู่ pos 11–20

**Data Visualization ที่ควรใส่:**
- 📊 Line chart: organic traffic 6 เดือน
- 📊 Bar chart: top 10 keywords by clicks
- 📊 Pie chart: traffic by page type (blog/landing/home)
- 📊 Table: keyword ranking changes

→ ไปที่ **AI SEO Report** หรือ **AI Jobs** เพื่อดู cost + performance`;
  }

  return `**Mars OS** รับทราบแล้วครับ

สามารถถามเกี่ยวกับ:
- ✍️ **Writer** — เขียนบทความ SEO
- 🔗 **Backlink** — หา link quality
- 🎨 **Image** — ปก + alt text
- 🔍 **Audit** — ตรวจคะแนนบทความ
- 📊 **Analysis** — วิเคราะห์ keyword
- ✨ **UX/UI** — ปรับ readability
- 📈 **Report** — สรุปผลให้ client

หรือพิมพ์ \`/workspace\` เพื่อเข้าสู่ระบบจัดการบทความ`;
}
