"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FunnelBadge } from "@/components/shared/FunnelBadge";
import { LoadingSpinner } from "@/components/shared/LoadingState";
import { Search, Plus } from "lucide-react";
import type { Keyword } from "@/types";

interface Props {
  projectId: string;
  keywords: Keyword[];
  userId: string;
}

export function KeywordResearchPanel({ projectId, keywords, userId }: Props) {
  const router = useRouter();
  const [seedKeyword, setSeedKeyword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    if (!seedKeyword.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/ai/keyword-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, seedKeyword }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("สร้าง Keyword Research สำเร็จ!");
      setSeedKeyword("");
      router.refresh();
    } catch {
      toast.error("เกิดข้อผิดพลาดในการวิจัย Keyword");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border">
      <div className="p-5 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Keyword Research</h2>
        <span className="text-sm text-gray-500">{keywords.length} keywords</span>
      </div>

      {/* Input */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="ใส่ seed keyword เช่น วีซ่าเชงเก้น..."
              value={seedKeyword}
              onChange={(e) => setSeedKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              className="pl-9"
            />
          </div>
          <Button onClick={handleGenerate} disabled={loading || !seedKeyword.trim()} className="gap-2 whitespace-nowrap">
            {loading ? <><LoadingSpinner className="border-white" />กำลังวิจัย...</> : <><Plus className="h-4 w-4" />วิจัย Keyword</>}
          </Button>
        </div>
      </div>

      {/* Keywords list */}
      {keywords.length === 0 ? (
        <div className="p-8 text-center text-gray-400 text-sm">
          ยังไม่มี keyword — กรอก seed keyword ด้านบนเพื่อเริ่มต้น
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left p-3 font-medium text-gray-600">Keyword</th>
                <th className="text-left p-3 font-medium text-gray-600">Funnel</th>
                <th className="text-left p-3 font-medium text-gray-600">Intent</th>
                <th className="text-right p-3 font-medium text-gray-600">Volume</th>
                <th className="text-right p-3 font-medium text-gray-600">Difficulty</th>
              </tr>
            </thead>
            <tbody>
              {keywords.map((kw) => (
                <tr key={kw.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="p-3">
                    <div>
                      <p className="font-medium text-gray-900">{kw.keyword}</p>
                      <p className="text-xs text-gray-400">จาก: {kw.seedKeyword}</p>
                    </div>
                  </td>
                  <td className="p-3"><FunnelBadge stage={kw.funnelStage} /></td>
                  <td className="p-3 text-gray-600">{kw.intent}</td>
                  <td className="p-3 text-right text-gray-900">{kw.volume?.toLocaleString() ?? "—"}</td>
                  <td className="p-3 text-right">
                    <span className={`font-medium ${(kw.difficulty ?? 0) > 50 ? "text-red-600" : (kw.difficulty ?? 0) > 30 ? "text-yellow-600" : "text-green-600"}`}>
                      {kw.difficulty ?? "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
