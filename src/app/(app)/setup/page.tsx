import { Metadata } from "next";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import {
  CheckCircle2, XCircle, AlertCircle, ArrowRight, Key, Globe, Layers,
  BookOpen, FolderKanban, Zap, ExternalLink, Tag, Bot,
} from "lucide-react";

export const metadata: Metadata = { title: "Setup Guide — Mars" };

export default async function SetupPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const [wpConns, templates, prompts, projects] = await Promise.all([
    prisma.wordPressConnection.findMany({ where: { organizationId: orgId } }),
    prisma.brandTemplate.findMany({ where: { organizationId: orgId } }),
    prisma.promptTemplate.findMany({ where: { organizationId: orgId, isActive: true } }),
    prisma.project.findMany({ where: { organizationId: orgId }, include: { wordpressConnection: true } }),
  ]);

  const hasAnthropicKey   = !!(process.env.ANTHROPIC_API_KEY);
  const hasGtmPlatform    = !!(process.env.NEXT_PUBLIC_GTM_ID);
  const hasWpConn         = wpConns.length > 0;
  const hasTemplate       = templates.length > 0;
  const hasPrompts        = prompts.length >= 3;
  const hasProjects       = projects.length > 0;
  const projectsWithWp    = projects.filter((p) => !!p.wordpressConnectionId);
  const projectsWithCtx   = projects.filter((p) => !!(p as any).projectContext);
  const projectsWithGtm   = projects.filter((p) => !!(p as any).gtmContainerId);
  const allDone = hasAnthropicKey && hasWpConn && hasTemplate && hasPrompts && hasProjects;

  const checks = [
    {
      id: "api-key",
      icon: Key,
      title: "Claude AI API Key",
      description: "ตั้งค่า ANTHROPIC_API_KEY ใน .env.local เพื่อให้ AI ทำงานได้",
      status: hasAnthropicKey ? "ok" : "error",
      detail: hasAnthropicKey
        ? "ตั้งค่าแล้ว — AI พร้อมใช้งาน"
        : "ยังไม่ได้ตั้งค่า — เพิ่ม ANTHROPIC_API_KEY=\"sk-ant-...\" ใน .env.local",
      action: hasAnthropicKey
        ? null
        : { label: "Anthropic Console", href: "https://console.anthropic.com", external: true },
    },
    {
      id: "projects",
      icon: FolderKanban,
      title: "โปรเจกต์ลูกค้า",
      description: "สร้างโปรเจกต์อย่างน้อย 1 โปรเจกต์สำหรับแต่ละลูกค้า",
      status: hasProjects ? "ok" : "warn",
      detail: hasProjects ? `มี ${projects.length} โปรเจกต์` : "ยังไม่มีโปรเจกต์",
      action: hasProjects ? null : { label: "สร้างโปรเจกต์แรก", href: "/dashboard", external: false },
    },
    {
      id: "project-context",
      icon: Bot,
      title: "Project Context (AI System Prompt)",
      description: "ใส่ข้อมูล brand ลูกค้าใน Project Settings ให้ AI เขียนบทความได้ตรงจุด",
      status: projectsWithCtx.length === projects.length && projects.length > 0 ? "ok" : "warn",
      detail: projectsWithCtx.length > 0
        ? `${projectsWithCtx.length}/${projects.length} โปรเจกต์มี Context แล้ว`
        : "ยังไม่มีโปรเจกต์ที่ตั้งค่า Context — ไปที่ Project → Settings",
      action: { label: "ตั้งค่า Project Context", href: "/dashboard", external: false },
    },
    {
      id: "wordpress",
      icon: Globe,
      title: "WordPress Connection",
      description: "เชื่อม WordPress ของลูกค้าเพื่อ Auto-publish Draft บทความ",
      status: hasWpConn ? "ok" : "warn",
      detail: hasWpConn
        ? `เชื่อมต่อแล้ว ${wpConns.length} site (${projectsWithWp.length}/${projects.length} โปรเจกต์)`
        : "ยังไม่ได้เชื่อม — กด Connect WordPress ในหน้า Settings",
      action: { label: "Website Connect", href: "/website-connect", external: false },
    },
    {
      id: "brand-template",
      icon: Layers,
      title: "Brand Template",
      description: "สร้าง Brand Template ให้ AI รู้จักโทนเสียง, CTA, และ HTML structure ของแต่ละลูกค้า",
      status: hasTemplate ? "ok" : "warn",
      detail: hasTemplate ? `มี ${templates.length} template` : "ยังไม่มี Brand Template",
      action: hasTemplate ? null : { label: "สร้าง Template", href: "/templates", external: false },
    },
    {
      id: "prompts",
      icon: BookOpen,
      title: "Prompt Templates",
      description: "เปิดใช้งาน Prompt ทั้ง 7 ประเภทให้ครบ: Keyword, ContentMap, Outline, Article, SEO, Image, WordPress",
      status: hasPrompts ? "ok" : "warn",
      detail: hasPrompts
        ? `มี ${prompts.length} prompt ที่ active`
        : `มีแค่ ${prompts.length} prompt ที่ active — เปิดใช้งานให้ครบ`,
      action: { label: "จัดการ Prompts", href: "/prompts", external: false },
    },
    {
      id: "gtm",
      icon: Tag,
      title: "Google Tag Manager (GTM)",
      description: "เชื่อม GTM เพื่อติด tracking event บน Mars platform และบนบทความที่ publish ไป WordPress",
      status: hasGtmPlatform ? "ok" : "warn",
      detail: hasGtmPlatform
        ? `Platform GTM: ${process.env.NEXT_PUBLIC_GTM_ID} · Per-project GTM: ${projectsWithGtm.length}/${projects.length} โปรเจกต์`
        : `ยังไม่ได้ตั้งค่า · Per-project GTM: ${projectsWithGtm.length}/${projects.length} โปรเจกต์`,
      action: { label: "วิธีตั้งค่า GTM ↓", href: "#gtm-guide", external: false },
    },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-16">

      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-green-950 to-slate-900 text-white px-8 py-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
            <Zap className="h-6 w-6 text-green-400" />
          </div>
          <div>
            <p className="text-green-400 text-xs font-semibold uppercase tracking-wide">Mars · Setup Guide</p>
            <h1 className="text-2xl font-bold">ตั้งค่าก่อนใช้งานจริง</h1>
          </div>
        </div>
        <p className="text-slate-300 text-sm leading-relaxed">
          ทำตามขั้นตอนด้านล่างเพื่อเชื่อมต่อระบบทั้งหมดก่อนเริ่ม workflow จริง
        </p>
        {allDone && (
          <div className="mt-4 flex items-center gap-2 px-4 py-2.5 bg-green-500/20 border border-green-500/30 rounded-xl text-green-300 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4" />
            ครบทุกขั้นตอนแล้ว — พร้อมใช้งาน!
          </div>
        )}
      </div>

      {/* Checklist */}
      <div className="space-y-3">
        {checks.map((item, i) => {
          const Icon = item.icon;
          const isOk = item.status === "ok";
          const isErr = item.status === "error";
          return (
            <div
              key={item.id}
              className={`bg-white rounded-2xl border p-5 flex gap-4 items-start ${
                isErr ? "border-red-200" : isOk ? "border-green-200" : "border-amber-200"
              }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                isOk ? "bg-green-50" : isErr ? "bg-red-50" : "bg-amber-50"
              }`}>
                <Icon className={`h-5 w-5 ${isOk ? "text-green-600" : isErr ? "text-red-600" : "text-amber-600"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-gray-400 font-medium">ขั้นตอนที่ {i + 1}</span>
                  {isOk
                    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                    : isErr
                    ? <XCircle className="h-4 w-4 text-red-500" />
                    : <AlertCircle className="h-4 w-4 text-amber-500" />
                  }
                </div>
                <p className="font-semibold text-gray-900">{item.title}</p>
                <p className="text-sm text-gray-500 mt-0.5">{item.description}</p>
                <p className={`text-xs mt-2 font-medium ${isOk ? "text-green-600" : isErr ? "text-red-600" : "text-amber-600"}`}>
                  {item.detail}
                </p>
                {item.action && (
                  <div className="mt-3">
                    {item.action.external ? (
                      <a
                        href={item.action.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
                      >
                        {item.action.label}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : (
                      <Link
                        href={item.action.href}
                        className="inline-flex items-center gap-1.5 text-sm text-green-600 hover:text-green-700 font-semibold"
                      >
                        {item.action.label}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* WordPress How-to */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Globe className="h-5 w-5 text-blue-600" />
          วิธีเชื่อม WordPress
        </h2>
        <ol className="space-y-4 text-sm text-gray-700">
          {[
            { step: "1", title: "เปิด WordPress Admin", desc: "เข้า wp-admin ของเว็บไซต์ลูกค้า" },
            { step: "2", title: "สร้าง Application Password", desc: "ไปที่ Users → Profile → Application Passwords → ตั้งชื่อ \"Mars\" แล้วกด Add" },
            { step: "3", title: "Copy Password ที่ได้", desc: "WordPress จะแสดง Application Password ครั้งเดียว ให้ Copy เก็บไว้ก่อน" },
            { step: "4", title: "เพิ่มใน Settings", desc: "ไปที่ Settings → WordPress → กด Connect New Site → ใส่ Site URL, Username, Application Password" },
            { step: "5", title: "เชื่อม Project", desc: "เข้า Project → Settings → เลือก WordPress Connection ที่สร้าง" },
          ].map((item) => (
            <li key={item.step} className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                {item.step}
              </div>
              <div>
                <p className="font-semibold text-gray-900">{item.title}</p>
                <p className="text-gray-500 mt-0.5">{item.desc}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-5 p-4 bg-blue-50 rounded-xl text-sm text-blue-800 border border-blue-100">
          <strong>หมายเหตุ:</strong> WordPress REST API ต้องเปิดใช้งาน (เปิดอยู่ by default) และ User ต้องมีสิทธิ์{" "}
          <code className="bg-blue-100 px-1 rounded">editor</code> หรือสูงกว่า
        </div>
      </div>

      {/* GTM How-to */}
      <div id="gtm-guide" className="bg-white rounded-2xl border border-gray-100 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-1 flex items-center gap-2">
          <Tag className="h-5 w-5 text-amber-500" />
          วิธีตั้งค่า GTM + GA4
        </h2>
        <p className="text-sm text-gray-500 mb-5">มี 2 ระดับ: Platform-level (ติด Mars app เอง) และ Per-project (ติดไปกับบทความที่ส่ง WordPress)</p>

        <div className="space-y-6">
          <div>
            <p className="text-sm font-bold text-gray-800 mb-3">🌐 ระดับ Platform — ติด tracking ใน Mars เอง</p>
            <ol className="space-y-3 text-sm text-gray-700">
              {[
                { step: "1", title: "เปิด Google Tag Manager", desc: "สร้าง Container ใหม่สำหรับ Mars platform" },
                { step: "2", title: "Copy Container ID", desc: "รูปแบบ GTM-XXXXXXX อยู่ที่มุมบนขวาของ GTM" },
                { step: "3", title: "เพิ่มใน .env.local", desc: "NEXT_PUBLIC_GTM_ID=\"GTM-XXXXXXX\" แล้ว restart dev server" },
                { step: "4", title: "สร้าง Tag GA4 ใน GTM", desc: "เพิ่ม Tag ประเภท Google Analytics: GA4 Configuration → ใส่ Measurement ID (G-XXXXXXXXXX)" },
              ].map((item) => (
                <li key={item.step} className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {item.step}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{item.title}</p>
                    <p className="text-gray-500 mt-0.5">{item.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="border-t pt-5">
            <p className="text-sm font-bold text-gray-800 mb-3">📄 ระดับ Per-project — ติด tracking ในบทความที่ส่ง WordPress</p>
            <ol className="space-y-3 text-sm text-gray-700">
              {[
                { step: "1", title: "เปิด Project → Settings", desc: "ไปที่โปรเจกต์ของลูกค้า → กด ⚙️ ตั้งค่าโปรเจกต์" },
                { step: "2", title: "ใส่ GTM Container ID", desc: "ใส่ Container ID ของลูกค้า เช่น GTM-XXXXXXX แล้วกด Save" },
                { step: "3", title: "Mars inject อัตโนมัติ", desc: "เมื่อ publish บทความไป WordPress Mars จะ inject GTM snippet ใน <head> ของ HTML อัตโนมัติ" },
              ].map((item) => (
                <li key={item.step} className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {item.step}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{item.title}</p>
                    <p className="text-gray-500 mt-0.5">{item.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-4 p-4 bg-amber-50 rounded-xl text-sm text-amber-800 border border-amber-100">
              <strong>Tip:</strong> ใน GTM ให้สร้าง Tag GA4 Event สำหรับ <code className="bg-amber-100 px-1 rounded">article_view</code> เพื่อ track บทความแต่ละชิ้นได้
            </div>
          </div>
        </div>
      </div>

      {/* Per-project status table */}
      {projects.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">สถานะการตั้งค่าต่อโปรเจกต์</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-gray-400 uppercase tracking-wide">
                  <th className="text-left py-2 font-semibold">โปรเจกต์</th>
                  <th className="text-center py-2 font-semibold">Context</th>
                  <th className="text-center py-2 font-semibold">WordPress</th>
                  <th className="text-center py-2 font-semibold">GTM</th>
                  <th className="text-center py-2 font-semibold">Auto Mode</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {projects.map((project) => {
                  const p = project as any;
                  return (
                    <tr key={project.id} className="hover:bg-gray-50/60">
                      <td className="py-3">
                        <p className="font-semibold text-gray-900">{project.name}</p>
                        <p className="text-xs text-gray-400">{project.website}</p>
                      </td>
                      <td className="text-center py-3">
                        {p.projectContext
                          ? <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                          : <XCircle className="h-4 w-4 text-gray-300 mx-auto" />}
                      </td>
                      <td className="text-center py-3">
                        {project.wordpressConnection
                          ? <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                          : <XCircle className="h-4 w-4 text-gray-300 mx-auto" />}
                      </td>
                      <td className="text-center py-3">
                        {p.gtmContainerId
                          ? <span className="text-xs font-mono bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">{p.gtmContainerId}</span>
                          : <XCircle className="h-4 w-4 text-gray-300 mx-auto" />}
                      </td>
                      <td className="text-center py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          p.automationMode === "FULL_AUTO" ? "bg-green-100 text-green-700" :
                          p.automationMode === "SEMI_AUTO" ? "bg-amber-100 text-amber-700" :
                          "bg-gray-100 text-gray-500"
                        }`}>
                          {p.automationMode ?? "MANUAL"}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <Link
                          href={`/projects/${project.id}/settings`}
                          className="text-xs text-green-600 hover:text-green-700 font-medium"
                        >
                          ตั้งค่า →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Settings", href: "/settings", icon: "⚙️" },
          { label: "Brand Templates", href: "/templates", icon: "🎨" },
          { label: "Prompt Library", href: "/prompts", icon: "📝" },
          { label: "Projects", href: "/dashboard", icon: "📁" },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex flex-col items-center gap-2 p-4 bg-white border border-gray-100 rounded-2xl hover:border-green-200 hover:shadow-sm transition-all text-center"
          >
            <span className="text-2xl">{link.icon}</span>
            <span className="text-xs font-semibold text-gray-600">{link.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
