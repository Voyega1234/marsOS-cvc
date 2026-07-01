'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, XCircle, MessageSquare, ChevronDown, ExternalLink, AlertCircle, Clock, Eye } from 'lucide-react'

interface CommentItem {
  id: string
  body: string
  createdAt: Date
  user: { name: string | null; role: string }
}

interface ArticleItem {
  id: string
  title: string
  status: string
  updatedAt: Date
  project: { id: string; name: string }
  keyword: string | null
  htmlContent: string | null
  comments: CommentItem[]
}

interface Props {
  role: string
  clientRevisionArticles: ArticleItem[]
  clientReviewArticles: ArticleItem[]
}

function timeAgo(date: Date) {
  const d = new Date(date)
  const diff = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diff < 60) return 'เมื่อกี้'
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชม.ที่แล้ว`
  return `${Math.floor(diff / 86400)} วันที่แล้ว`
}

function ClientRevisionCard({ article, onDone }: { article: ArticleItem; onDone: () => void }) {
  const [expanded, setExpanded] = useState(true)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState<'approve' | 'revision' | null>(null)

  // Latest client comment
  const clientComments = article.comments.filter(c =>
    c.body.includes('Client ขอแก้') || c.body.includes('Client Approved') || c.user.role === 'CLIENT'
  )

  async function sendForClientReview() {
    setLoading('approve')
    try {
      const res = await fetch(`/api/articles/${article.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CLIENT_REVIEW' }),
      })
      if (!res.ok) throw new Error()
      if (comment.trim()) {
        await fetch(`/api/articles/${article.id}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: `[✅ ทีมแก้ไขแล้ว] ${comment.trim()}` }),
        })
      }
      onDone()
    } catch {
      alert('เกิดข้อผิดพลาด')
    } finally {
      setLoading(null)
    }
  }

  async function approveDirectly() {
    setLoading('revision')
    try {
      const res = await fetch(`/api/articles/${article.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'APPROVED' }),
      })
      if (!res.ok) throw new Error()
      onDone()
    } catch {
      alert('เกิดข้อผิดพลาด')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="bg-white border border-rose-200 rounded-2xl overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 shrink-0">
          <AlertCircle size={16} className="text-rose-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 truncate">{article.title}</span>
            <span className="text-[10px] bg-rose-100 text-rose-600 px-2 py-0.5 rounded-full font-semibold shrink-0">Client ขอแก้ไข</span>
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">{article.project.name} {article.keyword ? `· ${article.keyword}` : ''} · {timeAgo(article.updatedAt)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a href={`/articles/${article.id}`} target="_blank"
            className="flex items-center gap-1 text-[11px] text-blue-500 hover:underline">
            <Eye size={12} /> ดูบทความ
          </a>
          <button onClick={() => setExpanded(p => !p)}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-50 pt-3 space-y-3">
          {/* Client comments */}
          {clientComments.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">ความคิดเห็นจาก Client</p>
              {clientComments.map(c => (
                <div key={c.id} className="bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
                  <p className="text-xs text-rose-800">{c.body.replace(/^\[.*?\]\s*/, '')}</p>
                  <p className="text-[10px] text-rose-400 mt-1">{c.user.name ?? 'Client'} · {timeAgo(c.createdAt)}</p>
                </div>
              ))}
            </div>
          )}

          {/* All comments thread */}
          {article.comments.filter(c => !clientComments.includes(c)).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Comment ทั้งหมด</p>
              {article.comments.filter(c => !clientComments.includes(c)).slice(0, 5).map(c => (
                <div key={c.id} className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-xs text-gray-700">{c.body}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{c.user.name ?? '—'} · {timeAgo(c.createdAt)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Reply + actions */}
          <textarea
            rows={2}
            placeholder="แจ้งให้ client ทราบว่าแก้ไขอะไรไปบ้าง (optional)..."
            value={comment}
            onChange={e => setComment(e.target.value)}
            className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200 resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={sendForClientReview}
              disabled={!!loading}
              className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors"
            >
              <CheckCircle size={13} />
              {loading === 'approve' ? 'กำลังส่ง...' : 'แก้แล้ว — ส่ง Client Approve ใหม่'}
            </button>
            <button
              onClick={approveDirectly}
              disabled={!!loading}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors"
            >
              <CheckCircle size={13} />
              {loading === 'revision' ? 'กำลัง...' : 'Approve เลย'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ClientReviewCard({ article, isClient, onDone }: { article: ArticleItem; isClient: boolean; onDone: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState<'approve' | 'revision' | null>(null)

  async function doAction(action: 'approve' | 'revision') {
    setLoading(action)
    try {
      const res = await fetch(`/api/articles/${article.id}/client-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment }),
      })
      if (!res.ok) throw new Error()
      onDone()
    } catch {
      alert('เกิดข้อผิดพลาด')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="bg-white border border-violet-200 rounded-2xl overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 shrink-0">
          <Clock size={16} className="text-violet-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 truncate">{article.title}</span>
            <span className="text-[10px] bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full font-semibold shrink-0">รอ Approve</span>
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">{article.project.name} {article.keyword ? `· ${article.keyword}` : ''} · {timeAgo(article.updatedAt)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {article.htmlContent && (
            <a href={`/articles/${article.id}`} target="_blank"
              className="flex items-center gap-1 text-[11px] text-blue-500 hover:underline">
              <Eye size={12} /> {isClient ? 'อ่านบทความ' : 'ดูบทความ'}
            </a>
          )}
          {isClient && (
            <button onClick={() => setExpanded(p => !p)}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
              <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {isClient && expanded && (
        <div className="px-4 pb-4 border-t border-gray-50 pt-3 space-y-3">
          <textarea
            rows={3}
            placeholder="มีความคิดเห็นหรือต้องการแก้ไขตรงไหน? (optional สำหรับ approve, จำเป็นสำหรับขอแก้ไข)"
            value={comment}
            onChange={e => setComment(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-200 resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => doAction('approve')}
              disabled={!!loading}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <CheckCircle size={15} />
              {loading === 'approve' ? 'กำลัง Approve...' : '✅ Approve บทความ'}
            </button>
            <button
              onClick={() => doAction('revision')}
              disabled={!!loading || !comment.trim()}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 bg-rose-50 hover:bg-rose-100 disabled:opacity-40 text-rose-600 text-sm font-semibold rounded-xl border border-rose-200 transition-colors"
            >
              <XCircle size={15} />
              {loading === 'revision' ? 'กำลังส่ง...' : '✏️ ขอแก้ไข'}
            </button>
          </div>
          {!comment.trim() && (
            <p className="text-[10px] text-gray-400">* ต้องใส่ความคิดเห็นก่อนขอแก้ไข</p>
          )}
        </div>
      )}
    </div>
  )
}

export function ReviewPageClient({ role, clientRevisionArticles, clientReviewArticles }: Props) {
  const router = useRouter()
  const isClient = role === 'CLIENT'

  const refresh = () => router.refresh()

  const totalAdmin = clientRevisionArticles.length + clientReviewArticles.length

  if (isClient) {
    return (
      <div className="space-y-5 max-w-3xl">
        <div>
          <h1 className="text-xl font-bold text-gray-900">บทความรอ Approve</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {clientReviewArticles.length > 0
              ? `${clientReviewArticles.length} บทความรอการอนุมัติจากคุณ`
              : 'ไม่มีบทความรอ Approve'}
          </p>
        </div>

        {clientReviewArticles.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
            <CheckCircle size={36} className="text-emerald-400 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">ไม่มีบทความรอการอนุมัติ</p>
            <p className="text-gray-400 text-sm mt-1">เมื่อทีมส่งบทความมาให้ Approve จะแสดงที่นี่</p>
          </div>
        ) : (
          <div className="space-y-3">
            {clientReviewArticles.map(a => (
              <ClientReviewCard key={a.id} article={a} isClient={true} onDone={refresh} />
            ))}
          </div>
        )}
      </div>
    )
  }

  // Admin/team view
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Review Queue</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {totalAdmin > 0 ? `${totalAdmin} รายการรอดำเนินการ` : 'ไม่มีรายการรอ'}
        </p>
      </div>

      {/* CLIENT_REVISION — ด่วน: client ขอแก้แล้ว รอทีมแก้ */}
      {clientRevisionArticles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-rose-500" />
            <h2 className="text-sm font-bold text-gray-900">Client ขอแก้ไข</h2>
            <span className="text-xs bg-rose-100 text-rose-600 px-2 py-0.5 rounded-full font-semibold">{clientRevisionArticles.length}</span>
            <span className="text-[11px] text-gray-400">— แก้ไขแล้วส่ง Approve ใหม่</span>
          </div>
          {clientRevisionArticles.map(a => (
            <ClientRevisionCard key={a.id} article={a} onDone={refresh} />
          ))}
        </div>
      )}

      {/* CLIENT_REVIEW — รอ client approve */}
      {clientReviewArticles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-violet-500" />
            <h2 className="text-sm font-bold text-gray-900">รอ Client Approve</h2>
            <span className="text-xs bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full font-semibold">{clientReviewArticles.length}</span>
            <span className="text-[11px] text-gray-400">— ส่งให้ client แล้ว รอการตอบกลับ</span>
          </div>
          {clientReviewArticles.map(a => (
            <ClientReviewCard key={a.id} article={a} isClient={false} onDone={refresh} />
          ))}
        </div>
      )}

      {totalAdmin === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
          <CheckCircle size={36} className="text-emerald-400 mx-auto mb-3" />
          <p className="text-gray-600 font-medium">ไม่มีงานค้าง</p>
          <p className="text-gray-400 text-sm mt-1">ส่งบทความให้ client approve โดยเปลี่ยน status เป็น "รอ Client Approve" ในหน้า Content Map</p>
        </div>
      )}
    </div>
  )
}
