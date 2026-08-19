"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Drawer, ErrorBanner, StatusBadge } from "./shared";
import type { PromptRow } from "./types";
import { CE_TYPES, tryParse } from "./types";

interface Props {
  items: PromptRow[];
}

const LAYER_LABEL: Record<string, string> = {
  [CE_TYPES.BUSINESS_SKILL]: "Business Skill",
  [CE_TYPES.MASTER_PROMPT]: "Master Prompt",
  [CE_TYPES.ARTICLE_BRIEF]: "Article Brief Template",
  [CE_TYPES.VALIDATOR_PACK]: "Validator Pack",
  [CE_TYPES.IMAGE_PROMPT]: "Image Prompt",
};

interface VersionEntry {
  id: string;
  versionNumber: number;
  changeNote: string | null;
  createdAt: string;
  createdBy?: { name: string | null; email: string } | null;
}

export function VersionsAuditTab({ items }: Props) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  async function openVersions(item: PromptRow) {
    setOpenId(item.id);
    setLoading(true);
    setError(null);
    setVersions([]);
    try {
      const res = await fetch(`/api/prompts/${item.id}/versions`);
      if (!res.ok) throw new Error(`โหลด versions ไม่สำเร็จ (${res.status})`);
      const data = await res.json();
      setVersions(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function restore(versionId: string) {
    if (!openId) return;
    if (!confirm("Restore เวอร์ชันนี้? ระบบจะบันทึก snapshot ปัจจุบันไว้ก่อน")) return;
    setRestoring(versionId);
    setError(null);
    try {
      const res = await fetch(`/api/prompts/${openId}/versions/${versionId}/restore`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Restore ไม่สำเร็จ (${res.status})`);
      }
      toast.success("Restore เวอร์ชันแล้ว");
      setOpenId(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRestoring(null);
    }
  }

  const openItem = items.find((i) => i.id === openId) ?? null;

  return (
    <div className="space-y-3">
      <ErrorBanner message={error && !openId ? error : null} />
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Layer</th>
              <th className="px-3 py-2">Version</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Updated At</th>
              <th className="px-3 py-2">Updated By</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">ยังไม่มีข้อมูล Content Engine</td>
              </tr>
            )}
            {items.map((item) => {
              const parsed = tryParse<{ status?: string }>(item.promptText);
              return (
                <tr key={item.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-3 py-2 font-medium text-brand-navy">{item.name}</td>
                  <td className="px-3 py-2 text-gray-600">{LAYER_LABEL[item.type] ?? item.type}</td>
                  <td className="px-3 py-2 text-gray-600">v{item.version}</td>
                  <td className="px-3 py-2">
                    {parsed?.status ? <StatusBadge status={parsed.status} /> : item.isActive ? <StatusBadge status="Active" /> : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{new Date(item.updatedAt).toLocaleString("th-TH")}</td>
                  <td className="px-3 py-2 text-gray-500">{item.editorName ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openVersions(item)}>
                      <History className="size-3.5" /> ดู Versions
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Drawer open={!!openId} onClose={() => setOpenId(null)} title={openItem ? `Versions · ${openItem.name}` : "Versions"}>
        <ErrorBanner message={error} />
        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : versions.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">ยังไม่มี snapshot version สำหรับรายการนี้</p>
        ) : (
          <div className="space-y-2">
            {versions.map((v) => (
              <div key={v.id} className="rounded-lg border border-gray-100 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-brand-navy">v{v.versionNumber}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={restoring !== null}
                    onClick={() => restore(v.id)}
                  >
                    {restoring === v.id ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                    Restore
                  </Button>
                </div>
                <p className="mt-1 text-xs text-gray-500">{v.changeNote || "ไม่มี change note"}</p>
                <p className="mt-1 text-[11px] text-gray-400">
                  {new Date(v.createdAt).toLocaleString("th-TH")} · {v.createdBy?.name ?? v.createdBy?.email ?? "—"}
                </p>
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}
