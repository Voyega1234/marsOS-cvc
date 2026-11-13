"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { EmptyState, KpiTile, Panel, SearchPill, downloadCsv } from "@/components/ds";

interface Row {
  id: string;
  title: string;
  slug: string | null;
  status: string;
  wordpressUrl: string | null;
  keyword: { keyword: string } | null;
  updatedAt: string;
  funnelStage?: string | null;
}

function safeUrl(u: string | null): string | null {
  if (!u) return null;
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? p.toString() : null;
  } catch {
    return null;
  }
}

const fmt = (iso: string) => {
  try { return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }); } catch { return iso; }
};

function StatusChip({ status }: { status: string }) {
  return status === "POSTED"
    ? <span className="chip chip-ok">เผยแพร่แล้ว</span>
    : <span className="chip chip-muted">ฉบับร่างบนเว็บไซต์</span>;
}

export default function ClientPublishedTab({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setRows(null);
    setError("");
    try {
      const res = await fetch(`/api/articles/published?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const list: Row[] = Array.isArray(data) ? data : Array.isArray(data?.articles) ? data.articles : [];
      setRows(list.filter((r) => safeUrl(r.wordpressUrl)));
    } catch {
      setError("โหลดรายการไม่สำเร็จ กรุณาลองอีกครั้ง");
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!rows) return [];
    if (!s) return rows;
    return rows.filter((r) => r.title.toLowerCase().includes(s) || (r.keyword?.keyword ?? "").toLowerCase().includes(s));
  }, [rows, q]);

  const stats = useMemo(() => {
    const all = rows ?? [];
    const now = new Date();
    const month = all.filter((r) => {
      const d = new Date(r.updatedAt);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
    const latest = all.reduce<string | null>((m, r) => (!m || r.updatedAt > m ? r.updatedAt : m), null);
    return { total: all.length, month, latest };
  }, [rows]);

  const exportCsv = () => {
    downloadCsv("published-articles.csv", [
      ["บทความ", "คีย์เวิร์ด", "วันที่", "สถานะ", "ลิงก์"],
      ...filtered.map((r) => [r.title, r.keyword?.keyword ?? "", fmt(r.updatedAt), r.status === "POSTED" ? "เผยแพร่แล้ว" : "ฉบับร่างบนเว็บไซต์", safeUrl(r.wordpressUrl)]),
    ]);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile label="เผยแพร่แล้วทั้งหมด" value={stats.total} tone="blue" />
        <KpiTile label="เผยแพร่เดือนนี้" value={stats.month} tone="sky" />
        <KpiTile label="เผยแพร่ล่าสุด" value={stats.latest ? fmt(stats.latest) : "-"} tone="mist" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchPill value={q} onChange={setQ} placeholder="ค้นหาชื่อบทความหรือคีย์เวิร์ด" className="min-w-0 flex-1" />
        <button type="button" onClick={() => void load()} className="btn-secondary inline-flex items-center gap-1.5" aria-label="รีเฟรช">
          <RefreshCw className="h-4 w-4" /> รีเฟรช
        </button>
        <button type="button" onClick={exportCsv} disabled={filtered.length === 0} className="btn-secondary disabled:opacity-50">Export CSV</button>
      </div>

      {error ? (
        <Panel>
          <EmptyState title={error} action={<button type="button" onClick={() => void load()} className="btn-primary">ลองอีกครั้ง</button>} />
        </Panel>
      ) : rows === null ? (
        <Panel>
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded-xl bg-gray-100" />)}
          </div>
        </Panel>
      ) : filtered.length === 0 ? (
        <Panel>
          <EmptyState title="ยังไม่มีบทความที่เผยแพร่" description="เมื่อทีมงานเผยแพร่บทความบนเว็บไซต์ของคุณ จะแสดงที่นี่" />
        </Panel>
      ) : (
        <>
          <div className="hidden md:block">
            <Panel padded={false}>
              <div className="overflow-x-auto">
                <table className="tbl min-w-[640px] w-full">
                  <thead>
                    <tr><th>บทความ</th><th>คีย์เวิร์ด</th><th>วันที่</th><th>สถานะ</th><th /></tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id}>
                        <td className="max-w-[320px] font-medium text-brand-navy">{r.title}</td>
                        <td>{r.keyword?.keyword ?? "-"}</td>
                        <td className="whitespace-nowrap">{fmt(r.updatedAt)}</td>
                        <td><StatusChip status={r.status} /></td>
                        <td>
                          <a href={safeUrl(r.wordpressUrl) ?? "#"} target="_blank" rel="noopener noreferrer" className="btn-secondary whitespace-nowrap">เปิดดู</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
          <div className="space-y-3 md:hidden">
            {filtered.map((r) => (
              <div key={r.id} className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-sm">
                <div className="font-medium text-brand-navy">{r.title}</div>
                {r.keyword && <div className="mt-1 text-xs text-gray-500">{r.keyword.keyword}</div>}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><StatusChip status={r.status} /><span className="text-xs text-gray-500">{fmt(r.updatedAt)}</span></div>
                  <a href={safeUrl(r.wordpressUrl) ?? "#"} target="_blank" rel="noopener noreferrer" className="btn-secondary whitespace-nowrap">เปิดดู</a>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
