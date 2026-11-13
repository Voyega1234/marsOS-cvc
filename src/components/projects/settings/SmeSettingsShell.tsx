'use client'

/**
 * Project Settings (SEO SME) — เมนูแนวตั้งด้านซ้าย หน้าตาเดียวกับ Project Setting ของ Upload Article
 * มือถือ: แถบเลื่อนแนวนอน / จอใหญ่: เมนูซ้าย + เนื้อหาขวา
 * เป็นแค่เปลือก UI — ทุกหน้าใช้ component เดิมด้วย props เดิม (ไม่เปลี่ยน save path / request body / ผลบทความ)
 */
import { useEffect, useState } from 'react'
import {
  BarChart2, BookOpen, ClipboardCheck, Cpu, FileText, Globe, Image as ImageIcon, Link2, Megaphone, Palette, Sparkles, UserRound,
} from 'lucide-react'
import { ProjectContentEngine } from '@/components/projects/workspace/ProjectContentEngine'
import { ReportConnectPanel } from '@/components/report/ReportConnectPanel'
import { ProjectWebsitePanel } from '@/components/projects/ProjectWebsitePanel'
import { ProjectSetupChecklist } from '@/components/projects/ProjectSetupChecklist'
import { SmeLabTab } from '@/components/projects/settings/SmeLabTab'
import { isSmeLabSection, type SmeLabSection, type SmeSettingsSection } from '@/components/projects/settings/sme-settings-sections'
import type { ProjectData, KeywordRow } from '@/components/projects/sme-types'

const SECTIONS: { id: SmeSettingsSection; label: string; icon: typeof Globe }[] = [
  { id: 'checklist', label: 'Checklist', icon: ClipboardCheck },
  { id: 'website', label: 'Website', icon: Globe },
  { id: 'google', label: 'GSC · GA4', icon: BarChart2 },
  { id: 'style', label: 'Article Style', icon: Palette },
  { id: 'business', label: 'Business & Style Guide', icon: BookOpen },
  { id: 'links', label: 'Internal Link', icon: Link2 },
  { id: 'images', label: 'Images', icon: ImageIcon },
  { id: 'cta', label: 'CTA', icon: Megaphone },
  { id: 'author', label: 'Author Box', icon: UserRound },
  { id: 'test-article', label: 'Test Article', icon: FileText },
  { id: 'test-image', label: 'Test Image', icon: Sparkles },
  { id: 'engine', label: 'Content Engine', icon: Cpu },
]

type ChecklistProps = React.ComponentProps<typeof ProjectSetupChecklist>

