'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import type { MarsTask, TaskStatus } from '@/lib/mock-data/todos'
import {
  CheckCircle2, Circle, AlertCircle, Clock, CalendarDays, List,
  ChevronRight, FileText, Zap, Globe, ClipboardCheck, RefreshCw,
  Plus, Trash2, X, ExternalLink,
} from 'lucide-react'
import Link from 'next/link'

const TODAY = new Date().toISOString().slice(0, 10)

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; icon: typeof Circle }> = {
  todo:        { label: 'Todo',        color: 'text-gray-400',    icon: Circle },
  in_progress: { label: 'In Progress', color: 'text-blue-600',    icon: Clock },
  done:        { label: 'Done',        color: 'text-emerald-600', icon: CheckCircle2 },
  blocked:     { label: 'Blocked',     color: 'text-rose-600',    icon: AlertCircle },
}

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  high:   'bg-amber-100 text-amber-700',
  normal: 'bg-gray-100 text-gray-600',
  low:    'bg-gray-50 text-gray-400',
}

const SOURCE_LABEL: Record<string, string> = {
  mars: 'Mars AI', manual: 'Manual', client: 'Client', review: 'Review',
}
const SOURCE_COLOR: Record<string, string> = {
  mars:   'bg-green-50 text-green-700',
  manual: 'bg-gray-100 text-gray-500',
  client: 'bg-blue-50 text-blue-700',
  review: 'bg-amber-50 text-amber-700',
}
const ARTIFACT_ICON: Record<string, typeof FileText> = {
  article: FileText, review: ClipboardCheck, ai_job: Zap, wordpress: Globe,
}

// Quick-link suggestions to show in the Add modal
const QUICK_LINKS = [
  { label: 'Projects',       href: '/projects' },
  { label: 'Articles',       href: '/articles' },
  { label: 'Review Queue',   href: '/review' },
  { label: 'AI Jobs',        href: '/ai-jobs' },
  { label: 'WordPress',      href: '/website-connect' },
  { label: 'SEO Report',     href: '/report' },
  { label: 'Templates',      href: '/templates' },
  { label: 'Image Studio',   href: '/image-studio' },
]

