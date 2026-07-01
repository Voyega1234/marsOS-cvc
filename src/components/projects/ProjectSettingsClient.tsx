"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

const ArticleEditor = dynamic(
  () => import("@/components/articles/ArticleEditor").then((m) => m.ArticleEditor),
  { ssr: false, loading: () => <div className="h-48 border border-gray-100 rounded-2xl bg-gray-50 animate-pulse" /> }
);
import { toast } from "sonner";
import Link from "next/link";
import {
  ArrowLeft, Save, Loader2, Zap, Image as ImageIcon, Globe,
  Tag, Bot, Info, CheckCircle2, BarChart2, Link2, Plus, Trash2, Target,
  Power, PauseCircle, Archive, FileText, Paintbrush, GripVertical, Sparkles,
  Eye, EyeOff, ExternalLink, Key, XCircle,
} from "lucide-react";
import type { Role } from "@/types";

type ProjectFull = {
  id: string;
  name: string;
  clientName: string | null;
  website: string;
  businessType: string;
  targetAudience: string;
  language: string;
  industry: string | null;
  market: string | null;
  status: string;
  notes: string | null;
  projectContext: string | null;
  writingPrompt: string | null;
  imageStyleGuide: string | null;
  automationMode: string;
  gtmContainerId: string | null;
  ga4MeasurementId: string | null;
  ga4PropertyId: string | null;
  internalLinks: string;
  themeColors: string;
  wordpressConnectionId: string | null;
  defaultTemplateId: string | null;
  wordpressConnection: { id: string; name: string; siteUrl: string } | null;
  defaultTemplate: { id: string; name: string } | null;
  owner: { id: string; name: string | null } | null;
};

type Props = {
  project: ProjectFull;
  wpConnections: { id: string; name: string; siteUrl: string }[];
  templates: { id: string; name: string }[];
  userRole: Role;
  users?: { id: string; name: string | null; role: string }[];
};


const AUTOMATION_MODES = [
  {
    value: "MANUAL",
    label: "Manual — ควบคุมทุกขั้นตอน",
    desc: "ต้อง approve ทุกขั้น: Outline → Article → SEO → WordPress เหมาะสำหรับลูกค้า High-priority",
    color: "border-gray-100 bg-gray-50",
    badge: "bg-gray-100 text-gray-600",
  },
  {
    value: "SEMI_AUTO",
    label: "Semi-Auto — AI ทำงาน หยุดรอ Approve",
    desc: "AI run ต่อเนื่อง แต่หยุดรอ approve ที่ OUTLINE_DONE และ SEO_REVIEW เหมาะสำหรับงานปกติ",
    color: "border-amber-200 bg-amber-50",
    badge: "bg-amber-100 text-amber-700",
  },
  {
    value: "FULL_AUTO",
    label: "Full Auto — จบครบ Pipeline อัตโนมัติ",
    desc: "AI วิ่ง Outline → Article → SEO → Image → WordPress Draft โดยอัตโนมัติ ไม่ต้อง approve ระหว่างทาง",
    color: "border-green-200 bg-green-50",
    badge: "bg-green-100 text-green-700",
  },
];

