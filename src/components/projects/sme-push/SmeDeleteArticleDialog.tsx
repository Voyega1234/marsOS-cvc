'use client'

/** ยืนยันลบแถวบทความ SEO SME (แท็บ Push) — ลบเฉพาะแถวในระบบ ไม่ลบโพสต์บนเว็บไซต์
 * รูปแบบเดียวกับ Upload Article (components/upload-article/shared/DeleteArticleDialog) แต่ใช้ DELETE /api/articles/[id]
 * ตาราง Article ของ SME ไม่มี pushedAt จึงไม่มีป้าย "push ล่าสุด" */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { isSmeArticlePushed, smeDuplicatesOf } from '@/lib/sme-articles/duplicates'

/** ฟิลด์ขั้นต่ำที่ dialog ต้องใช้ — ฟิลด์ที่ไม่มีค่า normalize เป็น null/'' ก่อนเรียก helper */
type SmeDeletableArticle = {
  id: string
  title?: string | null
  slug?: string | null
  wordpressUrl?: string | null
  status?: string | null
}

export default function SmeDeleteArticleDialog<T extends SmeDeletableArticle>({
  article, allArticles, onClose, onDeleted,
}: {
  article: T
  allArticles: T[]
  onClose: () => void
  onDeleted: (id: string) => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const isPushed = isSmeArticlePushed({ wordpressUrl: article.wordpressUrl ?? null, status: article.status ?? null })
  const duplicates = useMemo(() => {
    const norm = <A extends SmeDeletableArticle>(a: A) => ({
      ...a, title: a.title ?? '', slug: a.slug ?? null, wordpressUrl: a.wordpressUrl ?? null,
    })
    return smeDuplicatesOf(norm(article), allArticles.map(norm))
  }, [article, allArticles])

  async function confirmDelete() {
    setDeleting(true)
    setError('')
    try {
      const r = await fetch(`/api/articles/${article.id}`, { method: 'DELETE' })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        // ลบไม่สำเร็จ — แสดงสาเหตุใน dialog และเปิดค้างไว้
        setError(d?.error || 'ลบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
        return
      }
      toast.success('ลบแถวบทความแล้ว')
      onDeleted(article.id)
      onClose()
    } catch (e) {
      setError(`ลบไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open onOpenChange={v => !v && !deleting && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>ลบบทความนี้?</DialogTitle></DialogHeader>
        <p className="text-sm text-gray-600">&quot;{article.title ?? ''}&quot; จะถูกลบออกจากระบบถาวร — ยืนยันหรือไม่?</p>
        <p className="text-xs text-gray-500">ลบเฉพาะแถวในระบบ — โพสต์บนเว็บไซต์จะไม่ถูกลบ</p>

        {isPushed && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            โพสต์นี้ขึ้นเว็บไซต์แล้ว และจะยังออนไลน์อยู่หลังลบแถว · ถ้า Push รายการนี้จาก Timeline อีกครั้ง
            ระบบจะสร้างแถวใหม่และอัปเดตโพสต์เดิม ตราบใดที่ slug ไม่เปลี่ยน
            {duplicates.length === 0 && (
              <> · หลังลบจะไม่มีแถวอื่นของโพสต์นี้ในระบบ ต้องแก้หรือลบโพสต์บนเว็บไซต์เอง</>
            )}
          </p>
        )}

        {duplicates.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-600">แถวซ้ำที่จะยังอยู่:</p>
            <ul className="max-h-56 space-y-1.5 overflow-y-auto">
              {duplicates.map(d => (
                <li key={d.id} className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600">
                  <p className="font-medium text-gray-700 break-words">{d.title || '(ไม่มีชื่อ)'}</p>
                  <p className="mt-0.5 text-gray-400 break-all">
                    {d.slug ? `slug: ${d.slug}` : d.wordpressUrl || '—'}
                    {d.slug && d.wordpressUrl ? ` · ${d.wordpressUrl}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

        <DialogFooter>
          <Button variant="outline" disabled={deleting} onClick={onClose}>ยกเลิก</Button>
          <Button variant="destructive" disabled={deleting} onClick={confirmDelete}>
            {deleting ? 'กำลังลบ...' : 'ลบบทความ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
