"use client";

/**
 * การ์ดอธิบายช่องในฟอร์ม "เพิ่มเว็บ PBN" — แต่ละช่องคืออะไร และไปเอาค่ามาจากไหน
 * แสดงเฉพาะหัวข้อของแพลตฟอร์มที่เลือกอยู่ (GitHub / WordPress) + ส่วน Report ที่ใช้ร่วมกัน
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";

type Item = { field: string; what: string; where: string };

const COMMON: Item[] = [
  { field: "ชื่อเว็บ", what: "ชื่อเรียกในระบบ ใช้ตั้งชื่อสไตล์บทความและแสดงตอนเลือกเว็บ", where: "ตั้งเองได้ เช่น PBN รีวิวคอนโด 1" },
  { field: "URL เว็บ", what: "หน้าแรกของเว็บ PBN ที่บทความจะขึ้น ใช้สร้างลิงก์บทความ", where: "เปิดเว็บแล้วคัดลอก URL จากแถบที่อยู่ เช่น https://www.example.com" },
];

const GITHUB: Item[] = [
  { field: "Deploy ด้วย", what: "บริการที่ build เว็บจาก repo", where: "ดูว่าเว็บผูกไว้กับ Vercel หรือ Cloudflare Pages (โดเมน .vercel.app / .pages.dev หรือจากหน้า Dashboard)" },
  { field: "GitHub owner / Repo", what: "เจ้าของ repo (user หรือ org) และชื่อ repo ที่เก็บโค้ดเว็บ", where: "เปิด repo บน GitHub แล้วคัดลอก URL มาวางในช่อง Repo ได้เลย เช่น github.com/my-org/pbn-site-1 ระบบแยก owner/repo ให้เอง" },
  { field: "Branch", what: "branch ที่ Vercel / Cloudflare ใช้ deploy production", where: "Vercel: Project → Settings → Git → Production Branch / Cloudflare Pages: Settings → Builds → Production branch (ส่วนใหญ่คือ main)" },
  { field: "โฟลเดอร์บทความ", what: "โฟลเดอร์ใน repo ที่เว็บอ่านไฟล์บทความ", where: "ดูใน repo ว่าบทความเดิมอยู่ที่ไหน เช่น content/blog หรือ src/content/posts" },
  { field: "ชนิดไฟล์", what: "รูปแบบไฟล์บทความที่เว็บรองรับ", where: "ดูนามสกุลไฟล์บทความเดิมใน repo (.md / .mdx / .html)" },
  { field: "โฟลเดอร์รูปปก / URL รูป", what: "ที่เก็บรูปปกใน repo และ path ที่ใช้เรียกรูปบนเว็บ", where: "ดูรูปของบทความเดิม เช่น เก็บที่ public/images/blog แล้วเรียกด้วย /images/blog — เว้นว่างโฟลเดอร์ = ไม่อัปรูป" },
  { field: "รูปแบบ URL บทความ", what: "โครงลิงก์ของบทความบนเว็บ ใช้ {siteUrl} และ {slug}", where: "เปิดบทความเดิมบนเว็บแล้วดูลิงก์ เช่น https://www.example.com/blog/ชื่อบทความ → {siteUrl}/blog/{slug}" },
  { field: "GitHub Token", what: "สิทธิ์ให้ระบบ commit ไฟล์บทความลง repo", where: "GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token → Repository access: เลือก repo นี้ → Permissions: Contents = Read and write" },
  { field: "Deploy Hook (ไม่บังคับ)", what: "ลิงก์สั่งให้เว็บ build ใหม่ ใช้เฉพาะเว็บที่ไม่ได้เปิด auto-deploy จาก git", where: "Vercel: Project → Settings → Git → Deploy Hooks → Create Hook / Cloudflare Pages: Settings → Builds → Deploy hooks → Add deploy hook" },
];

const WORDPRESS: Item[] = [
  { field: "WordPress URL", what: "ที่อยู่เว็บ WordPress (เว้นว่าง = ใช้ URL เว็บด้านบน)", where: "URL หน้าแรกของเว็บ ไม่ต้องใส่ /wp-admin" },
  { field: "WP Username", what: "ชื่อผู้ใช้ WordPress ที่มีสิทธิ์เขียนบทความ (Author ขึ้นไป)", where: "WP Admin → Users → ดูคอลัมน์ Username (ไม่ใช่อีเมลหรือชื่อที่แสดง)" },
  { field: "Application Password", what: "รหัสผ่านเฉพาะสำหรับเชื่อมต่อระบบภายนอก (ไม่ใช่รหัสผ่าน login)", where: "WP Admin → Users → Profile → Application Passwords → ตั้งชื่อ แล้วกด Add New Application Password → คัดลอกรหัส 24 ตัวอักษร" },
];

const REPORT: Item[] = [
  { field: "Report: Google Search Console", what: "property ของเว็บนี้ใน GSC ใช้ดึงคลิก/อิมเพรสชันในแท็บ Report", where: "search.google.com/search-console → เพิ่ม property ของเว็บ แล้วเพิ่มบัญชีบริการของระบบเป็นผู้ใช้ — จากนั้นเลือกจากรายการได้เลย" },
  { field: "Report: GA4 Property", what: "Property ID ของ Google Analytics 4 ใช้ดึงผู้เข้าชมในแท็บ Report", where: "GA4 → Admin → Property details → Property ID (ตัวเลข 9-10 หลัก) — ต้องเพิ่มบัญชีบริการของระบบใน Property access management ก่อน" },
];

function Section({ title, items }: { title: string; items: Item[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold text-brand-navy">{title}</p>
      <div className="space-y-1.5">
        {items.map(it => (
          <div key={it.field} className="text-[11px] leading-relaxed">
            <span className="font-semibold text-gray-700">{it.field}</span>
            <span className="text-gray-500"> — {it.what}</span>
            <p className="text-gray-400">ได้จาก: {it.where}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PbnSiteGuide({ platform }: { platform: "github" | "wordpress" }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-brand-mist/40 border border-brand-soft/60 rounded-lg p-3 space-y-3">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-1.5 text-left">
        <Info size={13} className="text-brand-blue shrink-0" />
        <span className="text-xs font-semibold text-brand-navy flex-1">แต่ละช่องคืออะไร และเอามาจากไหน</span>
        {open ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />}
      </button>
      {open && (
        <div className="space-y-3">
          <Section title="ข้อมูลเว็บ" items={COMMON} />
          {platform === "github"
            ? <Section title="GitHub (เว็บที่ deploy ด้วย Vercel / Cloudflare Pages)" items={GITHUB} />
            : <Section title="WordPress" items={WORDPRESS} />}
          <Section title="Report (ไม่บังคับ)" items={REPORT} />
        </div>
      )}
    </div>
  );
}
