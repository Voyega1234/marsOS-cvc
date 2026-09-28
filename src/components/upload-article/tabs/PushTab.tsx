"use client";

/** แท็บ Push — สแกนเว็บปลายทาง เลือก card ที่จะขึ้นเว็บ แล้ว push ทีละบทความหรือหลายบทความพร้อมกัน */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Globe, RefreshCw, ExternalLink, Send, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UploadArticleDTO, UploadClientDTO } from "@/lib/upload-article/types";
import { parseArticleCards, assembleArticleHtml, type ParsedArticle } from "@/lib/articleCards";
import UploadStatusBadge from "@/components/upload-article/shared/StatusBadge";

const PUSHABLE = new Set(["GENERATED", "REVIEWED", "PUSHED", "FAILED"]);

type ScanSignal = { found: boolean; where: string | null; evidence: string };
type ScanResult = { target: string; checked: string[]; found: { toc: ScanSignal; cta: ScanSignal; faq: ScanSignal } };

export default function PushTab({
  client, articles, loadArticleDetail, articleDetails, applyArticleUpdate, selectedId, setSelectedId, goToConnect,
}: {
  client: UploadClientDTO;
  articles: UploadArticleDTO[];
  loadArticleDetail: (id: string, force?: boolean) => Promise<UploadArticleDTO | null>;
  articleDetails: Record<string, UploadArticleDTO>;
  applyArticleUpdate: (a: UploadArticleDTO) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  goToConnect: () => void;
}) {
  const pushable = useMemo(() => articles.filter(a => PUSHABLE.has(a.status)), [articles]);

  const [publishMode, setPublishMode] = useState<"draft" | "publish">(client.pushPrefs.publishMode ?? "draft");
  const [wpPostType, setWpPostType] = useState<"post" | "page">(client.pushPrefs.wpPostType ?? "post");
  const [useElementor, setUseElementor] = useState(!!client.pushPrefs.useElementor);
  const [stripH1, setStripH1] = useState(client.pushPrefs.stripH1 !== false);

  const [scanState, setScanState] = useState<"idle" | "scanning" | "done" | "error">("idle");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState("");

  const [cardSel, setCardSel] = useState<Record<string, Record<string, boolean>>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pushBusy, setPushBusy] = useState<Record<string, boolean>>({});
  const [pushResult, setPushResult] = useState<Record<string, { ok: boolean; postUrl?: string; error?: string }>>({});

  // ดึงรายละเอียด htmlContent ของบทความที่ push ได้ทั้งหมด เพื่อแตก card
  useEffect(() => {
    for (const a of pushable) if (!articleDetails[a.id]) void loadArticleDetail(a.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushable.map(a => a.id).join("|")]);

  const parsedMap = useMemo(() => {
    const map = new Map<string, ParsedArticle>();
    for (const a of pushable) {
      const detail = articleDetails[a.id];
      if (detail?.htmlContent) map.set(a.id, parseArticleCards(detail.htmlContent));
    }
    return map;
  }, [pushable, articleDetails]);

  const notConnected = client.websitePlatform === "wordpress" ? !client.hasWpPassword || !client.wpUrl : !client.wpUrl;

  function isCardOn(articleId: string, cardId: string): boolean {
    const parsed = parsedMap.get(articleId);
    const card = parsed?.cards.find(c => c.id === cardId);
    if (!card) return false;
    const explicit = cardSel[articleId]?.[cardId];
    if (explicit !== undefined) return explicit;
    if (client.pushPrefs.excludeCards?.[card.type as "toc" | "cta" | "faq"]) return false;
    return !card.derived;
  }

  function toggleCard(articleId: string, cardId: string) {
    setCardSel(prev => ({ ...prev, [articleId]: { ...(prev[articleId] ?? {}), [cardId]: !isCardOn(articleId, cardId) } }));
  }

  function htmlForPush(articleId: string, originalHtml: string): string {
    const parsed = parsedMap.get(articleId);
    if (!parsed) return originalHtml;
    const ids = new Set(parsed.cards.filter(c => isCardOn(articleId, c.id)).map(c => c.id));
    return assembleArticleHtml(parsed, ids);
  }

  async function handleScanSite() {
    setScanState("scanning"); setScanError("");
    try {
      const siteUrl = client.wpUrl || client.website;
      const r = await fetch("/api/push/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteUrl }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) { setScanState("error"); setScanError(d?.error || "สแกนไม่สำเร็จ"); return; }
      setScanResult(d); setScanState("done");
      const dupTypes = (["toc", "cta", "faq"] as const).filter(t => d.found?.[t]?.found);
      if (dupTypes.length) {
        setCardSel(prev => {
          const next = { ...prev };
          for (const a of pushable) {
            const parsed = parsedMap.get(a.id);
            if (!parsed) continue;
            const patch: Record<string, boolean> = { ...(next[a.id] ?? {}) };
            for (const c of parsed.cards) if ((dupTypes as readonly string[]).includes(c.type)) patch[c.id] = false;
            next[a.id] = patch;
          }
          return next;
        });
      }
    } catch (e) {
      setScanState("error"); setScanError(e instanceof Error ? e.message : String(e));
    }
  }

  async function pushOne(articleId: string) {
    const detail = articleDetails[articleId] || await loadArticleDetail(articleId, true);
    if (!detail?.htmlContent) { toast.error("บทความนี้ยังไม่มี HTML"); return; }
    setPushBusy(prev => ({ ...prev, [articleId]: true }));
    setPushResult(prev => { const n = { ...prev }; delete n[articleId]; return n; });
    try {
      const html = htmlForPush(articleId, detail.htmlContent);
      const r = await fetch(`/api/upload-article/articles/${articleId}/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, publishMode, useElementor, wpPostType, stripH1 }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) {
        setPushResult(prev => ({ ...prev, [articleId]: { ok: false, error: d?.error || "Push ไม่สำเร็จ" } }));
        toast.error(`Push ไม่สำเร็จ: ${d?.error || r.status}`);
      } else {
        setPushResult(prev => ({ ...prev, [articleId]: { ok: true, postUrl: d.postUrl } }));
        toast.success("Push สำเร็จ");
      }
      await loadArticleDetail(articleId, true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPushResult(prev => ({ ...prev, [articleId]: { ok: false, error: msg } }));
      toast.error(`Push ไม่สำเร็จ: ${msg}`);
    } finally {
      setPushBusy(prev => ({ ...prev, [articleId]: false }));
    }
  }

  async function pushSelected() {
    for (const id of Array.from(selectedIds)) await pushOne(id);
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-brand-navy flex items-center gap-1.5">
              <Globe size={14} /> {client.websitePlatform} · {client.wpUrl || client.website || "ยังไม่ตั้งเว็บ"}
            </p>
            {notConnected && (
              <button onClick={goToConnect} className="text-xs text-rose-600 hover:underline flex items-center gap-1 mt-1">
                <AlertTriangle size={11} /> ยังไม่เชื่อมต่อเว็บ — ไปตั้งค่าที่ Connect Website
              </button>
            )}
          </div>
          <Button variant="outline" size="sm" disabled={scanState === "scanning"} onClick={handleScanSite}>
            {scanState === "scanning" ? <RefreshCw size={12} className="animate-spin mr-1.5" /> : null}
            สแกนเว็บปลายทาง
          </Button>
        </div>
        {scanState === "error" && <p className="text-xs text-rose-500">{scanError}</p>}
        {scanState === "done" && scanResult && (
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            {(["toc", "cta", "faq"] as const).map(k => (
              <div key={k} className={`rounded-lg px-2.5 py-1.5 ${scanResult.found[k]?.found ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                <p className="font-semibold uppercase">{k}</p>
                <p>{scanResult.found[k]?.found ? `พบแล้ว (${scanResult.found[k]?.where})` : "ไม่พบ"}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-4 text-xs pt-1">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={publishMode === "draft"} onChange={() => setPublishMode("draft")} /> Draft
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={publishMode === "publish"} onChange={() => setPublishMode("publish")} /> Publish
          </label>
          <span className="text-gray-300">|</span>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={wpPostType === "post"} onChange={() => setWpPostType("post")} /> Post
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={wpPostType === "page"} onChange={() => setWpPostType("page")} /> Page
          </label>
          <span className="text-gray-300">|</span>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={useElementor} onChange={e => setUseElementor(e.target.checked)} /> Elementor
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={stripH1} onChange={e => setStripH1(e.target.checked)} /> ตัด H1
          </label>
        </div>

        <Button size="sm" disabled={!selectedIds.size} onClick={pushSelected}>
          <Send size={12} className="mr-1.5" /> Push ที่เลือก ({selectedIds.size})
        </Button>
      </div>

      <div className="space-y-3">
        {pushable.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-10 bg-white border border-gray-200 rounded-xl">ยังไม่มีบทความที่พร้อม Push (ต้อง Generate ก่อน)</p>
        )}
        {pushable.map(a => {
          const parsed = parsedMap.get(a.id);
          const result = pushResult[a.id];
          const busy = !!pushBusy[a.id];
          return (
            <div key={a.id} className="bg-white border border-gray-200 rounded-xl p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <label className="flex items-start gap-2 min-w-0">
                  <input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => toggleSelect(a.id)} className="mt-1" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-brand-navy truncate">{a.title}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <UploadStatusBadge status={a.status} />
                    </div>
                  </div>
                </label>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => pushOne(a.id)}>
                  {busy ? "กำลัง Push..." : "Push"}
                </Button>
              </div>

              {parsed && (
                <div className="flex flex-wrap gap-1.5">
                  {parsed.cards.map(c => (
                    <label key={c.id} className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] cursor-pointer ${isCardOn(a.id, c.id) ? "bg-brand-mist/40 border-brand-blue/40 text-brand-navy" : "bg-gray-50 border-gray-200 text-gray-400"}`}>
                      <input type="checkbox" checked={isCardOn(a.id, c.id)} onChange={() => toggleCard(a.id, c.id)} className="scale-90" />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}

              {result && (
                result.ok ? (
                  <a href={result.postUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-emerald-600 hover:underline w-fit">
                    <ExternalLink size={11} /> เปิดโพสต์ที่ push แล้ว
                  </a>
                ) : (
                  <p className="text-xs text-rose-500">{result.error}</p>
                )
              )}
              {!result && a.status === "FAILED" && a.pushError && <p className="text-xs text-rose-500">{a.pushError}</p>}
              {!result && a.status === "PUSHED" && a.wordpressUrl && (
                <a href={a.wordpressUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-emerald-600 hover:underline w-fit">
                  <ExternalLink size={11} /> เปิดโพสต์ที่ push แล้ว
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
