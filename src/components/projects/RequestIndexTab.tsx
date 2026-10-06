"use client";

/**
 * แท็บ Request Index ของ SEO SME — บทความที่ขึ้นเว็บแล้ว: ส่ง URL ให้ Google (Indexing API)
 * ดูผลล่าสุด + performance จาก GSC (เว็บ GSC ของโปรเจกต์) ใช้ตารางกลางร่วมกับ Upload Article
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import RequestIndexTable, { type IndexPerfResult, type IndexRecord, type IndexTableRow } from "@/components/shared/RequestIndexTable";

type ArticleLite = { id: string; title?: string; wordpressUrl?: string | null; status?: string };

export default function RequestIndexTab({ projectId }: { projectId: string }) {
  const [articles, setArticles] = useState<ArticleLite[]>([]);
  const [records, setRecords] = useState<Record<string, IndexRecord>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(`/api/articles?projectId=${projectId}`).then(r => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`/api/projects/${projectId}`).then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([arts, proj]) => {
      if (!alive) return;
      setArticles(Array.isArray(arts) ? arts : []);
      try {
        const pp = JSON.parse(proj?.pushPrefs || "{}");
        if (pp.indexRequests && typeof pp.indexRequests === "object") setRecords(pp.indexRequests);
      } catch { /* ไม่มีผลเดิม */ }
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [projectId]);

  const rows: IndexTableRow[] = useMemo(() => articles
    .filter(a => a.wordpressUrl && (a.status === "POSTED" || a.status === "WORDPRESS_DRAFTED"))
    .map(a => ({ key: a.id, title: a.title ?? "", url: a.wordpressUrl as string, canRequest: true })),
  [articles]);

  const loadPerf = useCallback(async (days: number): Promise<IndexPerfResult> => {
    try {
      const r = await fetch(`/api/projects/${projectId}/index-report`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return { error: d?.error || `HTTP ${r.status}`, needSetup: !!d?.needSetup };
      return { rows: d.rows, period: d.period };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [projectId]);

  const onRequest = useCallback(async (key: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const r = await fetch(`/api/projects/${projectId}/request-index`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ articleId: key }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.indexRequests) setRecords(d.indexRequests);
      return { ok: r.ok && !!d.ok, error: d?.error };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [projectId]);

  if (!loaded) return <p className="text-sm text-gray-400 py-8 text-center">กำลังโหลด…</p>;

  return (
    <RequestIndexTable
      rows={rows}
      records={records}
      loadPerf={loadPerf}
      onRequest={onRequest}
      emptyText="ยังไม่มีบทความที่ขึ้นเว็บ — Push บทความก่อน"
    />
  );
}
