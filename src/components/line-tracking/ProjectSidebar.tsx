'use client'

// Left sidebar scoped to ONE Line Tracking project, including the Settings sub-pages.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { BarChart3, Users, Filter, Settings, ChevronDown, ChevronRight, ArrowLeft, Pencil, Home } from 'lucide-react'
import { isConvertCakeProject } from '@/lib/line-tracking/services/convertCakeSheetPlan'

export default function ProjectSidebar({
  projectId,
  projectName,
}: {
  projectId: string
  projectName: string
}) {
  const pathname = usePathname()
  const base = `/line-tracking/projects/${projectId}`
  const [settingsOpen, setSettingsOpen] = useState(true)

  const main = [
    { href: base, label: 'ภาพรวม (Overview)', icon: BarChart3 },
    { href: `${base}/leads`, label: 'Leads CRM', icon: Users },
    { href: `${base}/funnel`, label: 'Marketing Funnel', icon: Filter },
  ]
  const settingsSub = [
    // Rename form lives on /settings; exact-match active (below) keeps it from lighting up
    // on /settings/conversion-mapping etc.
    { href: `${base}/settings`, label: 'ชื่อโปรเจกต์' },
    { href: `${base}/setup`, label: 'ตั้งค่า / เชื่อมต่อ' },
    { href: `${base}/tracking-links`, label: 'Tracking Links' },
    { href: `${base}/conversions`, label: 'Conversions' },
    { href: `${base}/sheet`, label: 'Google Sheet' },
    // สองอันนี้เคยหายาก (ซ่อนอยู่หลัง Setup Wizard) — ย้ายมาอยู่กับเพื่อนในเมนูนี้
    { href: `${base}/settings/conversion-mapping`, label: 'Conversion Mapping' },
    { href: `${base}/settings/lead-changes`, label: 'ประวัติการแก้ไข Lead' },
    // Convert Cake only: status sync from its own lead sheet
    ...(isConvertCakeProject({ name: projectName })
      ? [{ href: `${base}/settings/sheet-status-sync`, label: 'ซิงก์สถานะจากชีท' }]
      : []),
  ]

  // min-h keeps tap targets >= 40px on the horizontal strip (below lg); lg is unchanged.
  const linkCls = (active: boolean) =>
    `flex min-h-[2.5rem] items-center gap-2 rounded-lg px-3 py-2 text-sm transition lg:min-h-0 ${
      active ? 'bg-brand-blue/10 font-medium text-brand-blue' : 'text-gray-600 hover:bg-gray-100'
    }`

  return (
    <aside className="card w-full shrink-0 overflow-hidden lg:sticky lg:top-4 lg:w-56 lg:self-start">
      {/* Below lg: back link, caption and main links form one horizontally scrolling strip.
          At lg and up the row is a plain block, i.e. the same vertical card as before. */}
      <div className="flex items-stretch overflow-x-auto lg:block lg:overflow-visible">
        {/* Back to the LINE Tracking home (dashboard) */}
        <Link
          href="/line-tracking"
          className="flex min-h-[2.5rem] shrink-0 items-center gap-1.5 whitespace-nowrap border-r border-gray-100 px-4 py-2.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 lg:min-h-0 lg:border-b lg:border-r-0"
        >
          <Home className="h-3.5 w-3.5" /> หน้าแรก LINE Tracking
        </Link>
        {/* Back to all projects */}
        <Link
          href="/line-tracking/projects"
          className="flex min-h-[2.5rem] shrink-0 items-center gap-1.5 whitespace-nowrap border-r border-gray-100 px-4 py-2.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 lg:min-h-0 lg:border-b lg:border-r-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> โปรเจกต์ทั้งหมด
        </Link>
        {/* Caption with the rename pencil. */}
        <div className="flex shrink-0 items-center border-r border-gray-100 px-4 py-3 lg:block lg:border-b lg:border-r-0">
          <div className="flex items-center gap-1.5">
            <div
              title={projectName}
              className="max-w-[10rem] truncate text-[11px] font-semibold uppercase tracking-wide text-gray-400 lg:min-w-0 lg:max-w-none lg:flex-1 lg:overflow-visible lg:whitespace-normal lg:text-clip"
            >
              {projectName}
            </div>
            <Link
              href={`${base}/settings#project-name`}
              title="แก้ชื่อโปรเจกต์"
              aria-label="แก้ชื่อโปรเจกต์"
              className="-m-2 shrink-0 rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-brand-blue"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
        <nav className="flex shrink-0 gap-1 p-1 lg:block lg:space-y-1 lg:p-2">
          {main.map((m) => {
            const active = pathname === m.href
            return (
              <Link key={m.href} href={m.href} className={linkCls(active) + ' shrink-0 whitespace-nowrap'}>
                <m.icon className="h-4 w-4 shrink-0" />
                {m.label}
              </Link>
            )
          })}

          {/* Settings toggle */}
          <div className="shrink-0 lg:pt-1">
            <button
              onClick={() => setSettingsOpen((o) => !o)}
              className="flex min-h-[2.5rem] w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 lg:min-h-0"
            >
              <Settings className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">Settings</span>
              {settingsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
        </nav>
      </div>

      {/* Settings sub-links. Below lg they wrap in a row under the strip;
          at lg they are the same indented vertical list as before (ml-6 = p-2 + ml-4). */}
      {settingsOpen && (
        <div className="flex flex-wrap gap-1 border-t border-gray-100 p-1 lg:ml-6 lg:mb-2 lg:mr-2 lg:block lg:space-y-0.5 lg:border-l lg:border-t-0 lg:p-0 lg:pl-2">
          {settingsSub.map((s) => {
            const active = pathname === s.href
            return (
              <Link key={s.href} href={s.href} className={linkCls(active) + ' whitespace-nowrap text-[13px] lg:whitespace-normal'}>
                {s.label}
              </Link>
            )
          })}
        </div>
      )}
    </aside>
  )
}
