"use client";

/** แท็บ Publish — ดูรายการที่ push แล้ว (สำเร็จ/ไม่สำเร็จ) */
import { Globe, ExternalLink, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UploadArticleDTO } from "@/lib/upload-article/types";
import UploadStatusBadge from "@/components/upload-article/shared/StatusBadge";

export default function PublishTab({
  articles, goToPush,
}: {
  articles: UploadArticleDTO[];
  goToPush: (id: string) => void;
}) {
  const list = articles.filter(a => a.status === "PUSHED" || a.status === "FAILED");

  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center bg-white border border-gray-200 rounded-xl">
        <Globe size={32} className="text-gray-200" />
        <p className="text-gray-400 text-sm">ยังไม่มีบทความที่ Push</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">ชื่อบทความ</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">สถานะ</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">โหมด</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Push เมื่อ</th>
            <th className="px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {list.map(a => (
            <tr key={a.id} className="hover:bg-gray-50/60">
              <td className="px-4 py-3">
                <p className="font-medium text-brand-navy truncate max-w-sm">{a.title}</p>
                {a.status === "FAILED" && a.pushError && <p className="text-[11px] text-rose-500 mt-0.5">{a.pushError}</p>}
              </td>
              <td className="px-4 py-3"><UploadStatusBadge status={a.status} /></td>
              <td className="px-4 py-3 text-xs">
                {a.pushMode && (
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${a.pushMode === "publish" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-brand-blue"}`}>
                    {a.pushMode === "publish" ? "Publish" : "Draft"}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-gray-400">
                {a.pushedAt ? new Date(a.pushedAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2">
                  {a.wordpressUrl && (
                    <a href={a.wordpressUrl} target="_blank" rel="noopener noreferrer" className="text-brand-blue hover:underline text-xs flex items-center gap-1">
                      <ExternalLink size={11} /> เปิด
                    </a>
                  )}
                  <Button size="sm" variant="outline" onClick={() => goToPush(a.id)}>
                    <RotateCcw size={11} className="mr-1" /> Push ซ้ำ
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
