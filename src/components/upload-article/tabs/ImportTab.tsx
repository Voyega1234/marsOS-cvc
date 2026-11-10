"use client";

/** แท็บ "นำเข้าบทความ" — drop zone / วางข้อความ / ลิงก์ Google Doc + ตารางบทความของลูกค้านี้ */
import { useState } from "react";
import { toast } from "sonner";
import { Trash2, CheckCircle2, Lock } from "lucide-react";
import type { UploadArticleDTO, UploadClientDTO } from "@/lib/upload-article/types";
import { canDeleteArticle } from "@/lib/upload-article/duplicates";
import ImportBox from "@/components/upload-article/shared/ImportBox";
import UploadStatusBadge from "@/components/upload-article/shared/StatusBadge";
import DeleteArticleDialog from "@/components/upload-article/shared/DeleteArticleDialog";
import ArticleOwnerSelect, { type OwnerControls } from "@/components/upload-article/ArticleOwnerSelect";

const SOURCE_LABEL: Record<string, string> = {
  docx: "Word (.docx)", txt: "Text (.txt)", md: "Markdown", html: "HTML",
  gdoc: "Google Doc", gdrive: "Google Drive", paste: "วางข้อความ",
};

export default function ImportTab({
  client, articles, allArticles, selectedId, setSelectedId, refreshArticles, refreshClient, removeArticle, owners, pbn = false,
}: {
  client: UploadClientDTO;
  articles: UploadArticleDTO[];
  /** ทุกแถวของลูกค้านี้ (รวมที่กำลังเขียน) — ใช้หาบทความซ้ำก่อนลบ */
  allArticles: UploadArticleDTO[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  refreshArticles: () => Promise<void>;
  refreshClient: () => Promise<void>;
  removeArticle: (id: string) => void;
  /** ผู้ดูแลบทความ (ไม่ส่ง = ไม่แสดง dropdown) */
  owners?: OwnerControls;
  /** PBN Backlinks: แถวที่ push แล้วลบไม่ได้ */
  pbn?: boolean;
}) {
  const [deleteTarget, setDeleteTarget] = useState<UploadArticleDTO | null>(null);

  return (
    <div className="space-y-4">
      <ImportBox clientId={client.id} endpoint="articles"
        onImported={async () => { await refreshArticles(); await refreshClient(); }} />

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-semibold text-brand-navy">บทความของลูกค้านี้ ({articles.length})</p>
        </div>
        {articles.length === 0 ? (
          <div className="py-14 text-center text-sm text-gray-400">ยังไม่มีบทความ — ลากไฟล์หรือวางข้อความด้านบนเพื่อเริ่ม</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">ชื่อบทความ</th>
                <th className="hidden xl:table-cell text-left px-4 py-2.5 text-xs font-semibold text-gray-500">แหล่งที่มา</th>
                <th className="hidden xl:table-cell text-left px-4 py-2.5 text-xs font-semibold text-gray-500">คำ</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">สถานะ</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">อัปเดตล่าสุด</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {articles.map(a => (
                <tr key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={`cursor-pointer hover:bg-gray-50/60 transition-colors ${selectedId === a.id ? "bg-brand-mist/40" : ""}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-brand-navy truncate max-w-[16rem] xl:max-w-sm flex items-center gap-1.5">
                        {selectedId === a.id && <CheckCircle2 size={12} className="text-brand-blue shrink-0" />}
                        {a.title}
                      </div>
                      {owners && (
                        <ArticleOwnerSelect articleId={a.id} ownerTags={owners.ownerTags} ownerTagId={owners.articleOwners[a.id]}
                          onChange={owners.onOwnerChange} goToReport={owners.goToReport} />
                      )}
                    </div>
                  </td>
                  <td className="hidden xl:table-cell px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{SOURCE_LABEL[a.sourceType] ?? a.sourceType}</td>
                  <td className="hidden xl:table-cell px-4 py-3 text-xs text-gray-500">{a.wordCount.toLocaleString("th-TH")}</td>
                  <td className="px-4 py-3 whitespace-nowrap"><UploadStatusBadge status={a.status} /></td>
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                    {new Date(a.updatedAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!canDeleteArticle(a, pbn) ? (
                      <span title="บทความ PBN ที่ขึ้นเว็บไซต์แล้ว — ลบไม่ได้" className="inline-flex p-1.5 text-gray-300">
                        <Lock size={13} />
                      </span>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); setDeleteTarget(a); }}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <DeleteArticleDialog
        article={deleteTarget}
        allArticles={allArticles}
        onClose={() => setDeleteTarget(null)}
        onDeleted={id => { removeArticle(id); void refreshClient(); }}
      />
    </div>
  );
}
