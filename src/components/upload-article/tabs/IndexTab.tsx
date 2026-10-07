"use client";

/**
 * แท็บ Request Index — บทความที่ขึ้นเว็บแล้ว: URL, ส่ง Request Index ไปเมื่อไหร่ (ผลล่าสุด),
 * performance จาก GSC และกด Request Index ใหม่ได้ทีละบทความหรือหลายบทความ (ตารางกลาง RequestIndexTable)
 * Upload: 1 แถวต่อบทความ (GSC เว็บเดียวกับแท็บ Report)
 * PBN: 1 แถวต่อบทความต่อเว็บที่ push ไป (GSC ของแต่ละเว็บ) — key = `${articleId}::${siteId}`
 */
import { useCallback, useMemo } from "react";
import type { UploadArticleDTO, UploadClientDTO } from "@/lib/upload-article/types";
import { uploadPlatformOf } from "@/lib/upload-article/platform-info";
import { usePbnSites } from "@/components/upload-article/pbn/usePbnSites";
import RequestIndexTable, { type IndexPerfResult, type IndexRecord, type IndexTableRow } from "@/components/shared/RequestIndexTable";

const SEP = "::";

export default function IndexTab({
  client, setClient, articles, loadArticleDetail, goToReport, onOpenPbnSites, pbn = false,
}: {
  client: UploadClientDTO;
  setClient: (c: UploadClientDTO) => void;
  articles: UploadArticleDTO[];
  loadArticleDetail: (id: string, force?: boolean) => Promise<UploadArticleDTO | null>;
  goToReport: () => void;
  /** PBN: เปิดหน้าตั้งค่าเว็บ PBN (ตั้ง GSC ต่อเว็บ) */
  onOpenPbnSites?: () => void;
  pbn?: boolean;
}) {
  const { sites, pushes } = usePbnSites(pbn);

  const rows = useMemo<IndexTableRow[]>(() => {
    const pushed = articles.filter(a => a.status === "PUSHED");
    if (!pbn) {
      // ปุ่มกดได้ตามเงื่อนไขเดียวกับแท็บ Push — WordPress route เช็คสถานะจริงให้, แพลตฟอร์มอื่นต้อง push แบบ Publish
      return pushed.map(a => {
        const isWp = uploadPlatformOf(client) === "wordpress";
        const modeOk = isWp || a.pushMode === "publish";
        const hasUrl = isWp || !!a.wordpressUrl;
        const canRequest = modeOk && hasUrl;
        return { key: a.id, title: a.title, url: a.wordpressUrl || "", canRequest, blockedReason: canRequest ? undefined : !modeOk ? "ต้อง Push แบบ Publish ก่อน" : "ไม่มีลิงก์บทความจากเว็บปลายทาง" };
      });
    }
    const out: IndexTableRow[] = [];
    for (const a of pushed) {
      for (const [siteId, rec] of Object.entries(pushes[a.id] ?? {})) {
        const site = sites.find(s => s.id === siteId);
        out.push({
          key: `${a.id}${SEP}${siteId}`,
          title: a.title,
          sub: site ? site.name : "เว็บที่ถูกลบไปแล้ว",
          url: rec.url || "",
          canRequest: !!site && !!rec.url,
          blockedReason: !site ? "ไม่พบเว็บ" : "ไม่มีลิงก์",
        });
      }
    }
    return out;
  }, [articles, pbn, pushes, sites, client.websitePlatform]);

  const records = useMemo<Record<string, IndexRecord | undefined>>(() => {
    if (!pbn) return client.pushPrefs.indexRequests ?? {};
    const flat: Record<string, IndexRecord> = {};
    for (const [articleId, bySite] of Object.entries(client.pushPrefs.pbnIndexRequests ?? {})) {
      for (const [siteId, rec] of Object.entries(bySite)) flat[`${articleId}${SEP}${siteId}`] = rec;
    }
    return flat;
  }, [pbn, client.pushPrefs.indexRequests, client.pushPrefs.pbnIndexRequests]);

  const loadPerf = useCallback(async (days: number): Promise<IndexPerfResult> => {
    const r = await fetch(`/api/upload-article/clients/${client.id}/index-report`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { error: d?.error || `HTTP ${r.status}`, needSetup: !!d?.needSetup };
    return { rows: d.rows ?? {}, period: d.period, warning: d.warning };
  }, [client.id]);

  const onRequest = useCallback(async (key: string) => {
    const [articleId, siteId] = key.split(SEP);
    const r = await fetch(`/api/upload-article/articles/${articleId}/request-index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(siteId ? { siteId } : {}),
    });
    const d = await r.json().catch(() => ({}));
    if (d.client) setClient(d.client);
    if (!pbn && (r.ok || d.indexRequest)) await loadArticleDetail(articleId, true);
    return { ok: r.ok && !!d.ok, error: d?.error || (r.ok ? undefined : `HTTP ${r.status}`) };
  }, [pbn, setClient, loadArticleDetail]);

  return (
    <RequestIndexTable
      rows={rows}
      records={records}
      loadPerf={loadPerf}
      onRequest={onRequest}
      setupLabel={pbn ? "ไปตั้งค่าเว็บ PBN" : "ไปแท็บ Report"}
      onSetup={pbn ? onOpenPbnSites : goToReport}
      emptyText="ยังไม่มีบทความที่ขึ้นเว็บ — Push บทความก่อน แล้วค่อย Request Index ที่นี่"
    />
  );
}
