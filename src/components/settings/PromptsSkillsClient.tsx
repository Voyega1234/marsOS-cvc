'use client'

import { useState } from 'react'
import { FileText, ChevronDown, ChevronRight, RotateCcw, Save, Users, BookOpen, Image, Mail, Share2, Star, Lock, Unlock, Eye, EyeOff, ShieldAlert, Zap, Tag, Layers } from 'lucide-react'
import { toast } from 'sonner'

interface SystemPrompt {
  key: string
  file: string
  name: string
  category: string
  description: string
  usedIn?: string[]
  affectsNote?: string
  content: string
}

interface SystemSkill {
  key: string
  file: string
  name: string
  description: string
  usedIn: string[]
  affectsNote?: string
  page: string
  content: string
}

interface CodeSkill {
  key: string
  name: string
  description: string
  usedIn: string[]
  page: string
  file: string
}

interface Project {
  id: string
  name: string
  clientName: string | null
  overrides: Record<string, string>
}

interface Props {
  systemPrompts: SystemPrompt[]
  systemSkills: SystemSkill[]
  codeSkills: CodeSkill[]
  studioPromptKeys: string[]
  studioOverrides: Record<string, string>
  projects: Project[]
}

const CATEGORIES: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  article: { label: 'เขียนบทความ', icon: <BookOpen size={14} />, color: 'bg-blue-50 text-blue-700 border-blue-200' },
  image:   { label: 'รูปภาพ',      icon: <Image size={14} />,    color: 'bg-purple-50 text-purple-700 border-purple-200' },
  page:    { label: 'หน้า Landing', icon: <FileText size={14} />, color: 'bg-green-50 text-green-700 border-green-200' },
  email:   { label: 'Email',        icon: <Mail size={14} />,     color: 'bg-orange-50 text-orange-700 border-orange-200' },
  social:  { label: 'Social',       icon: <Share2 size={14} />,   color: 'bg-pink-50 text-pink-700 border-pink-200' },
}

const PAGE_LABELS: Record<string, string> = {
  article: 'Content Studio / บทความ',
  image: 'Image Studio',
  keyword: 'Keyword Research',
}