// ── World-class SEO default writing sections ────────────────────────────────
function DEFAULT_WRITING_SECTIONS() {
  return [
    {
      id: crypto.randomUUID(),
      title: "📐 โครงสร้างบทความ (Article Architecture)",
      content: `<h2>หลักการสร้างโครงสร้างบทความ</h2>
<p>ทุกบทความต้องผ่านการวิเคราะห์ <strong>Search Intent</strong> ก่อนเสมอ — ดู Top 10 SERP แล้วสร้างโครงสร้างที่ดีกว่าคู่แข่ง</p>
<h3>โครงสร้างมาตรฐาน</h3>
<ul>
<li><strong>H1 (1 ครั้ง):</strong> keyword หลักอยู่ใน 5 คำแรก + value prop ชัดเจน ไม่เกิน 60 ตัวอักษร</li>
<li><strong>บทนำ (Intro Hook — 100-150 คำ):</strong> ตอบคำถาม "ทำไมถึงต้องอ่านบทความนี้" ใน 3 ประโยคแรก ใช้ PAS Framework (Problem → Agitate → Solution)</li>
<li><strong>H2 หลัก (4-7 หัวข้อ):</strong> ครอบคลุม semantic keywords และ People Also Ask ทั้งหมด เรียงจาก informational → actionable</li>
<li><strong>H3 ย่อย (2-4 ต่อ H2):</strong> แยก sub-topic ให้ Featured Snippet-friendly — ใช้ format list หรือ table</li>
<li><strong>FAQ Section:</strong> 5-8 คำถามจาก PAA + "People also search for" เพื่อเพิ่ม AEO (Answer Engine Optimization)</li>
<li><strong>Conclusion + CTA:</strong> สรุป key takeaway 3 ข้อ + CTA 1 จุด ไม่ hard-sell</li>
</ul>
<h3>ความยาวตาม Funnel Stage</h3>
<ul>
<li><strong>TOFU (Awareness):</strong> 2,000–3,500 คำ — อธิบายละเอียด ครอบคลุม topic cluster</li>
<li><strong>MOFU (Consideration):</strong> 1,500–2,500 คำ — เปรียบเทียบ ข้อดีข้อเสีย use cases</li>
<li><strong>BOFU (Decision):</strong> 1,000–1,800 คำ — เน้น conversion proof points และ trust signals</li>
</ul>`,
    },
    {
      id: crypto.randomUUID(),
      title: "🔍 SEO & Keyword Optimization",
      content: `<h2>กฎ SEO ที่ต้องทำทุกบทความ</h2>
<h3>Keyword Placement (On-Page SEO)</h3>
<ul>
<li><strong>Primary Keyword:</strong> ต้องอยู่ใน H1, ย่อหน้าแรก (100 คำแรก), meta description, URL slug และ H2 อย่างน้อย 1 ตัว</li>
<li><strong>Keyword Density:</strong> 0.8–1.5% — ห้ามยัด keyword (keyword stuffing) เด็ดขาด ใช้ LSI keywords แทน</li>
<li><strong>Semantic Keywords (LSI):</strong> ใส่ 8-15 คำที่เกี่ยวข้องกระจายทั่วบทความ — ดูจาก "Related Searches" ใน Google</li>
<li><strong>Entity Optimization:</strong> กล่าวถึง entities สำคัญ (บุคคล สถานที่ องค์กร) ที่เกี่ยวข้องกับ topic เพื่อสร้าง topical authority</li>
</ul>
<h3>Technical SEO ใน HTML</h3>
<ul>
<li><strong>Meta Title:</strong> keyword หลักอยู่ต้น + brand ท้าย ไม่เกิน 60 ตัวอักษร</li>
<li><strong>Meta Description:</strong> 150-160 ตัวอักษร มี keyword + benefit + CTA เบาๆ</li>
<li><strong>Image Alt Text:</strong> ทุกรูปต้องมี alt text ที่อธิบายรูปและมี keyword ถ้าเกี่ยวข้อง</li>
<li><strong>Internal Links:</strong> 3-6 links ต่อบทความ ใช้ descriptive anchor text ห้ามใช้ "คลิกที่นี่"</li>
<li><strong>External Links:</strong> 1-2 links ไปยัง authoritative sources (gov, edu, Wikipedia) เปิด new tab</li>
</ul>
<h3>Featured Snippet Optimization</h3>
<ul>
<li>ใส่ "คำถาม" เป็น H2/H3 แล้วตอบด้านล่างทันทีใน 40-60 คำ</li>
<li>ใช้ format: Definition → List → Table ขึ้นอยู่กับ query type</li>
<li>ทำ FAQ Schema (JSON-LD) ทุกบทความที่มี FAQ section</li>
</ul>`,
    },
    {
      id: crypto.randomUUID(),
      title: "✍️ สไตล์ภาษา & Tone of Voice",
      content: `<h2>หลักการเขียนที่ทำให้ผู้อ่านอยู่นานและ Convert</h2>
<h3>ต้องทำ ✅</h3>
<ul>
<li><strong>ตอบคำถามทันที (BLUF — Bottom Line Up Front):</strong> ผู้อ่านถามอะไรมา ตอบก่อนเลยใน 2 ประโยคแรก อย่าให้ scroll หาคำตอบ</li>
<li><strong>ประโยคสั้น:</strong> เฉลี่ยไม่เกิน 20 คำต่อประโยค ย่อหน้าไม่เกิน 3-4 บรรทัด</li>
<li><strong>Active Voice:</strong> "ทีมงานดูแล" ดีกว่า "ได้รับการดูแลโดยทีมงาน"</li>
<li><strong>Specificity:</strong> ใช้ตัวเลขจริง เช่น "อัตราสำเร็จ 94.7%" ดีกว่า "อัตราสำเร็จสูง"</li>
<li><strong>Bucket Brigades:</strong> ใช้คำเชื่อมที่ดึงให้อ่านต่อ เช่น "นี่คือสิ่งที่น่าสนใจ:", "ปัญหาคือ:", "มีวิธีแก้คือ:"</li>
<li><strong>Power Words:</strong> ใช้คำที่กระตุ้นอารมณ์ เช่น "พิสูจน์แล้ว", "ฟรี", "ทันที", "ง่าย", "รับประกัน"</li>
</ul>
<h3>ห้ามทำ ❌</h3>
<ul>
<li>ห้ามเริ่มบทความด้วยคำว่า "ในปัจจุบัน", "เนื่องจาก" หรือ "สำหรับ"</li>
<li>ห้ามใช้ Passive Voice เกิน 20% ของบทความ</li>
<li>ห้ามใช้คำฟุ่มเฟือย: "นอกจากนี้แล้วยังมี", "ดังที่ได้กล่าวมาข้างต้น"</li>
<li>ห้ามใช้ภาษาวิชาการเกินไป — เขียนเหมือนคุยกับเพื่อนที่ฉลาด ไม่ใช่เขียนรายงาน</li>
<li>ห้ามสัญญาสิ่งที่พิสูจน์ไม่ได้ หรือข้อความที่ mislead ผู้อ่าน</li>
</ul>
<h3>Readability Target</h3>
<ul>
<li>Flesch Reading Ease: 60+ (อ่านง่าย ระดับ ม.ปลาย)</li>
<li>ใช้ bullet point แทนย่อหน้ายาวเสมอเมื่อมี 3 items ขึ้นไป</li>
<li>ใส่ table สำหรับข้อมูลเปรียบเทียบ ดีกว่าเขียนบรรยาย</li>
</ul>`,
    },
    {
      id: crypto.randomUUID(),
      title: "⭐ E-E-A-T & Trust Signals",
      content: `<h2>สร้าง Credibility ที่ Google และผู้อ่านไว้วางใจ</h2>
<p><strong>E-E-A-T</strong> = Experience, Expertise, Authoritativeness, Trustworthiness — มาตรฐาน Google Quality Rater Guidelines ที่ทุกบทความต้องผ่าน</p>
<h3>Experience (ประสบการณ์จริง)</h3>
<ul>
<li>ใส่ first-hand experience: "จากที่เราช่วยลูกค้า 500+ ราย...", "ในกรณีของลูกค้า X..."</li>
<li>ใช้ case study จริงหรือ scenario ที่เป็นไปได้ ไม่ใช่แค่ทฤษฎี</li>
<li>ใส่ตัวเลขและสถิติจริงที่สามารถ verify ได้</li>
</ul>
<h3>Expertise (ความเชี่ยวชาญ)</h3>
<ul>
<li>อธิบาย technical concept ให้ถูกต้องและลึกกว่าคู่แข่ง</li>
<li>ใส่ nuance และ edge cases ที่บทความทั่วไปไม่พูดถึง</li>
<li>Reference แหล่งข้อมูลน่าเชื่อถือ: งานวิจัย, สถาบันราชการ, องค์กรระหว่างประเทศ</li>
</ul>
<h3>Authoritativeness (ความน่าเชื่อถือ)</h3>
<ul>
<li>ใส่ Author Bio ที่มี credentials จริง (ถ้ามี)</li>
<li>กล่าวถึง awards, certifications, years of experience ของแบรนด์</li>
<li>ใส่ media mentions หรือ partnerships ที่เกี่ยวข้อง</li>
</ul>
<h3>Trustworthiness (ความโปร่งใส)</h3>
<ul>
<li>ระบุวันที่ publish และ last updated ทุกบทความ</li>
<li>มี disclaimer เมื่อจำเป็น เช่น "ข้อมูลนี้ไม่ใช่คำแนะนำทางกฎหมาย"</li>
<li>ห้ามใช้ข้อมูลที่ verify ไม่ได้ หรือ statistics ที่ไม่มีแหล่งอ้างอิง</li>
<li>ใส่ structured data (Schema.org) ทุกบทความ: Article, FAQ, Breadcrumb</li>
</ul>`,
    },
    {
      id: crypto.randomUUID(),
      title: "🎯 CTA & Conversion Strategy",
      content: `<h2>เปลี่ยน Traffic เป็น Leads และ Customers</h2>
<h3>CTA Placement Framework</h3>
<ul>
<li><strong>บทนำ (Optional):</strong> Soft CTA — "ดู case study จริง →" หรือ "คุณสมบัติที่ต้องรู้ก่อน ดาวน์โหลดฟรี"</li>
<li><strong>กลางบทความ (ต้องมี):</strong> Contextual CTA ที่เกี่ยวข้องกับ content section นั้นๆ — ไม่ใช่แค่ banner ทั่วไป</li>
<li><strong>ท้ายบทความ (ต้องมี):</strong> Primary CTA ชัดเจน 1 จุด — "ปรึกษาฟรีวันนี้" / "ดูราคา" / "สมัครทดลอง"</li>
</ul>
<h3>กฎการเขียน CTA</h3>
<ul>
<li>ใช้ <strong>Action Verb + Benefit</strong>: "รับคำปรึกษาฟรี" ดีกว่า "ติดต่อเรา"</li>
<li>เพิ่ม urgency หรือ specificity: "ฟรีเฉพาะวันนี้", "เหลือ 3 ที่ว่าง", "ภายใน 24 ชั่วโมง"</li>
<li>ใส่ risk reversal ก่อน CTA: "ไม่มีค่าใช้จ่าย ไม่มีข้อผูกมัด"</li>
<li>ห้ามมี CTA มากกว่า 2 จุดต่อบทความ — focus ผู้อ่านไปที่ action เดียว</li>
</ul>
<h3>Social Proof ที่ต้องใส่</h3>
<ul>
<li>ตัวเลข: "ลูกค้า 1,200+ ราย", "อัตราสำเร็จ 96%", "รีวิว 4.9/5 จาก 340 รีวิว"</li>
<li>Logo ลูกค้า หรือ "trusted by" section (ถ้า brand มี)</li>
<li>Testimonial สั้น 1-2 ประโยคจากลูกค้าจริงใกล้ CTA</li>
<li>Awards หรือ certifications ที่เกี่ยวข้องกับ pain point ของผู้อ่าน</li>
</ul>
<h3>Micro-Conversion (สำหรับ TOFU)</h3>
<ul>
<li>Lead magnet: checklist, template, หรือ guide ที่ download ได้ฟรี</li>
<li>Email capture: "รับ update บทความใหม่" หรือ "รับ guide ฟรี"</li>
<li>Internal link ไป BOFU content ที่ใกล้ conversion มากกว่า</li>
</ul>`,
    },
  ];
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-xl bg-green-50 flex items-center justify-center">
          <Icon className="h-4 w-4 text-green-600" />
        </div>
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default function ProjectSettingsClient({ project, wpConnections, templates, userRole, users = [] }: Props) {
  const router = useRouter();
  const canEdit = ["ADMIN", "SEO_MANAGER"].includes(userRole);

  const [saving, setSaving] = useState<string | null>(null);

  // Form state
  const [projectContext, setProjectContext] = useState(project.projectContext ?? "");
  const [writingSections, setWritingSections] = useState<{ id: string; title: string; content: string }[]>(() => {
    try {
      const parsed = JSON.parse(project.writingPrompt ?? "");
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // Legacy single HTML string → migrate
      if (project.writingPrompt && project.writingPrompt !== "[]") {
        return [{ id: crypto.randomUUID(), title: "Writing Instructions", content: project.writingPrompt }];
      }
    }
    return DEFAULT_WRITING_SECTIONS();
  });

  const [themeStylePrompt, setThemeStylePrompt] = useState<string>(() => {
    try {
      const parsed = JSON.parse(project.themeColors);
      return parsed.__stylePrompt ?? "";
    } catch { return ""; }
  });
  const [imageStyleGuide, setImageStyleGuide] = useState(project.imageStyleGuide ?? "");
  const [automationMode, setAutomationMode] = useState(project.automationMode ?? "MANUAL");
  const [monthlyTarget, setMonthlyTarget]   = useState(String((project as { monthlyTarget?: number | null }).monthlyTarget ?? ""));
  const [aiCostLimit, setAiCostLimit]       = useState(String((project as { aiCostLimit?: number | null }).aiCostLimit ?? ""));
  const [slackWebhookUrl, setSlackWebhookUrl] = useState((project as { slackWebhookUrl?: string | null }).slackWebhookUrl ?? "");
  const [defaultWriterId,   setDefaultWriterId]   = useState((project as { defaultWriterId?: string | null }).defaultWriterId ?? "");
  const [defaultReviewerId, setDefaultReviewerId] = useState((project as { defaultReviewerId?: string | null }).defaultReviewerId ?? "");
  const [gtmContainerId, setGtmContainerId] = useState(project.gtmContainerId ?? "");
  const [ga4MeasurementId, setGa4MeasurementId] = useState(project.ga4MeasurementId ?? "");
  const [ga4PropertyId, setGa4PropertyId] = useState(project.ga4PropertyId ?? "");
  const [themeColors, setThemeColors] = useState<Record<string, string>>(() => {
    try { return JSON.parse(project.themeColors); } catch { return {}; }
  });
  const [internalLinks, setInternalLinks] = useState<{ keyword: string; url: string }[]>(() => {
    try { return JSON.parse(project.internalLinks); } catch { return []; }
  });
  const [wordpressConnectionId, setWordpressConnectionId] = useState(project.wordpressConnectionId ?? "");
  const [defaultTemplateId, setDefaultTemplateId] = useState(project.defaultTemplateId ?? "");
  const [wpUrl, setWpUrl] = useState((project as { wpUrl?: string | null }).wpUrl ?? "");
  const [wpUser, setWpUser] = useState((project as { wpUser?: string | null }).wpUser ?? "");
  const [wpAppPassword, setWpAppPassword] = useState((project as { wpAppPassword?: string | null }).wpAppPassword ?? "");
  const [showWpPassword, setShowWpPassword] = useState(false);

  async function save(section: string, data: Record<string, string | null>) {
    setSaving(section);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error();
      toast.success("บันทึกเรียบร้อย ✅");
      router.refresh();
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">

      {/* Header */}
      <div>
        <Link
          href={`/projects/${project.id}`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-green-600 transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับหน้า {project.name}
        </Link>
        <h1 className="text-xl font-bold text-gray-900">⚙️ ตั้งค่าโปรเจกต์</h1>
        <p className="text-sm text-gray-500 mt-1">{project.name} · {project.website}</p>
      </div>

      {/* ── 1. Project Context (like GPT Project Source) ── */}
      <Section title="Project Context — AI System Prompt" icon={Bot}>
        <div className="p-3 bg-blue-50 rounded-xl text-sm text-blue-800 border border-b border-gray-100lue-100 flex gap-2">
          <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>เหมือน <strong>Project Source ใน ChatGPT</strong> — ใส่ข้อมูลสำคัญของลูกค้าที่ AI ต้องรู้: brand, tone, ข้อห้าม, unique selling points, compliance rules ฯลฯ</span>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Brand & Business Context
          </label>
          <textarea
            value={projectContext}
            onChange={(e) => setProjectContext(e.target.value)}
            disabled={!canEdit}
            rows={12}
            placeholder={`ตัวอย่าง:
ชื่อแบรนด์: Co Journey Visa
ธุรกิจ: บริษัทรับยื่นวีซ่าและแปลเอกสาร NAATI
กลุ่มเป้าหมาย: คนไทยที่ต้องการยื่นวีซ่ายุโรป/ออสเตรเลีย

โทนเสียง: เป็นมิตร เชี่ยวชาญ ให้ความมั่นใจ ไม่เป็นทางการเกินไป

จุดแข็ง (USP):
- ทีม NAATI Certified Translator
- อัตราสำเร็จ 95%+
- ดูแลครบถ้วนตั้งแต่เอกสารถึงวันสัมภาษณ์

ข้อห้าม (Forbidden Claims):
- ห้ามรับประกัน 100% ว่าวีซ่าจะผ่าน
- ห้ามเปรียบเทียบราคาโดยตรงกับคู่แข่ง

CTA หลัก: "ปรึกษาฟรี" → /contact
ช่องทางติดต่อ: LINE: @cojourneyvis, Tel: 02-xxx-xxxx`}
            className="w-full px-4 py-3 border border-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono leading-relaxed resize-y disabled:bg-gray-50 disabled:text-gray-400"
          />
          <p className="text-xs text-gray-400 mt-1.5">{projectContext.length} ตัวอักษร</p>
        </div>
        {canEdit && (
          <button
            onClick={() => save("context", { projectContext: projectContext || null })}
            disabled={!!saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
          >
            {saving === "context" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            บันทึก Context
          </button>
        )}
      </Section>

      {/* ── 2. Article Writing Instructions (multi-section) ── */}
      <Section title="Article Writing Instructions — สไตล์การเขียน" icon={FileText}>
        <div className="p-3 bg-violet-50 rounded-xl text-sm text-violet-800 border border-violet-100 flex items-start justify-between gap-3">
          <div className="flex gap-2">
            <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              เพิ่มได้หลายหัวข้อ — แต่ละหัวข้อมี editor ตกแต่งได้ AI จะใช้ทั้งหมดตอนเขียนบทความ
            </span>
          </div>
          {canEdit && (
            <button
              onClick={() => {
                if (confirm("โหลด Pro SEO Template?\n\n5 sections: โครงสร้างบทความ, SEO & Keyword, สไตล์ภาษา, E-E-A-T, CTA Strategy\n\n(จะแทนที่ sections ปัจจุบันทั้งหมด)")) {
                  setWritingSections(DEFAULT_WRITING_SECTIONS());
                }
              }}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
            >
              <Sparkles className="h-3.5 w-3.5" />
              โหลด Pro Template
            </button>
          )}
        </div>

        <div className="space-y-5">
          {writingSections.map((sec, idx) => (
            <div key={sec.id} className="border border-violet-100 rounded-2xl overflow-hidden">
              {/* Section header */}
              <div className="flex items-center gap-2 px-4 py-2.5 bg-violet-50/60 border-b border-violet-100">
                <GripVertical className="h-4 w-4 text-violet-300 flex-shrink-0" />
                <input
                  type="text"
                  value={sec.title}
                  onChange={(e) => setWritingSections((prev) =>
                    prev.map((s, i) => i === idx ? { ...s, title: e.target.value } : s)
                  )}
                  disabled={!canEdit}
                  placeholder="ชื่อหัวข้อ เช่น โครงสร้างบทความ"
                  className="flex-1 bg-transparent text-sm font-semibold text-violet-800 focus:outline-none placeholder-violet-300 disabled:opacity-60"
                />
                {canEdit && writingSections.length > 1 && (
                  <button
                    onClick={() => setWritingSections((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-violet-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              {/* Editor */}
              <ArticleEditor
                value={sec.content}
                onChange={useCallback((html: string) => {
                  setWritingSections((prev) =>
                    prev.map((s, i) => i === idx ? { ...s, content: html } : s)
                  );
                // eslint-disable-next-line react-hooks/exhaustive-deps
                }, [idx])}
                readOnly={!canEdit}
                placeholder="พิมพ์ instructions สำหรับหัวข้อนี้... หรือกด ✨ โหลด Pro SEO Template ด้านล่าง"
              />
            </div>
          ))}
        </div>

        {canEdit && (
          <button
            onClick={() => setWritingSections((prev) => [
              ...prev,
              { id: crypto.randomUUID(), title: "", content: "" },
            ])}
            className="flex items-center gap-2 text-sm text-violet-600 hover:text-violet-700 font-medium transition-colors"
          >
            <Plus className="h-4 w-4" />
            เพิ่มหัวข้อใหม่
          </button>
        )}

        {canEdit && (
          <button
            onClick={() => save("writing", { writingPrompt: JSON.stringify(writingSections) })}
            disabled={!!saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
          >
            {saving === "writing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            บันทึก Writing Instructions
          </button>
        )}
      </Section>

      {/* ── 2b. Style Theme Colors ── */}
      <Section title="Style Theme Colors — สีของแบรนด์" icon={Paintbrush}>
        <div className="p-3 bg-rose-50 rounded-xl text-sm text-rose-800 border border-rose-100 flex gap-2">
          <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>กำหนดสีหลักของแบรนด์ — AI และ editor จะใช้สีเหล่านี้เป็น default เมื่อ format บทความ</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { key: "primary",    label: "Primary Color",    placeholder: "#1b5e20", desc: "สีหลัก เช่น ปุ่ม, หัวข้อ" },
            { key: "secondary",  label: "Secondary Color",  placeholder: "#c9a84c", desc: "สีรอง เช่น accent, badge" },
            { key: "accent",     label: "Accent / CTA",     placeholder: "#ef4444", desc: "สี CTA, highlight สำคัญ" },
            { key: "text",       label: "Text Color",       placeholder: "#111827", desc: "สีตัวอักษรหลัก" },
            { key: "background", label: "Background",       placeholder: "#ffffff", desc: "พื้นหลัง article" },
            { key: "border",     label: "Border / Divider", placeholder: "#e5e7eb", desc: "สีเส้นกรอบ" },
          ].map(({ key, label, placeholder, desc }) => (
            <div key={key} className="flex items-center gap-3">
              <div className="relative flex-shrink-0">
                <input
                  type="color"
                  value={themeColors[key] ?? placeholder}
                  onChange={(e) => setThemeColors((prev) => ({ ...prev, [key]: e.target.value }))}
                  disabled={!canEdit}
                  className="w-10 h-10 rounded-xl border border-gray-100 cursor-pointer p-0.5 disabled:opacity-50"
                />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-800">{label}</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={themeColors[key] ?? ""}
                    onChange={(e) => setThemeColors((prev) => ({ ...prev, [key]: e.target.value }))}
                    disabled={!canEdit}
                    placeholder={placeholder}
                    maxLength={7}
                    className="w-24 px-2 py-1 border border-gray-100 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-rose-400 disabled:bg-gray-50"
                  />
                  <span className="text-xs text-gray-400">{desc}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Style prompt — describe the theme in words for AI */}
        <div className="pt-2 border-t border-gray-100">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Style Prompt — อธิบาย visual style เพิ่มเติม (AI จะใช้ตอนสร้างกรอบ / ตกแต่ง)
          </label>
          <ArticleEditor
            value={themeStylePrompt}
            onChange={useCallback((html: string) => setThemeStylePrompt(html), [])}
            readOnly={!canEdit}
            placeholder={`ตัวอย่าง:\n\n🎨 Visual Style:\nสีหลักเขียวเข้ม (#1b5e20) สื่อถึงความน่าเชื่อถือ ใช้เป็นสี heading และปุ่ม\nสีทอง (#c9a84c) เป็น accent สำหรับ highlight ข้อมูลสำคัญ\n\n📦 กรอบ / Callout Box:\n- Tip box: พื้นเขียวอ่อน + เส้นซ้ายสีเขียว → ใช้สำหรับเคล็ดลับ\n- Warning box: พื้นเหลือง + เส้นส้ม → ใช้สำหรับข้อควรระวัง\n- กรอบปกติ: border สีเทา radius 12px\n\n✍️ Typography:\n- Heading: font-weight 800, สีเขียวเข้ม\n- Body text: สีเทาเข้ม #374151\n- Link: underline สีเขียว`}
          />
        </div>

        {canEdit && (
          <button
            onClick={() => save("themeColors", {
              themeColors: JSON.stringify({ ...themeColors, __stylePrompt: themeStylePrompt }),
            })}
            disabled={!!saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
          >
            {saving === "themeColors" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            บันทึก Theme Colors &amp; Style
          </button>
        )}
      </Section>

      {/* ── Image Style Guide ── */}
      <Section title="Image Style Guide" icon={ImageIcon}>
        <div className="p-3 bg-pink-50 rounded-xl text-sm text-pink-800 border border-pink-100 flex gap-2">
          <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>กำหนด style ของรูปภาพ cover ให้สอดคล้องกับ brand ลูกค้า AI จะใช้ข้อมูลนี้ทุกครั้งที่สร้าง Image Prompt</span>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Image Style Instructions
          </label>
          <textarea
            value={imageStyleGuide}
            onChange={(e) => setImageStyleGuide(e.target.value)}
            disabled={!canEdit}
            rows={7}
            placeholder={`ตัวอย่าง:
Photography style: editorial, professional, clean
Color palette: navy blue (#1e3a5f), gold (#c9a84c), white
Mood: trustworthy, sophisticated, approachable
Subject: real people (not cartoon), clean backgrounds
Avoid: stock photo clichés, watermarks, text overlay
Aspect ratio: 16:9
Reference style: similar to McKinsey, Deloitte blog covers`}
            className="w-full px-4 py-3 border border-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono leading-relaxed resize-y disabled:bg-gray-50 disabled:text-gray-400"
          />
        </div>
        {canEdit && (
          <button
            onClick={() => save("image", { imageStyleGuide: imageStyleGuide || null })}
            disabled={!!saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
          >
            {saving === "image" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            บันทึก Image Style
          </button>
        )}
      </Section>

      {/* ── Automation Mode ── */}
      <Section title="Automation Mode" icon={Zap}>
        <div className="space-y-3">
          {AUTOMATION_MODES.map((mode) => (
            <label
              key={mode.value}
              className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                automationMode === mode.value
                  ? mode.color + " ring-2 ring-green-400 ring-offset-1"
                  : "border-gray-100 bg-white hover:border-gray-100"
              } ${!canEdit ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="automationMode"
                value={mode.value}
                checked={automationMode === mode.value}
                onChange={(e) => canEdit && setAutomationMode(e.target.value)}
                disabled={!canEdit}
                className="mt-1 accent-green-600"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900 text-sm">{mode.label}</span>
                  {project.automationMode === mode.value && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${mode.badge}`}>
                      ใช้งานอยู่
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-0.5 leading-relaxed">{mode.desc}</p>
              </div>
            </label>
          ))}
        </div>
        {canEdit && (
          <button
            onClick={() => save("automation", { automationMode })}
            disabled={!!saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
          >
            {saving === "automation" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            บันทึก Automation Mode
          </button>
        )}
      </Section>

      {/* ── Target & Alerts ── */}
      <Section title="เป้าหมาย & การแจ้งเตือน" icon={Target}>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">เป้าหมายบทความ/เดือน</label>
            <input
              type="number"
              min={0}
              value={monthlyTarget}
              onChange={(e) => setMonthlyTarget(e.target.value)}
              disabled={!canEdit}
              placeholder="เช่น 20"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-200 disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">AI Cost Limit / เดือน ($)</label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={aiCostLimit}
              onChange={(e) => setAiCostLimit(e.target.value)}
              disabled={!canEdit}
              placeholder="เช่น 10"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-200 disabled:bg-gray-50"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Slack Webhook URL (แจ้งเตือนเมื่อ AI เสร็จ / รอ Review)</label>
          <input
            type="url"
            value={slackWebhookUrl}
            onChange={(e) => setSlackWebhookUrl(e.target.value)}
            disabled={!canEdit}
            placeholder="https://hooks.slack.com/services/..."
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-200 disabled:bg-gray-50"
          />
          <p className="text-xs text-gray-400 mt-1">สร้าง Incoming Webhook ได้ที่ Slack API → Your Apps → Incoming Webhooks</p>
        </div>
        {users.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Auto-assign Writer (default)</label>
              <select
                value={defaultWriterId}
                onChange={(e) => setDefaultWriterId(e.target.value)}
                disabled={!canEdit}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-200 disabled:bg-gray-50"
              >
                <option value="">— ไม่กำหนด —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.id} ({u.role})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Auto-assign Reviewer (default)</label>
              <select
                value={defaultReviewerId}
                onChange={(e) => setDefaultReviewerId(e.target.value)}
                disabled={!canEdit}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-200 disabled:bg-gray-50"
              >
                <option value="">— ไม่กำหนด —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.id} ({u.role})</option>)}
              </select>
            </div>
          </div>
        )}
        {canEdit && (
          <button
            onClick={() => save("targets", { monthlyTarget, aiCostLimit, slackWebhookUrl, defaultWriterId: defaultWriterId || null, defaultReviewerId: defaultReviewerId || null })}
            disabled={!!saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
          >
            {saving === "targets" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            บันทึกเป้าหมาย
          </button>
        )}
      </Section>

      {/* ── Google Tag Manager ── */}
      <Section title="Google Tag Manager (GTM)" icon={Tag}>
        <div className="p-3 bg-amber-50 rounded-xl text-sm text-amber-800 border border-amber-100 flex gap-2">
          <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>ใส่ GTM Container ID ของลูกค้า (เช่น <code className="bg-amber-100 px-1 rounded">GTM-XXXXXXX</code>) เพื่อให้ Mars ติด tracking code ในทุกบทความที่ export ไป WordPress</span>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            GTM Container ID
          </label>
          <input
            type="text"
            value={gtmContainerId}
            onChange={(e) => setGtmContainerId(e.target.value)}
            disabled={!canEdit}
            placeholder="GTM-XXXXXXX"
            className="w-full px-4 py-2.5 border border-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono disabled:bg-gray-50"
          />
          {gtmContainerId && (
            <div className="mt-2 flex items-center gap-2 text-xs text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              GTM snippet จะถูก inject ใน &lt;head&gt; ของทุกบทความที่ส่งไป WordPress
            </div>
          )}
          <p className="text-xs text-gray-400 mt-2">
            ดู GTM Container ID ได้ที่{" "}
            <a href="https://tagmanager.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
              tagmanager.google.com
            </a>{" "}
            → Container Settings → Container ID
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => save("gtm", { gtmContainerId: gtmContainerId || null })}
            disabled={!!saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
          >
            {saving === "gtm" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            บันทึก GTM ID
          </button>
        )}
      </Section>

      {/* ── Google Analytics 4 ── */}
      <Section title="Google Analytics 4 (GA4)" icon={BarChart2}>
        <div className="p-3 bg-orange-50 rounded-xl text-sm text-orange-800 border border-orange-100 flex gap-2">
          <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>
            เชื่อม GA4 เพื่อดูสถิติ traffic ของแต่ละบทความ ใส่ทั้ง <strong>Measurement ID</strong> (ใช้ฝัง script) และ <strong>Property ID</strong> (ใช้ดึง Data API)
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Measurement ID
            </label>
            <input
              type="text"
              value={ga4MeasurementId}
              onChange={(e) => setGa4MeasurementId(e.target.value)}
              disabled={!canEdit}
              placeholder="G-XXXXXXXXXX"
              className="w-full px-4 py-2.5 border border-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono disabled:bg-gray-50"
            />
            <p className="text-xs text-gray-400 mt-1">ใช้ฝัง GA4 snippet ในบทความ</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Property ID
            </label>
            <input
              type="text"
              value={ga4PropertyId}
              onChange={(e) => setGa4PropertyId(e.target.value)}
              disabled={!canEdit}
              placeholder="123456789"
              className="w-full px-4 py-2.5 border border-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono disabled:bg-gray-50"
            />
            <p className="text-xs text-gray-400 mt-1">ตัวเลข เช่น 123456789 (Data API)</p>
          </div>
        </div>
        {ga4MeasurementId && (
          <div className="flex items-center gap-2 text-xs text-green-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            GA4 script จะถูก inject ในบทความที่ส่งไป WordPress
          </div>
        )}
        <p className="text-xs text-gray-400">
          ดู Property ID ได้ที่{" "}
          <a href="https://analytics.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
            analytics.google.com
          </a>{" "}
          → Admin → Property Settings → Property ID
        </p>
        {canEdit && (
          <button
            onClick={() => save("ga4", {
              ga4MeasurementId: ga4MeasurementId || null,
              ga4PropertyId: ga4PropertyId || null,
            })}
            disabled={!!saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
          >
            {saving === "ga4" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            บันทึก GA4
          </button>
        )}
      </Section>

      {/* ── Internal Links ── */}
      <Section title="Internal Links — ลิงก์ภายในอัตโนมัติ" icon={Link2}>
        <div className="p-3 bg-purple-50 rounded-xl text-sm text-purple-800 border border-purple-100 flex gap-2">
          <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>
            ใส่คีย์เวิร์ดและ URL ที่ต้องการให้ AI แทรก internal link ในทุกบทความโดยอัตโนมัติ
            (3–7 ลิงก์ต่อบทความ ตามความเหมาะสม)
          </span>
        </div>
        <div className="space-y-2">
          {internalLinks.map((link, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="text"
                value={link.keyword}
                onChange={(e) => {
                  const next = [...internalLinks];
                  next[idx] = { ...next[idx], keyword: e.target.value };
                  setInternalLinks(next);
                }}
                disabled={!canEdit}
                placeholder="คีย์เวิร์ด เช่น วีซ่าเชงเก้น"
                className="w-40 px-3 py-2 border border-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 disabled:bg-gray-50"
              />
              <input
                type="text"
                value={link.url}
                onChange={(e) => {
                  const next = [...internalLinks];
                  next[idx] = { ...next[idx], url: e.target.value };
                  setInternalLinks(next);
                }}
                disabled={!canEdit}
                placeholder="https://example.com/page"
                className="flex-1 px-3 py-2 border border-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 font-mono disabled:bg-gray-50"
              />
              {canEdit && (
                <button
                  onClick={() => setInternalLinks((prev) => prev.filter((_, i) => i !== idx))}
                  className="text-gray-300 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <button
              onClick={() => setInternalLinks((prev) => [...prev, { keyword: "", url: "" }])}
              className="flex items-center gap-1.5 text-sm text-purple-600 hover:text-purple-700 font-medium transition-colors"
            >
              <Plus className="h-4 w-4" />
              เพิ่ม Internal Link
            </button>
          )}
          {internalLinks.length === 0 && (
            <p className="text-xs text-gray-400">ยังไม่มี internal link — กด "เพิ่ม" เพื่อเริ่มต้น</p>
          )}
        </div>
        <div className="text-xs text-gray-400">
          {internalLinks.filter((l) => l.keyword && l.url).length} ลิงก์ที่กรอกครบแล้ว
        </div>
        {canEdit && (
          <button
            onClick={() => save("internalLinks", {
              internalLinks: JSON.stringify(internalLinks.filter((l) => l.keyword && l.url)),
            })}
            disabled={!!saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
          >
            {saving === "internalLinks" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            บันทึก Internal Links
          </button>
        )}
      </Section>

      {/* ── WordPress Connection ── */}
      <Section title="WordPress Connection" icon={Globe}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              เลือก WordPress Site
            </label>
            <select
              value={wordpressConnectionId}
              onChange={(e) => setWordpressConnectionId(e.target.value)}
              disabled={!canEdit}
              className="w-full px-4 py-2.5 border border-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white disabled:bg-gray-50"
            >
              <option value="">— ยังไม่ได้เชื่อม —</option>
              {wpConnections.map((wp) => (
                <option key={wp.id} value={wp.id}>{wp.name} ({wp.siteUrl})</option>
              ))}
            </select>
          </div>
          {wpConnections.length === 0 && (
            <p className="text-sm text-gray-400">
              ยังไม่มี WordPress connection —{" "}
              <Link href="/settings#wordpress" className="text-green-600 hover:underline font-medium">
                เพิ่มใน Settings
              </Link>
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Brand Template เริ่มต้น
          </label>
          <select
            value={defaultTemplateId}
            onChange={(e) => setDefaultTemplateId(e.target.value)}
            disabled={!canEdit}
            className="w-full px-4 py-2.5 border border-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white disabled:bg-gray-50"
          >
            <option value="">— ใช้ template ขององค์กร —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        {canEdit && (
          <button
            onClick={() => save("connections", {
              wordpressConnectionId: wordpressConnectionId || null,
              defaultTemplateId: defaultTemplateId || null,
            })}
            disabled={!!saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
          >
            {saving === "connections" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            บันทึก Connections
          </button>
        )}

        {/* Direct WP credentials (per-project) */}
        <div className="border-t border-gray-100 pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Direct WordPress Credentials</p>
            {wpUrl && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">ตั้งค่าแล้ว</span>}
          </div>
          <p className="text-xs text-gray-400">ใช้สำหรับ Push Tab — เก็บต่อโปรเจคนี้โดยเฉพาะ (override .env)</p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">WordPress URL</label>
            <input
              type="url"
              value={wpUrl}
              onChange={(e) => setWpUrl(e.target.value)}
              disabled={!canEdit}
              placeholder="https://yoursite.com"
              className="w-full px-4 py-2.5 border border-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white disabled:bg-gray-50"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Username</label>
              <input
                type="text"
                value={wpUser}
                onChange={(e) => setWpUser(e.target.value)}
                disabled={!canEdit}
                placeholder="admin"
                className="w-full px-4 py-2.5 border border-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Application Password</label>
              <div className="relative">
                <input
                  type={showWpPassword ? "text" : "password"}
                  value={wpAppPassword}
                  onChange={(e) => setWpAppPassword(e.target.value)}
                  disabled={!canEdit}
                  placeholder="xxxx xxxx xxxx xxxx"
                  className="w-full px-4 py-2.5 border border-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white disabled:bg-gray-50 pr-10"
                />
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setShowWpPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showWpPassword ? "🙈" : "👁"}
                  </button>
                )}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-gray-400">
            สร้าง Application Password: WP Admin → Users → Profile → Application Passwords
          </p>
          {canEdit && (
            <button
              onClick={() => save("wp-direct", {
                wpUrl: wpUrl.trim().replace(/\/$/, "") || null,
                wpUser: wpUser.trim() || null,
                wpAppPassword: wpAppPassword.trim() || null,
              })}
              disabled={!!saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
            >
              {saving === "wp-direct" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              บันทึก WP Credentials
            </button>
          )}
        </div>
      </Section>

      {/* ── Project Status ── */}
      {canEdit && (
        <div className="bg-white rounded-2xl border-2 border-red-100 p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center">
              <Power className="h-4 w-4 text-red-500" />
            </div>
            <h2 className="text-base font-bold text-gray-900">สถานะโปรเจกต์</h2>
            <span className={`ml-auto text-xs px-3 py-1 rounded-full font-semibold ${
              project.status === "ACTIVE" ? "bg-green-100 text-green-700" :
              project.status === "PAUSED" ? "bg-amber-100 text-amber-700" :
              "bg-gray-100 text-gray-500"
            }`}>
              {project.status}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              onClick={() => save("status", { status: "ACTIVE" })}
              disabled={!!saving || project.status === "ACTIVE"}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-green-200 bg-green-50 text-green-700 text-sm font-semibold hover:bg-green-100 transition-colors disabled:opacity-40"
            >
              {saving === "status" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              Active
            </button>
            <button
              onClick={() => save("status", { status: "PAUSED" })}
              disabled={!!saving || project.status === "PAUSED"}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-amber-200 bg-amber-50 text-amber-700 text-sm font-semibold hover:bg-amber-100 transition-colors disabled:opacity-40"
            >
              {saving === "status" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />}
              Pause
            </button>
            <button
              onClick={async () => {
                if (!confirm(`ต้องการ archive "${project.name}" จริงหรือ?\nบทความและ keyword ยังคงอยู่ แต่จะไม่แสดงในรายการหลัก`)) return;
                await save("status", { status: "ARCHIVED" });
                router.push("/dashboard");
              }}
              disabled={!!saving || project.status === "ARCHIVED"}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-gray-100 bg-gray-50 text-gray-600 text-sm font-semibold hover:bg-gray-100 transition-colors disabled:opacity-40"
            >
              {saving === "status" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
              Archive
            </button>
          </div>
          <p className="text-xs text-gray-400">
            <strong>Active</strong> — ทำงานปกติ ·{" "}
            <strong>Pause</strong> — หยุดชั่วคราว ยังมองเห็นอยู่ ·{" "}
            <strong>Archive</strong> — ซ่อนจากรายการหลัก (กู้คืนได้)
          </p>
        </div>
      )}

    </div>
  );
}

