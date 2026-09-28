"use client";

/** แท็บ Push — เลือก card ที่จะขึ้นเว็บ แล้ว push ทีละบทความหรือหลายบทความพร้อมกัน
 * (การสแกนเว็บปลายทางย้ายไปอยู่ที่ Project Setting > สแกนเว็บปลายทาง แล้ว) */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Globe, ExternalLink, Send, AlertTriangle, ChevronDown, ChevronRight, Settings, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UploadArticleDTO, UploadClientDTO } from "@/lib/upload-article/types";
import { parseUploadCards, uploadHtmlVersion, type ParsedArticle } from "@/lib/upload-article/cards";
import UploadStatusBadge from "@/components/upload-article/shared/StatusBadge";
import { formatPublishAt } from "@/components/upload-article/shared/PublishDatePanel";
import type { SettingsSection } from "@/components/upload-article/settings/SettingsTab";

const PUSHABLE = new Set(["GENERATED", "REVIEWED", "PUSHING", "PUSHED", "FAILED"]);

const TYPE_CHIP: Record<string, { label: string; cls: string }> = {
  title: { label: "หัวเรื่อง", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  toc: { label: "สารบัญ", cls: "bg-purple-50 text-purple-700 border-purple-200" },
  content: { label: "เนื้อหา", cls: "bg-gray-50 text-gray-600 border-gray-200" },
  cta: { label: "CTA", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  faq: { label: "FAQ", cls: "bg-orange-50 text-orange-700 border-orange-200" },
};

export default function PushTab({
  client, setClient, articles, loadArticleDetail, articleDetails, applyArticleUpdate, selectedId, setSelectedId, onOpenSettings,
}: {
  client: UploadClientDTO;
  setClient: (c: UploadClientDTO) => void;
  articles: UploadArticleDTO[];
  loadArticleDetail: (id: string, force?: boolean) => Promise<UploadArticleDTO | null>;
  articleDetails: Record<string, UploadArticleDTO>;
  applyArticleUpdate: (a: UploadArticleDTO) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  onOpenSettings: (section: SettingsSection) => void;
}) {
  const pushable = useMemo(() => articles.filter(a => PUSHABLE.has(a.status)), [articles]);

  const [publishMode, setPublishMode] = useState<"draft" | "publish">(client.pushPrefs.publishMode ?? "draft");
  const [wpPostType, setWpPostType] = useState<"post" | "page">(client.pushPrefs.wpPostType ?? "post");
  const [useElementor, setUseElementor] = useState(!!client.pushPrefs.useElementor);
  const [stripH1, setStripH1] = useState(client.pushPrefs.stripH1 !== false);

  // เก็บเวอร์ชัน HTML ของบทความไว้คู่กับ selection — ถ้า HTML บทความเปลี่ยน (เวอร์ชันไม่ตรง) ต้องเมิน selection เก่า
  // (ไม่ใช้ updatedAt เพราะเปลี่ยนทุกครั้งที่ push แม้ HTML เดิม — กด push ซ้ำหลัง fail แล้ว card ที่ตัดออกจะกลับมา)
  const [cardSel, setCardSel] = useState<Record<string, { version: string; sel: Record<string, boolean> }>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pushBusy, setPushBusy] = useState<Record<string, boolean>>({});
  const [batchBusy, setBatchBusy] = useState(false);
  const [pushResult, setPushResult] = useState<Record<string, { ok: boolean; postUrl?: string; error?: string }>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const siteScan = client.pushPrefs.siteScan;

  // เก็บ client ล่าสุดไว้ใน ref — การบันทึก card selection debounce 600ms อาจ fire หลังจาก client เปลี่ยนแล้ว
  // (เช่น push สำเร็จคืน client ใหม่มา) อ่านจาก ref กันข้อมูล pushPrefs อื่นที่เพิ่งอัปเดตถูกทับ
  const clientRef = useRef(client);
  useEffect(() => { clientRef.current = client; }, [client]);
  const cardSelTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // กันเรียก init ค่าเริ่มต้นจาก client.pushPrefs.cardSel ซ้ำ (จะไปทับ selection ที่ผู้ใช้เพิ่งแก้ในหน้านี้)
  const cardSelInited = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => { for (const t of Object.values(cardSelTimers.current)) clearTimeout(t); };
  }, []);

  // ดึงรายละเอียด htmlContent ของบทความที่ push ได้ทั้งหมด เพื่อแตก card
  useEffect(() => {
    for (const a of pushable) if (!articleDetails[a.id]) void loadArticleDetail(a.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushable.map(a => a.id).join("|")]);

  const { parsedMap, versionMap } = useMemo(() => {
    const parsedMap = new Map<string, ParsedArticle>();
    const versionMap = new Map<string, string>();
    for (const a of pushable) {
      const detail = articleDetails[a.id];
      if (detail?.htmlContent) {
        parsedMap.set(a.id, parseUploadCards(detail.htmlContent));
        versionMap.set(a.id, uploadHtmlVersion(detail.htmlContent));
      }
    }
    return { parsedMap, versionMap };
  }, [pushable, articleDetails]);

  // โหลด selection ที่บันทึกไว้แล้ว (pushPrefs.cardSel) มาใช้เป็นค่าเริ่มต้นต่อบทความ ครั้งเดียวต่อบทความ
  // — ต้อง version ตรงกับ HTML ปัจจุบันเท่านั้น ไม่งั้นถือว่า selection เก่าใช้ไม่ได้แล้ว
  useEffect(() => {
    for (const a of pushable) {
      if (cardSelInited.current.has(a.id)) continue;
      const version = versionMap.get(a.id);
      const parsed = parsedMap.get(a.id);
      if (!version || !parsed) continue;
      cardSelInited.current.add(a.id);
      const saved = client.pushPrefs.cardSel?.[a.id];
      if (saved && saved.version === version) {
        const sel: Record<string, boolean> = {};
        for (const c of parsed.cards) sel[c.id] = !saved.off.includes(c.id);
        setCardSel(prev => ({ ...prev, [a.id]: { version, sel } }));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushable, versionMap, parsedMap, client.pushPrefs.cardSel]);

  const notConnected = client.websitePlatform === "wordpress" ? !client.hasWpPassword || !client.wpUrl : !client.wpUrl;

  function isCardOn(articleId: string, cardId: string): boolean {
    const parsed = parsedMap.get(articleId);
    const card = parsed?.cards.find(c => c.id === cardId);
    if (!card) return false;
    const version = versionMap.get(articleId);
    const entry = cardSel[articleId];
    // selection เก่าที่ผูกกับ HTML คนละเวอร์ชัน ถือว่าไม่มีผล — ใช้ค่า default แทน
    const explicit = entry && version && entry.version === version ? entry.sel[cardId] : undefined;
    if (explicit !== undefined) return explicit;
    if (client.pushPrefs.excludeCards?.[card.type as "toc" | "cta" | "faq"]) return false;
    return !card.derived;
  }

  function toggleCard(articleId: string, cardId: string) {
    const version = versionMap.get(articleId);
    if (!version) return;
    setCardSel(prev => {
      const prevEntry = prev[articleId];
      const sel = prevEntry && prevEntry.version === version ? { ...prevEntry.sel } : {};
      sel[cardId] = !isCardOn(articleId, cardId);
      scheduleCardSelSave(articleId, version, sel);
      return { ...prev, [articleId]: { version, sel } };
    });
  }

  /** off = id ของ card ที่ปิดตาม sel ปัจจุบัน (คำนวณจาก default เดียวกับ isCardOn) */
  function computeOffIds(articleId: string, sel: Record<string, boolean>): string[] {
    const parsed = parsedMap.get(articleId);
    if (!parsed) return [];
    return parsed.cards
      .filter(c => {
        const explicit = sel[c.id];
        if (explicit !== undefined) return !explicit;
        if (client.pushPrefs.excludeCards?.[c.type as "toc" | "cta" | "faq"]) return true;
        return !!c.derived;
      })
      .map(c => c.id);
  }

  /** บันทึก card selection แบบ debounce 600ms ต่อบทความ — toast เฉพาะตอน error */
  function scheduleCardSelSave(articleId: string, version: string, sel: Record<string, boolean>) {
    if (cardSelTimers.current[articleId]) clearTimeout(cardSelTimers.current[articleId]);
    cardSelTimers.current[articleId] = setTimeout(async () => {
      const off = computeOffIds(articleId, sel);
      try {
        const r = await fetch(`/api/upload-article/articles/${articleId}/card-selection`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version, off }),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          toast.error(d?.error || "บันทึกการเลือก card ไม่สำเร็จ");
          return;
        }
        const latest = clientRef.current;
        setClient({
          ...latest,
          pushPrefs: { ...latest.pushPrefs, cardSel: { ...(latest.pushPrefs.cardSel ?? {}), [articleId]: { version, off } } },
        });
      } catch (e) {
        toast.error(`บันทึกการเลือก card ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, 600);
  }

  async function pushOne(articleId: string) {
    if (pushBusy[articleId]) return; // กันกดซ้ำ/push ซ้อนของบทความเดียวกัน
    const detail = articleDetails[articleId] || await loadArticleDetail(articleId, true);
    if (!detail?.htmlContent) { toast.error("บทความนี้ยังไม่มี HTML"); return; }
    setPushBusy(prev => ({ ...prev, [articleId]: true }));
    setPushResult(prev => { const n = { ...prev }; delete n[articleId]; return n; });
    try {
      // ส่งแค่รายการ card ที่เลือก (กันตัว body เกิน 4.5MB ของ Vercel) — server ประกอบ HTML เองจาก htmlContent ที่มีอยู่แล้ว
      const parsed = parsedMap.get(articleId);
      const cardIds = parsed ? parsed.cards.filter(c => isCardOn(articleId, c.id)).map(c => c.id) : null;
      if (cardIds && cardIds.length === 0) { toast.error("ยังไม่ได้เลือก card ที่จะ push"); return; }
      const r = await fetch(`/api/upload-article/articles/${articleId}/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardIds, htmlVersion: versionMap.get(articleId) ?? uploadHtmlVersion(detail.htmlContent), publishMode, useElementor, wpPostType, stripH1 }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) {
        setPushResult(prev => ({ ...prev, [articleId]: { ok: false, error: d?.error || "Push ไม่สำเร็จ" } }));
        toast.error(`Push ไม่สำเร็จ: ${d?.error || r.status}`);
      } else {
        setPushResult(prev => ({ ...prev, [articleId]: { ok: true, postUrl: d.postUrl } }));
        if (d.client) setClient(d.client);
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
    if (batchBusy) return;
    setBatchBusy(true);
    try {
      for (const id of Array.from(selectedIds)) await pushOne(id);
    } finally {
      setBatchBusy(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  return (
    <div className="space-y-4">
      <button onClick={() => onOpenSettings("scan")} className="flex items-center gap-1.5 text-xs text-brand-blue hover:underline">
        <Settings size={12} /> ตั้งค่าสแกนเว็บปลายทางใน Project Setting
      </button>

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-brand-navy flex items-center gap-1.5">
              <Globe size={14} /> {client.websitePlatform} · {client.wpUrl || client.website || "ยังไม่ตั้งเว็บ"}
            </p>
            {notConnected && (
              <button onClick={() => onOpenSettings("website")} className="text-xs text-rose-600 hover:underline flex items-center gap-1 mt-1">
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

        <Button size="sm" disabled={!selectedIds.size || batchBusy} onClick={pushSelected}>
          <Send size={12} className="mr-1.5" /> {batchBusy ? "กำลัง Push..." : `Push ที่เลือก (${selectedIds.size})`}
        </Button>
      </div>

      <div className="space-y-3">
        {pushable.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-10 bg-white border border-gray-200 rounded-xl">ยังไม่มีบทความที่พร้อม Push (ต้อง Generate ก่อน)</p>
        )}
        {pushable.map(a => {
          const parsed = parsedMap.get(a.id);
          const result = pushResult[a.id];
          const busy = !!pushBusy[a.id] || (a.status === "PUSHING" && Date.now() - new Date(a.updatedAt).getTime() < 6 * 60 * 1000);
          return (
            <div key={a.id} className="bg-white border border-gray-200 rounded-xl p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <label className="flex items-start gap-2 min-w-0">
                  <input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => toggleSelect(a.id)} className="mt-1" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-brand-navy truncate">{a.title}</p>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <UploadStatusBadge status={a.status} />
                      {client.pushPrefs.publishAt?.[a.id] && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500" title="ตั้งวันที่ได้ในแท็บ Review">
                          <CalendarClock size={11} /> เผยแพร่ {formatPublishAt(client.pushPrefs.publishAt[a.id])}
                        </span>
                      )}
                    </div>
                  </div>
                </label>
                <Button size="sm" variant="outline" disabled={busy || batchBusy} onClick={() => pushOne(a.id)}>
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