export function PromptsSkillsClient({ systemPrompts, systemSkills, codeSkills, studioPromptKeys, studioOverrides: initialStudioOverrides, projects }: Props) {
  const [tab, setTab] = useState<'system' | 'skills' | 'client' | 'studio'>('system')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  // System lock state — requires password to unlock
  const [systemUnlocked, setSystemUnlocked] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [verifying, setVerifying] = useState(false)

  // Client tab state
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projects[0]?.id ?? '')
  const [projectOverrides, setProjectOverrides] = useState<Record<string, Record<string, string>>>(
    Object.fromEntries(projects.map(p => [p.id, p.overrides]))
  )
  const [clientExpandedKey, setClientExpandedKey] = useState<string | null>(null)
  // Per-prompt lock for client tab
  const [clientUnlocked, setClientUnlocked] = useState<Record<string, boolean>>({})

  const selectedProject = projects.find(p => p.id === selectedProjectId)
  const currentOverrides = projectOverrides[selectedProjectId] ?? {}

  const getSystemContent = (key: string) =>
    key in editValues ? editValues[key] : (systemPrompts.find(p => p.key === key)?.content ?? '')

  const getClientContent = (key: string) => {
    const editKey = `${selectedProjectId}:${key}`
    return editKey in editValues ? editValues[editKey] : (currentOverrides[key] ?? '')
  }

  // Verify password via API
  const verifyPassword = async () => {
    if (!passwordInput.trim()) { setPasswordError('กรุณาใส่รหัสผ่าน'); return }
    setVerifying(true)
    setPasswordError('')
    try {
      const res = await fetch('/api/settings/prompts/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      })
      if (res.ok) {
        setSystemUnlocked(true)
        setShowPasswordModal(false)
        setPasswordInput('')
        toast.success('ปลดล็อก System Prompts แล้ว')
      } else {
        setPasswordError('รหัสผ่านไม่ถูกต้อง')
      }
    } catch {
      setPasswordError('เชื่อมต่อไม่ได้ กรุณาลองใหม่')
    } finally {
      setVerifying(false)
    }
  }

  const lockSystem = () => {
    setSystemUnlocked(false)
    setExpandedKey(null)
    setEditValues({})
  }

  const saveSystem = async (key: string) => {
    setSaving(key)
    try {
      const res = await fetch('/api/settings/prompts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'system', key, content: getSystemContent(key) }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('บันทึก system prompt แล้ว')
      const newEdit = { ...editValues }
      delete newEdit[key]
      setEditValues(newEdit)
    } catch {
      toast.error('บันทึกไม่สำเร็จ')
    } finally {
      setSaving(null)
    }
  }

  const saveClient = async (key: string, content: string | null) => {
    const savingKey = `${selectedProjectId}:${key}`
    setSaving(savingKey)
    try {
      const res = await fetch('/api/settings/prompts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'project', key, content, projectId: selectedProjectId }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success(content === null ? 'รีเซ็ตเป็น default แล้ว' : 'บันทึก prompt สำหรับ client แล้ว')
      const newOverrides = { ...currentOverrides }
      if (content === null || content === '') { delete newOverrides[key] } else { newOverrides[key] = content }
      setProjectOverrides(prev => ({ ...prev, [selectedProjectId]: newOverrides }))
      const newEdit = { ...editValues }
      delete newEdit[savingKey]
      setEditValues(newEdit)
      // Re-lock after save
      setClientUnlocked(prev => { const n = { ...prev }; delete n[savingKey]; return n })
    } catch {
      toast.error('บันทึกไม่สำเร็จ')
    } finally {
      setSaving(null)
    }
  }

  const groupedPrompts = systemPrompts.reduce((acc, p) => {
    if (!acc[p.category]) acc[p.category] = []
    acc[p.category].push(p)
    return acc
  }, {} as Record<string, SystemPrompt[]>)

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Password modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <ShieldAlert size={20} className="text-amber-500" />
              <h3 className="text-base font-bold text-gray-900">ยืนยันตัวตน</h3>
            </div>
            <p className="text-sm text-gray-500">ใส่รหัสผ่าน login ของคุณเพื่อปลดล็อก System Prompts</p>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={passwordInput}
                onChange={e => { setPasswordInput(e.target.value); setPasswordError('') }}
                onKeyDown={e => e.key === 'Enter' && verifyPassword()}
                autoFocus
                placeholder="รหัสผ่าน"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {passwordError && <p className="text-xs text-red-500">{passwordError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowPasswordModal(false); setPasswordInput(''); setPasswordError('') }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                ยกเลิก
              </button>
              <button
                onClick={verifyPassword}
                disabled={verifying}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
              >
                {verifying ? 'กำลังตรวจสอบ...' : 'ปลดล็อก'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Prompts & Skills</h1>
          <p className="text-sm text-gray-500 mt-0.5">จัดการ prompt ที่ระบบใช้ในการเขียนบทความและสร้าง content</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {([
          { key: 'system', label: 'System Prompts', icon: <Star size={13} /> },
          { key: 'skills', label: 'Skills', icon: <Zap size={13} /> },
          { key: 'client', label: 'Per Client', icon: <Users size={13} /> },
          { key: 'studio', label: 'Studio', icon: <Layers size={13} /> },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ── System Prompts Tab ── */}
      {tab === 'system' && (
        <div className="space-y-5">
          {/* Lock bar */}
          <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${systemUnlocked ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center gap-2 text-sm">
              {systemUnlocked
                ? <><Unlock size={15} className="text-amber-500" /><span className="font-medium text-amber-700">ปลดล็อกแล้ว — แก้ไข System Prompts ได้</span></>
                : <><Lock size={15} className="text-gray-400" /><span className="text-gray-500">System Prompts ถูกล็อกไว้ — ต้องใส่รหัสผ่านก่อนแก้ไข</span></>
              }
            </div>
            <button
              onClick={() => systemUnlocked ? lockSystem() : setShowPasswordModal(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                systemUnlocked
                  ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                  : 'bg-gray-900 text-white hover:bg-gray-700'
              }`}
            >
              {systemUnlocked ? <><Lock size={12} />ล็อกอีกครั้ง</> : <><Unlock size={12} />ปลดล็อก</>}
            </button>
          </div>

          {Object.entries(CATEGORIES).map(([catKey, cat]) => {
            const prompts = groupedPrompts[catKey] ?? []
            if (!prompts.length) return null
            return (
              <div key={catKey}>
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border mb-3 ${cat.color}`}>
                  {cat.icon}{cat.label}
                </div>
                <div className="space-y-2">
                  {prompts.map(p => {
                    const isOpen = expandedKey === p.key
                    const isDirty = p.key in editValues
                    return (
                      <div key={p.key} className="border border-gray-200 rounded-xl overflow-hidden">
                        <button
                          onClick={() => setExpandedKey(isOpen ? null : p.key)}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center gap-3 text-left">
                            <FileText size={15} className="text-gray-400 shrink-0" />
                            <div>
                              <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                {p.name}
                                {!systemUnlocked && <Lock size={11} className="text-gray-300" />}
                                {isDirty && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">ยังไม่บันทึก</span>}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">{p.description}</div>
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                {p.usedIn?.map(u => (
                                  <span key={u} className="inline-flex items-center gap-0.5 text-[10px] bg-gray-100 text-gray-500 border border-gray-200 px-1.5 py-0.5 rounded-full">
                                    <Tag size={9} />{u}
                                  </span>
                                ))}
                                {p.affectsNote && (
                                  <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                    ⚡ {p.affectsNote}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          {isOpen ? <ChevronDown size={15} className="text-gray-400 shrink-0" /> : <ChevronRight size={15} className="text-gray-400 shrink-0" />}
                        </button>
                        {isOpen && (
                          <div className="border-t border-gray-100 p-4 space-y-3">
                            <textarea
                              value={getSystemContent(p.key)}
                              onChange={e => systemUnlocked && setEditValues(prev => ({ ...prev, [p.key]: e.target.value }))}
                              readOnly={!systemUnlocked}
                              rows={18}
                              className={`w-full text-xs font-mono border border-gray-200 rounded-lg p-3 resize-y focus:outline-none ${
                                systemUnlocked
                                  ? 'bg-white focus:ring-2 focus:ring-gray-900'
                                  : 'bg-gray-50 text-gray-400 cursor-not-allowed select-none'
                              }`}
                            />
                            {systemUnlocked && (
                              <div className="flex justify-end gap-2">
                                {isDirty && (
                                  <button
                                    onClick={() => setEditValues(prev => { const n = { ...prev }; delete n[p.key]; return n })}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                                  >
                                    <RotateCcw size={12} />ยกเลิก
                                  </button>
                                )}
                                <button
                                  onClick={() => saveSystem(p.key)}
                                  disabled={saving === p.key || !isDirty}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40"
                                >
                                  <Save size={12} />{saving === p.key ? 'กำลังบันทึก...' : 'บันทึก'}
                                </button>
                              </div>
                            )}
                            {!systemUnlocked && (
                              <div className="flex justify-center">
                                <button
                                  onClick={() => setShowPasswordModal(true)}
                                  className="flex items-center gap-1.5 px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                                >
                                  <Unlock size={12} />ปลดล็อกเพื่อแก้ไข
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Skills Tab ── */}
      {tab === 'skills' && (
        <div className="space-y-6">
          {/* Editable skills (.md files) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <Zap size={14} className="text-violet-500" />Skills (แก้ไขได้)
                <span className="text-[10px] font-normal text-gray-400">inject เข้า master prompt ตอนเขียนบทความ</span>
              </h2>
              <button
                onClick={() => systemUnlocked ? lockSystem() : setShowPasswordModal(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  systemUnlocked ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'border border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                {systemUnlocked ? <><Lock size={12} />ล็อก</> : <><Unlock size={12} />ปลดล็อกเพื่อแก้ไข</>}
              </button>
            </div>

            {/* Group editable skills by page */}
            {Object.entries(
              systemSkills.reduce((acc, s) => { if (!acc[s.page]) acc[s.page] = []; acc[s.page].push(s); return acc }, {} as Record<string, SystemSkill[]>)
            ).map(([pageKey, skills]) => (
              <div key={pageKey} className="mb-4">
                <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">
                  {PAGE_LABELS[pageKey] ?? pageKey}
                </div>
                <div className="space-y-2">
                  {skills.map(s => {
                    const editKey = `skill:${s.key}`
                    const isOpen = expandedKey === editKey
                    const isDirty = editKey in editValues
                    const content = editKey in editValues ? editValues[editKey] : s.content
                    return (
                      <div key={s.key} className="border border-gray-200 rounded-xl overflow-hidden">
                        <button onClick={() => setExpandedKey(isOpen ? null : editKey)}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
                          <div className="flex items-center gap-3 text-left">
                            <Zap size={14} className="text-violet-400 shrink-0" />
                            <div>
                              <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                {s.name}
                                {!systemUnlocked && <Lock size={11} className="text-gray-300" />}
                                {isDirty && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">ยังไม่บันทึก</span>}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">{s.description}</div>
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                {s.usedIn.map(u => (
                                  <span key={u} className="inline-flex items-center gap-0.5 text-[10px] bg-violet-50 text-violet-600 border border-violet-100 px-1.5 py-0.5 rounded-full">
                                    <Tag size={9} />{u}
                                  </span>
                                ))}
                                {s.affectsNote && (
                                  <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                    ⚡ {s.affectsNote}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          {isOpen ? <ChevronDown size={15} className="text-gray-400 shrink-0" /> : <ChevronRight size={15} className="text-gray-400 shrink-0" />}
                        </button>
                        {isOpen && (
                          <div className="border-t border-gray-100 p-4 space-y-3">
                            <textarea value={content}
                              onChange={e => systemUnlocked && setEditValues(prev => ({ ...prev, [editKey]: e.target.value }))}
                              readOnly={!systemUnlocked} rows={14}
                              className={`w-full text-xs font-mono border border-gray-200 rounded-lg p-3 resize-y focus:outline-none ${systemUnlocked ? 'bg-white focus:ring-2 focus:ring-violet-500' : 'bg-gray-50 text-gray-400 cursor-not-allowed'}`}
                            />
                            {systemUnlocked ? (
                              <div className="flex justify-end gap-2">
                                {isDirty && (
                                  <button onClick={() => setEditValues(prev => { const n = { ...prev }; delete n[editKey]; return n })}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                                    <RotateCcw size={12} />ยกเลิก
                                  </button>
                                )}
                                <button
                                  onClick={async () => {
                                    setSaving(editKey)
                                    try {
                                      const res = await fetch('/api/settings/prompts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'system', key: s.key, content }) })
                                      if (!res.ok) throw new Error()
                                      toast.success('บันทึก skill แล้ว')
                                      setEditValues(prev => { const n = { ...prev }; delete n[editKey]; return n })
                                    } catch { toast.error('บันทึกไม่สำเร็จ') } finally { setSaving(null) }
                                  }}
                                  disabled={saving === editKey || !isDirty}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-40">
                                  <Save size={12} />{saving === editKey ? 'กำลังบันทึก...' : 'บันทึก'}
                                </button>
                              </div>
                            ) : (
                              <div className="flex justify-center">
                                <button onClick={() => setShowPasswordModal(true)}
                                  className="flex items-center gap-1.5 px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                                  <Unlock size={12} />ปลดล็อกเพื่อแก้ไข
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Code-based skills (read-only info cards) */}
          <div>
            <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2 mb-3">
              <Zap size={14} className="text-blue-500" />Code Skills (อ่านอย่างเดียว)
              <span className="text-[10px] font-normal text-gray-400">built-in ใน codebase — แก้ได้ใน src/lib/skills/</span>
            </h2>

            {Object.entries(
              codeSkills.reduce((acc, s) => { if (!acc[s.page]) acc[s.page] = []; acc[s.page].push(s); return acc }, {} as Record<string, CodeSkill[]>)
            ).map(([pageKey, skills]) => (
              <div key={pageKey} className="mb-4">
                <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">
                  {PAGE_LABELS[pageKey] ?? pageKey}
                </div>
                <div className="space-y-2">
                  {skills.map(s => (
                    <div key={s.key} className="border border-gray-100 rounded-xl px-4 py-3 bg-gray-50/50 flex items-start gap-3">
                      <Zap size={14} className="text-blue-300 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-700">{s.name}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{s.description}</div>
                        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                          {s.usedIn.map(u => (
                            <span key={u} className="inline-flex items-center gap-0.5 text-[10px] bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded-full">
                              <Tag size={9} />{u}
                            </span>
                          ))}
                          <span className="text-[10px] text-gray-300 font-mono ml-1">{s.file}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Per Client Tab ── */}
      {tab === 'client' && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700 shrink-0">Client:</label>
            <select
              value={selectedProjectId}
              onChange={e => { setSelectedProjectId(e.target.value); setClientUnlocked({}) }}
              className="flex-1 max-w-xs text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900"
            >
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.clientName || p.name}</option>
              ))}
            </select>
            <span className="text-xs text-gray-400">
              {Object.keys(currentOverrides).length > 0
                ? `${Object.keys(currentOverrides).length} prompt override`
                : 'ใช้ default ทั้งหมด'}
            </span>
          </div>

          {selectedProject && (
            <div className="space-y-6">
              {Object.entries(CATEGORIES).map(([catKey, cat]) => {
                const prompts = groupedPrompts[catKey] ?? []
                if (!prompts.length) return null
                return (
                  <div key={catKey}>
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border mb-3 ${cat.color}`}>
                      {cat.icon}{cat.label}
                    </div>
                    <div className="space-y-2">
                      {prompts.map(p => {
                        const isOpen = clientExpandedKey === `${selectedProjectId}:${p.key}`
                        const hasOverride = !!currentOverrides[p.key]
                        const editKey = `${selectedProjectId}:${p.key}`
                        const isDirty = editKey in editValues
                        const isUnlocked = !!clientUnlocked[editKey]

                        return (
                          <div key={p.key} className={`border rounded-xl overflow-hidden ${hasOverride ? 'border-blue-200' : 'border-gray-200'}`}>
                            <div className="flex items-center">
                              <button
                                onClick={() => setClientExpandedKey(isOpen ? null : `${selectedProjectId}:${p.key}`)}
                                className="flex-1 flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                              >
                                <div className="flex items-center gap-3">
                                  <FileText size={15} className={hasOverride ? 'text-blue-500' : 'text-gray-400'} />
                                  <div>
                                    <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                      {p.name}
                                      {hasOverride && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Custom</span>}
                                      {!hasOverride && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Default</span>}
                                      {isDirty && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">ยังไม่บันทึก</span>}
                                    </div>
                                    <div className="text-xs text-gray-500 mt-0.5">{p.description}</div>
                                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                                      {p.usedIn?.map(u => (
                                        <span key={u} className="inline-flex items-center gap-0.5 text-[10px] bg-gray-100 text-gray-500 border border-gray-200 px-1.5 py-0.5 rounded-full">
                                          <Tag size={9} />{u}
                                        </span>
                                      ))}
                                      {p.affectsNote && (
                                        <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                          ⚡ {p.affectsNote}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                {isOpen ? <ChevronDown size={15} className="text-gray-400 shrink-0" /> : <ChevronRight size={15} className="text-gray-400 shrink-0" />}
                              </button>
                              {/* Lock toggle button */}
                              <button
                                onClick={e => {
                                  e.stopPropagation()
                                  setClientUnlocked(prev => ({ ...prev, [editKey]: !isUnlocked }))
                                  if (isUnlocked) {
                                    setEditValues(prev => { const n = { ...prev }; delete n[editKey]; return n })
                                  }
                                  if (!isOpen) setClientExpandedKey(`${selectedProjectId}:${p.key}`)
                                }}
                                className={`mr-3 p-1.5 rounded-lg transition-colors ${
                                  isUnlocked ? 'text-amber-500 bg-amber-50 hover:bg-amber-100' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'
                                }`}
                                title={isUnlocked ? 'ล็อก' : 'ปลดล็อกเพื่อแก้ไข'}
                              >
                                {isUnlocked ? <Unlock size={14} /> : <Lock size={14} />}
                              </button>
                            </div>

                            {isOpen && (
                              <div className="border-t border-gray-100 p-4 space-y-3">
                                {!hasOverride && !isDirty && (
                                  <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-3">
                                    ตอนนี้ใช้ System Default — ปลดล็อก <Lock size={10} className="inline" /> แล้วแก้เพื่อ customize เฉพาะ client นี้
                                  </div>
                                )}
                                <textarea
                                  value={isDirty ? editValues[editKey] : (hasOverride ? currentOverrides[p.key] : getSystemContent(p.key))}
                                  onChange={e => isUnlocked && setEditValues(prev => ({ ...prev, [editKey]: e.target.value }))}
                                  readOnly={!isUnlocked}
                                  rows={18}
                                  className={`w-full text-xs font-mono border border-gray-200 rounded-lg p-3 resize-y focus:outline-none ${
                                    isUnlocked
                                      ? 'bg-white focus:ring-2 focus:ring-blue-500'
                                      : 'bg-gray-50 text-gray-400 cursor-not-allowed'
                                  }`}
                                />
                                {isUnlocked && (
                                  <div className="flex justify-between items-center">
                                    {hasOverride ? (
                                      <button
                                        onClick={() => saveClient(p.key, null)}
                                        disabled={saving === editKey}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                                      >
                                        <RotateCcw size={12} />รีเซ็ตเป็น Default
                                      </button>
                                    ) : <div />}
                                    <div className="flex gap-2">
                                      {isDirty && (
                                        <button
                                          onClick={() => { setEditValues(prev => { const n = { ...prev }; delete n[editKey]; return n }) }}
                                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                                        >
                                          <RotateCcw size={12} />ยกเลิก
                                        </button>
                                      )}
                                      <button
                                        onClick={() => saveClient(p.key, isDirty ? editValues[editKey] : (currentOverrides[p.key] ?? getSystemContent(p.key)))}
                                        disabled={saving === editKey || !isDirty}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
                                      >
                                        <Save size={12} />{saving === editKey ? 'กำลังบันทึก...' : 'บันทึก Custom'}
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      {/* ── Studio Tab ── */}
      {tab === 'studio' && (() => {
        const studioPrompts = systemPrompts.filter(p => studioPromptKeys.includes(p.key))
        const currentStudioOverrides = initialStudioOverrides

        async function saveStudio(key: string, content: string | null) {
          const editKey = `studio:${key}`
          setSaving(editKey)
          try {
            const res = await fetch('/api/settings/prompts', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'studio', key, content }),
            })
            if (!res.ok) throw new Error()
            toast.success(content === null ? 'รีเซ็ตเป็น System Default แล้ว' : 'บันทึก Studio prompt แล้ว')
            setEditValues(prev => { const n = { ...prev }; delete n[editKey]; return n })
            window.location.reload()
          } catch { toast.error('บันทึกไม่สำเร็จ') }
          finally { setSaving(null) }
        }

        return (
          <div className="space-y-5">
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 text-sm text-indigo-700">
              <div className="font-semibold flex items-center gap-2"><Layers size={14} />Studio Prompt Override</div>
              <div className="text-xs mt-1 text-indigo-600">
                prompt ที่แก้ในแถบนี้จะมีผล<strong>เฉพาะ Content Studio และ Image Studio</strong> เท่านั้น (ทุก client) — ถ้าไม่ได้แก้จะใช้ System Prompt แทน
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {Object.keys(currentStudioOverrides).length > 0
                  ? `${Object.keys(currentStudioOverrides).length} prompt ถูก override`
                  : 'ทุก prompt ใช้ System Default'}
              </span>
            </div>

            <div className="space-y-2">
              {studioPrompts.map(p => {
                const editKey = `studio:${p.key}`
                const isOpen = clientExpandedKey === editKey
                const hasOverride = !!currentStudioOverrides[p.key]
                const isDirty = editKey in editValues
                const isUnlocked = !!clientUnlocked[editKey]
                const displayContent = isDirty ? editValues[editKey] : (hasOverride ? currentStudioOverrides[p.key] : getSystemContent(p.key))

                return (
                  <div key={p.key} className={`border rounded-xl overflow-hidden ${hasOverride ? 'border-indigo-200' : 'border-gray-200'}`}>
                    <div className="flex items-center">
                      <button
                        onClick={() => setClientExpandedKey(isOpen ? null : editKey)}
                        className="flex-1 flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          <Layers size={15} className={hasOverride ? 'text-indigo-500' : 'text-gray-400'} />
                          <div>
                            <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                              {p.name}
                              {hasOverride && <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">Studio Override</span>}
                              {!hasOverride && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">System Default</span>}
                              {isDirty && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">ยังไม่บันทึก</span>}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">{p.description}</div>
                            <div className="flex items-center gap-1 mt-1 flex-wrap">
                              {p.usedIn?.map(u => (
                                <span key={u} className="inline-flex items-center gap-0.5 text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-100 px-1.5 py-0.5 rounded-full">
                                  <Tag size={9} />{u}
                                </span>
                              ))}
                              {p.affectsNote && (
                                <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                  ⚡ {p.affectsNote}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        {isOpen ? <ChevronDown size={15} className="text-gray-400 shrink-0" /> : <ChevronRight size={15} className="text-gray-400 shrink-0" />}
                      </button>
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          setClientUnlocked(prev => ({ ...prev, [editKey]: !isUnlocked }))
                          if (isUnlocked) setEditValues(prev => { const n = { ...prev }; delete n[editKey]; return n })
                          if (!isOpen) setClientExpandedKey(editKey)
                        }}
                        className={`mr-3 p-1.5 rounded-lg transition-colors ${isUnlocked ? 'text-amber-500 bg-amber-50 hover:bg-amber-100' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`}
                        title={isUnlocked ? 'ล็อก' : 'ปลดล็อกเพื่อแก้ไข'}
                      >
                        {isUnlocked ? <Unlock size={14} /> : <Lock size={14} />}
                      </button>
                    </div>

                    {isOpen && (
                      <div className="border-t border-gray-100 p-4 space-y-3">
                        {!hasOverride && !isDirty && (
                          <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-3">
                            ตอนนี้ใช้ System Default — ปลดล็อก <Lock size={10} className="inline" /> แล้วแก้เพื่อ override เฉพาะหน้า Studio
                          </div>
                        )}
                        <textarea
                          value={displayContent}
                          onChange={e => isUnlocked && setEditValues(prev => ({ ...prev, [editKey]: e.target.value }))}
                          readOnly={!isUnlocked}
                          rows={18}
                          className={`w-full text-xs font-mono border border-gray-200 rounded-lg p-3 resize-y focus:outline-none ${isUnlocked ? 'bg-white focus:ring-2 focus:ring-indigo-500' : 'bg-gray-50 text-gray-400 cursor-not-allowed'}`}
                        />
                        {isUnlocked && (
                          <div className="flex justify-between items-center">
                            {hasOverride ? (
                              <button
                                onClick={() => saveStudio(p.key, null)}
                                disabled={saving === editKey}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                              >
                                <RotateCcw size={12} />รีเซ็ตเป็น System Default
                              </button>
                            ) : <div />}
                            <div className="flex gap-2">
                              {isDirty && (
                                <button
                                  onClick={() => setEditValues(prev => { const n = { ...prev }; delete n[editKey]; return n })}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                                >
                                  <RotateCcw size={12} />ยกเลิก
                                </button>
                              )}
                              <button
                                onClick={() => saveStudio(p.key, displayContent)}
                                disabled={saving === editKey || !isDirty}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40"
                              >
                                <Save size={12} />{saving === editKey ? 'กำลังบันทึก...' : 'บันทึก Studio Override'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
