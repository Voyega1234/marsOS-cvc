"use client";

/** แท็บ Push — สแกนเว็บปลายทาง เลือก card ที่จะขึ้นเว็บ แล้ว push ทีละบทความหรือหลายบทความพร้อมกัน */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Globe, ExternalLink, Send, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UploadArticleDTO, UploadClientDTO } from "@/lib/upload-article/types";
import { parseUploadCards, assembleUploadHtml, type ParsedArticle } from "@/lib/upload-article/cards";
import UploadStatusBadge from "@/components/upload-article/shared/StatusBadge";
import SiteScanPanel from "@/components/upload-article/shared/SiteScanPanel";

const PUSHABLE = new Set(["GENERATED", "REVIEWED", "PUSHED", "FAILED"]);

const TYPE_CHIP: Record<string, { label: string; cls: string }> = {
  title: { label: "หัวเรื่อง", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  toc: { label: "สารบัญ", cls: "bg-purple-50 text-purple-700 border-purple-200" },
  content: { label: "เนื้อหา", cls: "bg-gray-50 text-gray-600 border-gray-200" },
  cta: { label: "CTA", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  faq: { label: "FAQ", cls: "bg-orange-50 text-orange-700 border-orange-200" },
};

export default function PushTab({
  client, setClient, articles, loadArticleDetail, articleDetails, applyArticleUpdate, selectedId, setSelectedId, goToConnect,
}: {
  client: UploadClientDTO;
  setClient: (c: UploadClientDTO) => void;
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

  const [cardSel, setCardSel] = useState<Record<string, Record<string, boolean>>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pushBusy, setPushBusy] = useState<Record<string, boolean>>({});
  const [pushResult, setPushResult] = useState<Record<string, { ok: boolean; postUrl?: string; error?: string }>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const siteScan = client.pushPrefs.siteScan;

  // ดึงรายละเอียด htmlContent ของบทความที่ push ได้ทั้งหมด เพื่อแตก card
  useEffect(() => {
    for (const a of pushable) if (!articleDetails[a.id]) void loadArticleDetail(a.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushable.map(a => a.id).join("|")]);

  const parsedMap = useMemo(() => {
    const map = new Map<string, ParsedArticle>();
    for (const a of pushable) {
      const detail = articleDetails[a.id];
      if (detail?.htmlContent) map.set(a.id, parseUploadCards(detail.htmlContent));
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
    return assembleUploadHtml(parsed, ids);
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
      <SiteScanPanel client={client} setClient={setClient} />

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
        </div>

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

              {!parsed && articleDetails[a.id] === undefined && (
                <p className="text-[11px] text-gray-400">กำลังโหลด card...</p>
              )}
              {parsed && (() => {
                const offCount = parsed.cards.filter(c => !isCardOn(a.id, c.id)).length;
                const isOpen = !collapsed[a.id];
                return (
                  <div className="border border-gray-100 rounded-lg">
                    <button onClick={() => setCollapsed(prev => ({ ...prev, [a.id]: isOpen }))} className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 hover:text-brand-navy">
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {parsed.cards.length} Cards{offCount ? ` (ไม่ push ${offCount})` : ""}
                    </button>
                    {isOpen && (
                      <div className="divide-y divide-gray-100 border-t border-gray-100">
                        {parsed.cards.map(c => {
                          const on = isCardOn(a.id, c.id);
                          const chip = TYPE_CHIP[c.type] ?? TYPE_CHIP.content;
                          const finding = c.type === "toc" || c.type === "faq" || c.type === "cta" ? siteScan?.components[c.type] : undefined;
                          const dup = finding?.where === "auto";
                          return (
                            <label key={c.id} className={`flex items-start gap-2 px-2.5 py-2 cursor-pointer ${on ? "" : "bg-gray-50/70"}`}>
                              <input type="checkbox" checked={on} onChange={() => toggleCard(a.id, c.id)} className="mt-0.5" />
                              <div className={`min-w-0 flex-1 ${on ? "" : "opacity-50"}`}>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold shrink-0 ${chip.cls}`}>{chip.label}</span>
                                  <span className="text-xs font-semibold text-brand-navy truncate">{c.label}</span>
                                </div>
                                {dup && (
                                  <p className="text-[10px] text-rose-600 mt-0.5 flex items-center gap-1">
                                    <AlertTriangle size={10} /> เว็บมีอยู่แล้ว{finding?.source ? ` (${finding.source})` : ""} — push ซ้ำจะซ้อนกัน
                                  </p>
                                )}
                                {c.plainText && <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{c.plainText}</p>}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

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