function SourceBadge({ source }: { source: string }) {
  return (
    <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full ${SOURCE_COLOR[source] ?? 'bg-gray-100 text-gray-500'}`}>
      {SOURCE_LABEL[source] ?? source}
    </span>
  )
}

function ArtifactCard({ artifact }: { artifact: NonNullable<MarsTask['artifact']> }) {
  const Icon = ARTIFACT_ICON[artifact.type] ?? FileText
  return (
    <Link href={artifact.href}
      className="flex items-center gap-3 mt-3 px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors group">
      <div className="w-7 h-7 rounded-lg bg-white border border-gray-200 flex items-center justify-center shrink-0">
        <Icon size={13} className="text-gray-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-gray-900 truncate">{artifact.title}</div>
        <div className="text-[10px] text-gray-400 mt-0.5">{artifact.status}</div>
      </div>
      <ChevronRight size={13} className="text-gray-400 shrink-0 group-hover:text-gray-700 transition-colors" />
    </Link>
  )
}

function TaskCard({ task, onToggle, onDelete }: {
  task: MarsTask
  onToggle: (id: string) => void
  onDelete: (id: string) => void
}) {
  const cfg = STATUS_CONFIG[task.status]
  const Icon = cfg.icon
  const isOverdue = task.status !== 'done' && new Date(task.dueDate) < new Date(TODAY)
  const isManual = task.source === 'manual'

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden transition-colors ${
      task.status === 'done' ? 'border-gray-100 opacity-60' : 'border-gray-200 hover:border-gray-300'
    }`}>
      <div className="px-5 py-4">
        <div className="flex items-start gap-3">
          <button onClick={() => onToggle(task.id)} className="mt-0.5 shrink-0 hover:opacity-70 transition-opacity">
            <Icon size={17} className={cfg.color} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              {task.projectName && (
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{task.projectName}</span>
              )}
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${PRIORITY_COLOR[task.priority]}`}>{task.priority}</span>
              <SourceBadge source={task.source} />
            </div>
            <p className={`text-sm font-semibold leading-5 ${task.status === 'done' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
              {task.title}
            </p>
            <p className="text-xs text-gray-500 mt-1 leading-5 line-clamp-2">{task.description}</p>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <span className={`text-[11px] flex items-center gap-1 ${isOverdue ? 'text-rose-600 font-medium' : 'text-gray-400'}`}>
                <CalendarDays size={11} />
                {isOverdue && 'Overdue · '}
                {new Date(task.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                {task.dueTime && ` ${task.dueTime}`}
              </span>
              <span className="text-[11px] text-gray-400">{task.assignee}</span>
              <div className="flex gap-1 flex-wrap">
                {task.tags.slice(0, 3).map(t => (
                  <span key={t} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">#{t}</span>
                ))}
              </div>
            </div>
            {task.artifact && task.status !== 'done' && <ArtifactCard artifact={task.artifact} />}
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0 ml-2">
            <div className="flex items-center gap-1.5">
              <span className={`text-[11px] font-medium ${cfg.color}`}>{cfg.label}</span>
              {isManual && (
                <button
                  onClick={() => onDelete(task.id)}
                  className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors"
                  title="ลบ Todo"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            {task.actionHref && task.status !== 'done' && (
              <Link href={task.actionHref}
                className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors whitespace-nowrap">
                {task.actionLabel ?? 'ไปดู'} <ChevronRight size={11} />
              </Link>
            )}
            {task.actionHref && task.actionHref.startsWith('http') && (
              <a href={task.actionHref} target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-gray-400 hover:text-blue-500 flex items-center gap-0.5 transition-colors">
                <ExternalLink size={10} /> เปิดลิ้งค์
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Add Todo Modal ───────────────────────────────────────────────────────────

function AddTodoModal({ onClose, onAdd }: {
  onClose: () => void
  onAdd: (data: { title: string; description: string; priority: string; dueDate: string; actionHref: string }) => Promise<void>
}) {
  const [title, setTitle]       = useState('')
  const [description, setDesc]  = useState('')
  const [priority, setPriority] = useState('normal')
  const [dueDate, setDueDate]   = useState(new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10))
  const [actionHref, setHref]   = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('กรุณาใส่ชื่อ Todo'); return }
    setSaving(true)
    try {
      await onAdd({ title, description, priority, dueDate, actionHref })
      onClose()
    } catch {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-sm">เพิ่ม Todo ใหม่</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X size={15} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">ชื่อ Todo *</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="เช่น รีวิวบทความ, อัพเดทเว็บไซต์..."
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-gray-900/10 placeholder-gray-300"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">รายละเอียด</label>
            <textarea
              value={description}
              onChange={e => setDesc(e.target.value)}
              rows={2}
              placeholder="อธิบายสิ่งที่ต้องทำ..."
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-gray-900/10 placeholder-gray-300 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-gray-900/10 bg-white">
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">ลิ้งค์ที่เกี่ยวข้อง (ไม่บังคับ)</label>
            <input
              value={actionHref}
              onChange={e => setHref(e.target.value)}
              placeholder="/projects หรือ URL ภายนอก"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-gray-900/10 placeholder-gray-300 mb-2"
            />
            <div className="flex flex-wrap gap-1.5">
              {QUICK_LINKS.map(l => (
                <button type="button" key={l.href}
                  onClick={() => setHref(l.href)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                    actionHref === l.href
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 transition-colors">
              ยกเลิก
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition-colors disabled:opacity-50">
              {saving ? 'กำลังบันทึก...' : 'เพิ่ม Todo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Calendar view ────────────────────────────────────────────────────────────

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function CalendarView({ tasks }: { tasks: MarsTask[] }) {
  const [weekOffset, setWeekOffset] = useState(0)

  const startDate = useMemo(() => {
    const d = new Date(TODAY)
    const day = d.getDay()
    const diff = day === 0 ? -6 : 1 - day
    d.setDate(d.getDate() + diff + weekOffset * 7)
    return d
  }, [weekOffset])

  const days = useMemo(() => Array.from({ length: 35 }, (_, i) => {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i)
    return d.toISOString().split('T')[0]
  }), [startDate])

  const tasksByDate = useMemo(() => {
    const map: Record<string, MarsTask[]> = {}
    tasks.forEach(t => { if (!map[t.dueDate]) map[t.dueDate] = []; map[t.dueDate].push(t) })
    return map
  }, [tasks])

  const endDate = useMemo(() => {
    const d = new Date(startDate)
    d.setDate(d.getDate() + 34)
    return d
  }, [startDate])

  const rangeLabel = `${startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — ${endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={() => setWeekOffset(v => v - 5)}
          className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
          ← Prev
        </button>
        <span className="text-xs text-gray-500 font-medium">{rangeLabel}</span>
        <button onClick={() => setWeekOffset(v => v + 5)}
          className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
          Next →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {days.map(date => {
          const d = new Date(date)
          const dow = d.getDay()
          const dayTasks = tasksByDate[date] ?? []
          const isToday = date === TODAY
          const isWeekend = dow === 0 || dow === 6

          return (
            <div key={date} className={`rounded-xl border p-2 min-h-[100px] ${
              isToday ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-white'
            } ${isWeekend ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-[11px] font-semibold ${isToday ? 'text-gray-900' : 'text-gray-400'}`}>
                  {DOW[dow]} {d.getDate()}
                </span>
                {isToday && <span className="text-[9px] font-bold bg-gray-900 text-white px-1.5 py-0.5 rounded-full">Today</span>}
              </div>
              <div className="space-y-1">
                {dayTasks.map(t => {
                  const pColor = t.priority === 'urgent' ? 'bg-red-400' : t.priority === 'high' ? 'bg-amber-400' : 'bg-gray-300'
                  const href = t.actionHref ?? '/todos'
                  return (
                    <Link key={t.id} href={href}
                      className={`flex items-center gap-1.5 text-[11px] rounded px-1.5 py-1 transition-colors ${
                        t.status === 'done' ? 'opacity-40' : 'bg-gray-100 hover:bg-gray-200'
                      }`}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pColor}`} />
                      <span className={`truncate ${t.status === 'done' ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                        {t.title}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TodosPage() {
  const [tasks, setTasks]           = useState<MarsTask[]>([])
  const [loading, setLoading]       = useState(true)
  const [view, setView]             = useState<'list' | 'calendar'>('list')
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all')
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [showAdd, setShowAdd]       = useState(false)

  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/todos')
      if (res.ok) setTasks(await res.json())
    } catch { /* keep empty */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadTasks() }, [loadTasks])

  async function handleToggle(id: string) {
    const task = tasks.find(t => t.id === id)
    if (!task) return
    const newStatus: TaskStatus = task.status === 'done' ? 'todo' : 'done'
    setTasks(prev => prev.map(t => t.id !== id ? t : { ...t, status: newStatus }))
    await fetch('/api/todos', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: newStatus }),
    }).catch(() => {})
  }

  async function handleDelete(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id))
    await fetch('/api/todos', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {})
  }

  async function handleAdd(data: { title: string; description: string; priority: string; dueDate: string; actionHref: string }) {
    const res = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('Failed')
    await loadTasks()
  }

  const projects = Array.from(new Set(tasks.filter(t => t.projectName).map(t => t.projectName!)))

  const filtered = useMemo(() => tasks.filter(t => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    if (projectFilter !== 'all' && t.projectName !== projectFilter) return false
    return true
  }), [tasks, statusFilter, projectFilter])

  const counts = {
    all:         tasks.length,
    todo:        tasks.filter(t => t.status === 'todo').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    blocked:     tasks.filter(t => t.status === 'blocked').length,
    done:        tasks.filter(t => t.status === 'done').length,
  }

  return (
    <>
      {showAdd && (
        <AddTodoModal onClose={() => setShowAdd(false)} onAdd={handleAdd} />
      )}

      <div className="max-w-3xl mx-auto py-8 px-4 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 pb-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Todos</h1>
            <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
              Tasks จาก{' '}
              <SourceBadge source="mars" />
              <SourceBadge source="review" />
              <SourceBadge source="client" />
              <SourceBadge source="manual" />
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadTasks} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors" title="Refresh">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              <button onClick={() => setView('list')}
                className={`p-1.5 rounded-md transition-colors ${view === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                <List size={14} />
              </button>
              <button onClick={() => setView('calendar')}
                className={`p-1.5 rounded-md transition-colors ${view === 'calendar' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                <CalendarDays size={14} />
              </button>
            </div>
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-900 text-white text-xs font-semibold hover:bg-gray-700 transition-colors">
              <Plus size={13} /> เพิ่ม Todo
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {(['all', 'todo', 'in_progress', 'blocked', 'done'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs rounded-full transition-colors ${
                statusFilter === s ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}>
              {s === 'all'         ? `All (${counts.all})`
               : s === 'in_progress' ? `In Progress (${counts.in_progress})`
               : s === 'blocked'     ? `Blocked (${counts.blocked})`
               : s === 'done'        ? `Done (${counts.done})`
               : `Todo (${counts.todo})`}
            </button>
          ))}
          {projects.length > 0 && (
            <>
              <div className="w-px h-6 bg-gray-200 self-center" />
              {['all', ...projects].map(p => (
                <button key={p} onClick={() => setProjectFilter(p)}
                  className={`px-3 py-1 text-xs rounded-full transition-colors ${
                    projectFilter === p ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}>
                  {p === 'all' ? 'All projects' : p}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center py-16 text-sm text-gray-400">
            <RefreshCw size={18} className="animate-spin mx-auto mb-2 text-gray-300" />
            กำลังโหลด Tasks...
          </div>
        ) : view === 'list' ? (
          <div className="space-y-2.5">
            {filtered.length === 0
              ? (
                <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-12 text-center">
                  <p className="text-gray-400 text-sm mb-3">ยังไม่มี Todo ในหมวดนี้</p>
                  <button onClick={() => setShowAdd(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-900 text-white text-xs font-semibold hover:bg-gray-700 transition-colors">
                    <Plus size={13} /> เพิ่ม Todo แรก
                  </button>
                </div>
              )
              : filtered.map(t => (
                  <TaskCard key={t.id} task={t} onToggle={handleToggle} onDelete={handleDelete} />
                ))
            }
          </div>
        ) : (
          <CalendarView tasks={filtered} />
        )}
      </div>
    </>
  )
}