export default function SmeSettingsShell({
  project, userRole, section, onSectionChange, checklistMissing = 0, justCreatedSetup,
  onChecklistNavigate, onChecklistStatus, onLabSaved, keywordRows,
}: {
  project: ProjectData
  userRole: string
  section: SmeSettingsSection
  onSectionChange: (s: SmeSettingsSection) => void
  /** จำนวนข้อบังคับที่ยังไม่ครบ (ตัวเดียวกับ badge บนฟันเฟือง) */
  checklistMissing?: number
  justCreatedSetup: boolean
  onChecklistNavigate: ChecklistProps['onNavigate']
  onChecklistStatus: ChecklistProps['onStatus']
  onLabSaved: (updated: Partial<ProjectData>) => void
  keywordRows: KeywordRow[]
}) {
  const labActive = isSmeLabSection(section)
  // mount SmeLabTab ตอนเข้าหน้าของ Lab ครั้งแรก แล้วคงไว้ (ซ่อนด้วย hidden) — ร่างที่ยังไม่บันทึกไม่หายตอนสลับเมนู
  // lastLabSection = หน้า Lab ล่าสุดที่เปิด — ตอนซ่อนยังส่งค่านี้ต่อให้ SmeLabTab (ไม่ให้เด้งกลับไปโหมด sub-tab เดิม)
  const [lastLabSection, setLastLabSection] = useState<SmeLabSection | null>(isSmeLabSection(section) ? section : null)
  useEffect(() => { if (isSmeLabSection(section)) setLastLabSection(section) }, [section])
  const labSection: SmeLabSection | null = isSmeLabSection(section) ? section : lastLabSection

  return (
    <div className="flex flex-col md:flex-row gap-4">
      {/* มือถือ: แถบเลื่อนแนวนอน */}
      <div className="md:hidden -mx-1 px-1 overflow-x-auto">
        <div className="flex gap-1.5 pb-1 w-max">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => onSectionChange(s.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-colors ${
                section === s.id ? 'bg-brand-navy text-white border-brand-navy' : 'bg-white/70 text-gray-600 border-white/80 hover:bg-white'
              }`}>
              <s.icon size={13} /> {s.label}
              {s.id === 'checklist' && checklistMissing > 0 && <MissingBadge n={checklistMissing} />}
            </button>
          ))}
        </div>
      </div>

      {/* จอใหญ่: เมนูแนวตั้งด้านซ้าย */}
      <div className="hidden md:block w-52 shrink-0">
        <div className="space-y-1 sticky top-[4.5rem] rounded-3xl border border-white/80 bg-white/70 backdrop-blur p-2 shadow-sm">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => onSectionChange(s.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium text-left transition-colors ${
                section === s.id ? 'bg-brand-navy text-white shadow-sm' : 'text-gray-600 hover:bg-white/80 hover:text-brand-navy'
              }`}>
              <s.icon size={15} /> <span className="flex-1">{s.label}</span>
              {s.id === 'checklist' && checklistMissing > 0 && <MissingBadge n={checklistMissing} />}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        {section === 'checklist' && (
          <div className="max-w-3xl space-y-3">
            <div>
              <h3 className="section-label !text-brand-navy">Setup Checklist</h3>
              <p className="mt-0.5 text-xs text-gray-400">
                ความพร้อมก่อนเริ่มงานกับลูกค้า — เช็คจากข้อมูลจริงทุกข้อ กดปุ่มเพื่อไปตั้งค่าจุดที่ยังขาด
              </p>
            </div>
            {justCreatedSetup && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-600">
                ตั้งค่าให้ครบก่อนเริ่มใช้งาน — รายการสีแดงคือยังไม่เสร็จ
              </div>
            )}
            <ProjectSetupChecklist
              projectId={project.id}
              onNavigate={onChecklistNavigate}
              onStatus={onChecklistStatus}
            />
          </div>
        )}
        {section === 'website' && (
          <div className="max-w-3xl space-y-3">
            <div>
              <h3 className="section-label !text-brand-navy">Connect Website</h3>
              <p className="mt-0.5 text-xs text-gray-400">
                ผูกเว็บไซต์ของ client นี้ — แต่ละโปรเจกต์เชื่อมคนละเว็บ รองรับทุกแพลตฟอร์ม (WordPress push อัตโนมัติได้)
              </p>
            </div>
            <ProjectWebsitePanel projectId={project.id} />
          </div>
        )}
        {section === 'google' && (
          <div className="max-w-3xl space-y-3">
            <div>
              <h3 className="section-label !text-brand-navy">เชื่อมต่อข้อมูล Google (GSC / GA4)</h3>
              <p className="mt-0.5 text-xs text-gray-400">
                Service Email ระดับระบบ + ผูก property ของ client นี้ — ใช้กับหน้า Report และ Content Refresh
              </p>
            </div>
            <ReportConnectPanel
              projectId={project.id}
              gscSiteUrl={project.gscSiteUrl ?? null}
              ga4PropertyId={project.ga4PropertyId ?? null}
              isAdmin={userRole === 'ADMIN'}
              returnTo={`/projects/${project.id}?tab=report`}
              onSaved={() => window.location.reload()}
            />
          </div>
        )}
        {section === 'engine' && (
          <ProjectContentEngine projectId={project.id} userRole={userRole} />
        )}
        {labSection && (
          <div className={labActive ? '' : 'hidden'}>
            <SmeLabTab
              project={project}
              onSaved={onLabSaved}
              keywordRows={keywordRows}
              section={labSection}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function MissingBadge({ n }: { n: number }) {
  return (
    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-[18px] text-center">
      {n}
    </span>
  )
}
