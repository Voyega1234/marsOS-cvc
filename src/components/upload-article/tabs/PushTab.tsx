"use client";

/** แท็บ Push — เลือก card ที่จะขึ้นเว็บ แล้ว push ทีละบทความหรือหลายบทความพร้อมกัน
 * (การสแกนเว็บปลายทางย้ายไปอยู่ที่ Project Setting > สแกนเว็บปลายทาง แล้ว) */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Globe, ExternalLink, Send, AlertTriangle, ChevronDown, ChevronRight, Settings, CalendarClock, SearchCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UploadArticleDTO, UploadClientDTO } from "@/lib/upload-article/types";
import { parseUploadCards, uploadHtmlVersion, type ParsedArticle } from "@/lib/upload-article/cards";
import UploadStatusBadge from "@/components/upload-article/shared/StatusBadge";
import { formatPublishAt } from "@/components/upload-article/shared/PublishDatePanel";
import type { SettingsSection } from "@/components/upload-article/settings/SettingsTab";
import { parseWriterSourceName } from "@/lib/upload-article/pbn";
import { usePbnSites } from "@/components/upload-article/pbn/usePbnSites";
import { uploadPlatformOf, UPLOAD_PLATFORM_LABEL, pushTargetUrl as getPushTargetUrl, pushTargetDetail, missingConnectionFields, pushCapabilities, hostOf } from "@/lib/upload-article/platform-info";

const PUSHABLE = new Set(["GENERATED", "REVIEWED", "PUSHING", "PUSHED", "FAILED"]);

const PLATFORM_HINT: Record<ReturnType<typeof uploadPlatformOf>, string> = {
  wordpress: "Draft/Publish ใช้กับทุกเว็บ · Post/Page, Elementor ใช้กับ WordPress เท่านั้น",
  webflow: "Draft = item แบบ Draft ใน CMS · Publish = ขึ้นเว็บทันที (เว็บต้องเคย Publish มาแล้ว) · รูปอัปโหลดเข้า Assets ให้ · push ซ้ำ = อัปเดต item เดิม · สไตล์ตาม CSS ใน Webflow Custom Code (ดูสไตล์บทความ)",
  shopify: "Draft = บทความซ่อน (Hidden) · Publish = แสดงบนร้านทันที · รูปอัปโหลดเข้า Files ให้ · SEO title/description ลง metafield · push ซ้ำ = อัปเดตบทความเดิม",
  wix: "Draft = ฉบับร่างใน Wix Blog · Publish = เผยแพร่ทันที · เนื้อหาลงเป็นกล่อง HTML · ปกอัปโหลดเข้า Media Manager · push ซ้ำ = อัปเดตโพสต์เดิม",
  custom: "ส่ง JSON ไปที่ Webhook ที่ตั้งไว้ · Draft/Publish ส่งเป็น publishMode · push ซ้ำส่ง existingId ไปด้วย",
};

const TYPE_CHIP: Record<string, { label: string; cls: string }> = {
  title: { label: "หัวเรื่อง", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  toc: { label: "สารบัญ", cls: "bg-purple-50 text-purple-700 border-purple-200" },
  content: { label: "เนื้อหา", cls: "bg-gray-50 text-gray-600 border-gray-200" },
  cta: { label: "CTA", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  faq: { label: "FAQ", cls: "bg-orange-50 text-orange-700 border-orange-200" },
};

export default function PushTab({
  client, setClient, articles, loadArticleDetail, articleDetails, applyArticleUpdate, selectedId, setSelectedId, onOpenSettings, pbn = false,
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
  /** PBN Backlinks: เลือกเว็บ PBN ปลายทางต่อบทความ + โชว์ว่าบทความขึ้นเว็บไหนไปแล้ว */
  pbn?: boolean;
}) {
  const pbnData = usePbnSites(pbn);
  const pbnSites = pbnData.sites;
  const pbnPushes = pbnData.pushes;
  /** เว็บ PBN ปลายทางต่อบทความ (articleId → siteId) */
  const [targetSite, setTargetSite] = useState<Record<string, string>>({});
  const siteName = (id: string) => pbnSites.find(s => s.id === id)?.name ?? "เว็บที่ถูกลบ";
  /** บทความที่เขียนตามสไตล์ของเว็บไหน = push ได้เฉพาะเว็บนั้น (ล็อกไว้ ฝั่ง server ก็เช็คซ้ำ) */
  const lockedSite = (articleId: string): string | undefined => (pbn ? pbnData.targets[articleId]?.siteId : undefined);
  const targetsKey = pbn ? JSON.stringify(pbnData.targets) : "";
  useEffect(() => {
    if (!pbn) return;
    const locked: Record<string, string> = {};
    for (const [articleId, t] of Object.entries(pbnData.targets)) locked[articleId] = t.siteId;
    if (Object.keys(locked).length) setTargetSite(prev => ({ ...prev, ...locked }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pbn, targetsKey]);
  const pushable = useMemo(() => articles.filter(a => PUSHABLE.has(a.status)), [articles]);

  const [publishMode, setPublishMode] = useState<"draft" | "publish">(client.pushPrefs.publishMode ?? "draft");
  const [wpPostType, setWpPostType] = useState<"post" | "page">(client.pushPrefs.wpPostType ?? "post");
  const [useElementor, setUseElementor] = useState(!!client.pushPrefs.useElementor);
  const [stripH1, setStripH1] = useState(client.pushPrefs.stripH1 !== false);
  const [autoRequestIndex, setAutoRequestIndex] = useState(client.pushPrefs.autoRequestIndex !== false);
  const [indexBusy, setIndexBusy] = useState<Record<string, boolean>>({});

  // เก็บเวอร์ชัน HTML ของบทความไว้คู่กับ selection — ถ้า HTML บทความเปลี่ยน (เวอร์ชันไม่ตรง) ต้องเมิน selection เก่า
  // (ไม่ใช้ updatedAt เพราะเปลี่ยนทุกครั้งที่ push แม้ HTML เดิม — กด push ซ้ำหลัง fail แล้ว card ที่ตัดออกจะกลับมา)
  const [cardSel, setCardSel] = useState<Record<string, { version: string; sel: Record<string, boolean> }>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pushBusy, setPushBusy] = useState<Record<string, boolean>>({});
  const [batchBusy, setBatchBusy] = useState(false);
  const [pushResult, setPushResult] = useState<Record<string, { ok: boolean; postUrl?: string; error?: string; warning?: string }>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const platform = uploadPlatformOf(client);
  const platformLabel = UPLOAD_PLATFORM_LABEL[platform];
  const caps = pushCapabilities(platform);
  // ตัวเลือก Post/Page, Elementor มีผลกับ WordPress เท่านั้น (PBN มีหลายแพลตฟอร์มปนกัน แสดงไว้)
  const showWpOptions = pbn || caps.postType;
  const pushTargetUrl = getPushTargetUrl(client);
  const missingFields = pbn ? [] : missingConnectionFields(client);
  // ผลสแกนเป็นของเว็บอื่น (เช่น สแกนเว็บ WordPress เดิมแต่ push ขึ้น Webflow) — ไม่เอามาเตือนว่าการ์ดซ้อน
  const scanMismatch = !pbn && !!client.pushPrefs.siteScan?.target && !!pushTargetUrl
    && hostOf(client.pushPrefs.siteScan.target) !== hostOf(pushTargetUrl);
  const siteScan = scanMismatch ? undefined : client.pushPrefs.siteScan;

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

  const notConnected = pbn
    ? !pbnData.loading && pbnSites.length === 0
    : missingFields.length > 0;

  /** keyword + เวอร์ชันของบทความ (เขียนจากแท็บเขียนบทความ) — ใช้โชว์ v2/v3 และเตือนเวอร์ชันพี่น้องขึ้นเว็บเดียวกัน */
  const variantInfo = useMemo(() => {
    const m = new Map<string, { keywordId: string; variant: number }>();
    for (const a of pushable) {
      const p = parseWriterSourceName(a.sourceName);
      if (p) m.set(a.id, p);
    }
    return m;
  }, [pushable]);

  /** บทความอื่นจาก keyword เดียวกันที่ขึ้นเว็บนี้ไปแล้ว — PBN ไม่ควรมีเนื้อหาเรื่องเดียวกันซ้ำในเว็บเดียว */
  function siblingOnSite(articleId: string, siteId: string): string | null {
    const info = variantInfo.get(articleId);
    if (!info || !siteId) return null;
    for (const [otherId, other] of Array.from(variantInfo.entries())) {
      if (otherId === articleId || other.keywordId !== info.keywordId) continue;
      if (pbnPushes[otherId]?.[siteId]) return `v${other.variant}`;
    }
    return null;
  }

  /** จัดเว็บให้อัตโนมัติ: บทความจาก keyword เดียวกันกระจายไปคนละเว็บ ข้ามเว็บที่เคยขึ้นแล้ว */
  function autoAssignSites() {
    if (!pbnSites.length) return;
    const next: Record<string, string> = { ...targetSite };
    const usedByKeyword = new Map<string, Set<string>>();
    for (const a of pushable) {
      const info = variantInfo.get(a.id);
      const k = info?.keywordId ?? a.id;
      const used = usedByKeyword.get(k) ?? new Set<string>();
      for (const [otherId, other] of Array.from(variantInfo.entries())) {
        if (other.keywordId === k) for (const sid of Object.keys(pbnPushes[otherId] ?? {})) used.add(sid);
      }
      usedByKeyword.set(k, used);
    }
    const ordered = [...pushable].sort((x, y) => (variantInfo.get(x.id)?.variant ?? 1) - (variantInfo.get(y.id)?.variant ?? 1));
    let skipped = 0;
    for (const a of ordered) {
      if (!selectedIds.has(a.id)) continue;
      if (lockedSite(a.id)) continue;
      const k = variantInfo.get(a.id)?.keywordId ?? a.id;
      const used = usedByKeyword.get(k)!;
      const free = pbnSites.find(s => !used.has(s.id));
      if (!free) { skipped++; continue; }
      next[a.id] = free.id;
      used.add(free.id);
    }
    setTargetSite(next);
    if (skipped) toast.warning(`${skipped} บทความไม่มีเว็บว่างให้แล้ว (ทุกเว็บมีบทความจาก keyword เดียวกัน)`);
    else toast.success("จัดเว็บปลายทางให้บทความที่เลือกแล้ว");
  }

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
    const siteId = pbn ? targetSite[articleId] : undefined;
    if (pbn && !siteId) { toast.error("เลือกเว็บ PBN ปลายทางของบทความนี้ก่อน"); return; }
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
        body: JSON.stringify({ cardIds, htmlVersion: versionMap.get(articleId) ?? uploadHtmlVersion(detail.htmlContent), publishMode, useElementor, wpPostType, stripH1, autoRequestIndex, ...(siteId ? { siteId } : {}) }),
      });
      const d = await r.json().catch(() => ({}));
      // PBN GitHub: push สำเร็จแต่ Deploy Hook พัง = ok + error → นับเป็นสำเร็จแล้วเตือน
      const hookWarning = pbn && r.ok && d.ok && d.error ? String(d.error) : null;
      if (!r.ok || (d.error && !hookWarning)) {
        setPushResult(prev => ({ ...prev, [articleId]: { ok: false, error: d?.error || "Push ไม่สำเร็จ" } }));
        toast.error(`Push ไม่สำเร็จ: ${d?.error || r.status}`);
      } else {
        const pushWarning = typeof d.warning === "string" && d.warning ? d.warning : undefined;
        setPushResult(prev => ({ ...prev, [articleId]: { ok: true, postUrl: d.postUrl, warning: pushWarning } }));
        if (d.client) setClient(d.client);
        toast.success(siteId ? `Push ขึ้น ${siteName(siteId)} สำเร็จ` : "Push สำเร็จ");
        if (pushWarning) toast.warning(pushWarning);
        if (hookWarning) toast.warning(`ไฟล์ขึ้น repo แล้ว แต่สั่ง deploy ไม่สำเร็จ: ${hookWarning}`);
        if (d.indexRequest) {
          if (d.indexRequest.ok) toast.success("ส่ง Request Index ให้ Google แล้ว");
          else toast.warning(`Push สำเร็จ แต่ Request Index ไม่สำเร็จ: ${d.indexRequest.error}`);
        }
      }
      if (pbn) await pbnData.reload();
      await loadArticleDetail(articleId, true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPushResult(prev => ({ ...prev, [articleId]: { ok: false, error: msg } }));
      toast.error(`Push ไม่สำเร็จ: ${msg}`);
    } finally {
      setPushBusy(prev => ({ ...prev, [articleId]: false }));
    }
  }

  /** กด Request Index เอง — WordPress เช็คว่าโพสต์ Publish จริงแล้วก่อนส่ง / PBN ส่ง siteId (เช็คหน้าเปิดได้จริงก่อน) */
  async function requestIndex(articleId: string, siteId?: string) {
    const busyKey = siteId ? `${articleId}::${siteId}` : articleId;
    if (indexBusy[busyKey]) return;
    setIndexBusy(prev => ({ ...prev, [busyKey]: true }));
    try {
      const r = await fetch(`/api/upload-article/articles/${articleId}/request-index`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(siteId ? { siteId } : {}),
      });
      const d = await r.json().catch(() => ({}));
      if (d.client) setClient(d.client);
      if (r.ok && d.ok) toast.success("ส่ง Request Index ให้ Google แล้ว");
      else toast.error(`Request Index ไม่สำเร็จ: ${d?.error || r.status}`);
      if (r.ok || d.indexRequest) await loadArticleDetail(articleId, true);
    } catch (e) {
      toast.error(`Request Index ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIndexBusy(prev => ({ ...prev, [busyKey]: false }));
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
            {pbn ? (
              <p className="text-sm font-semibold text-brand-navy flex items-center gap-1.5">
                <Globe size={14} /> เว็บ PBN ที่ connect ไว้ {pbnSites.length} เว็บ — เลือกเว็บปลายทางที่แต่ละบทความ
              </p>
            ) : (
              <p className="text-sm font-semibold text-brand-navy flex items-center gap-1.5">
                <Globe size={14} /> เชื่อมต่อกับ
                <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-brand-mist text-brand-blue">{platformLabel}</span>
                <span>{pushTargetUrl || "ยังไม่ตั้งเว็บ"}</span>
                {pushTargetDetail(client) && <span className="font-normal text-gray-500">· {pushTargetDetail(client)}</span>}
              </p>
            )}
            {!pbn && (
              <button onClick={() => onOpenSettings("website")} className="text-[11px] text-brand-blue hover:underline mt-0.5">
                เปลี่ยนที่ Project Setting &gt; เว็บไซต์ &amp; Connect
              </button>
            )}
            {notConnected && (
              <button onClick={() => onOpenSettings("website")} className="text-xs text-rose-600 hover:underline flex items-center gap-1 mt-1">
                <AlertTriangle size={11} /> {pbn ? "ยังไม่มีเว็บ PBN — ไปเพิ่มที่ Project Setting > เว็บ PBN & Connect" : `ยังตั้งค่า ${platformLabel} ไม่ครบ: ${missingFields.join(", ")} — ไปตั้งค่าที่ Connect Website`}
              </button>
            )}
          </div>
          {pbn && pbnSites.length > 0 && (
            <Button size="sm" variant="outline" disabled={!selectedIds.size || batchBusy} onClick={autoAssignSites}>
              จัดเว็บอัตโนมัติ (ที่เลือก)
            </Button>
          )}
        </div>
        <p className="text-[11px] text-gray-400">
          {pbn
            ? "Draft/Publish ใช้กับทุกเว็บ · Post/Page, Elementor ใช้กับ WordPress เท่านั้น — เว็บ GitHub ขึ้นเป็นไฟล์ในโฟลเดอร์ที่ตั้งไว้ (Draft = draft: true)"
            : PLATFORM_HINT[platform]}
        </p>
        {scanMismatch && (
          <p className="text-[11px] text-amber-700">
            ผลสแกนเว็บที่มีอยู่เป็นของ {client.pushPrefs.siteScan?.target} ไม่ใช่เว็บที่ push ({pushTargetUrl}) — ไม่ใช้เตือนการ์ดซ้อน · การ์ดที่ถูกปิดไว้จากผลสแกนเดิมติ๊กเปิดเองได้
          </p>
        )}

        <div className="flex flex-wrap gap-4 text-xs pt-1">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={publishMode === "draft"} onChange={() => setPublishMode("draft")} /> Draft
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={publishMode === "publish"} onChange={() => setPublishMode("publish")} /> Publish
          </label>
          {publishMode === "publish" && Object.keys(client.pushPrefs.publishAt ?? {}).length > 0 && (
            <span className="text-[11px] text-amber-700">บทความที่ตั้งวันเผยแพร่ไว้จะขึ้นเป็น Draft เสมอ</span>
          )}
          {showWpOptions && (
            <>
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
            </>
          )}
          <span className="text-gray-300">|</span>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={stripH1} onChange={e => setStripH1(e.target.checked)} /> ตัด H1
          </label>
          <label className="flex items-center gap-1.5" title={pbn
            ? "หลัง Push แบบ Publish สำเร็จ ส่ง URL ให้ Google Indexing API อัตโนมัติ (เว็บ GitHub ต้องรอ build — ถ้าหน้ายังไม่ขึ้นจะบันทึกว่าไม่สำเร็จ ให้กด Index ที่ชื่อเว็บอีกครั้งในไม่กี่นาที)"
            : "หลัง Push แบบ Publish สำเร็จ ส่ง URL ให้ Google Indexing API อัตโนมัติ (บทความที่ตั้งวันเผยแพร่ขึ้นเป็น Draft — กด Request Index เองหลัง Publish ใน WordPress)"}>
            <input type="checkbox" checked={autoRequestIndex} onChange={e => setAutoRequestIndex(e.target.checked)} /> Request Index อัตโนมัติหลัง Publish
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
                      {pbn && variantInfo.get(a.id) && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brand-mist text-brand-blue">v{variantInfo.get(a.id)!.variant}</span>
                      )}
                      {pbn && Object.entries(pbnPushes[a.id] ?? {}).map(([sid, rec]) => {
                        const ir = client.pushPrefs.pbnIndexRequests?.[a.id]?.[sid];
                        const busyKey = `${a.id}::${sid}`;
                        return (
                          <span key={sid} className="inline-flex items-center gap-0.5">
                            <a href={rec.url || undefined} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-l bg-emerald-50 text-emerald-700 hover:underline">
                              <ExternalLink size={9} /> {siteName(sid)}
                            </a>
                            {rec.url && (
                              <button type="button" onClick={() => requestIndex(a.id, sid)} disabled={!!indexBusy[busyKey]}
                                title={ir ? (ir.ok
                                  ? `Request Index แล้ว · ${new Date(ir.at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })} — กดเพื่อส่งอีกครั้ง`
                                  : `Request Index ล่าสุดไม่สำเร็จ: ${ir.error ?? ""} — กดเพื่อส่งอีกครั้ง`) : "Request Index ให้ Google"}
                                className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-r disabled:opacity-50 ${
                                  !ir ? "bg-gray-100 text-gray-500 hover:bg-gray-200" : ir.ok ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-rose-50 text-rose-600 hover:bg-rose-100"
                                }`}>
                                {indexBusy[busyKey] ? <Loader2 size={9} className="animate-spin" /> : <SearchCheck size={9} />}
                                {!ir ? "Index" : ir.ok ? "Indexed" : "ส่งใหม่"}
                              </button>
                            )}
                          </span>
                        );
                      })}
                      {client.pushPrefs.publishAt?.[a.id] && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500" title="ตั้งวันที่ได้ในแท็บ Review">
                          <CalendarClock size={11} /> Draft · วันที่ {formatPublishAt(client.pushPrefs.publishAt[a.id])}
                        </span>
                      )}
                    </div>
                  </div>
                </label>
                <div className="flex items-center gap-2">
                  {pbn && (
                    <select value={targetSite[a.id] ?? ""} disabled={busy || batchBusy || !!lockedSite(a.id)}
                      title={lockedSite(a.id) ? "บทความนี้เขียนตามสไตล์ของเว็บนี้ — push ได้เฉพาะเว็บนี้" : undefined}
                      onChange={e => setTargetSite(prev => ({ ...prev, [a.id]: e.target.value }))}
                      className="h-8 max-w-[200px] rounded-md border border-gray-200 px-2 text-xs bg-white">
                      <option value="">— เลือกเว็บ PBN —</option>
                      {lockedSite(a.id) && !pbnSites.some(s => s.id === lockedSite(a.id)) && (
                        <option value={lockedSite(a.id)}>เว็บที่ถูกลบ</option>
                      )}
                      {pbnSites.map(s => (
                        <option key={s.id} value={s.id}>{pbnPushes[a.id]?.[s.id] ? "✓ " : ""}{s.name}</option>
                      ))}
                    </select>
                  )}
                  <Button size="sm" variant="outline" disabled={busy || batchBusy || (pbn && (!targetSite[a.id] || !pbnSites.some(s => s.id === targetSite[a.id])))} onClick={() => pushOne(a.id)}>
                    {busy ? "กำลัง Push..." : pbn && pbnPushes[a.id]?.[targetSite[a.id] ?? ""] ? "Push อัปเดต" : "Push"}
                  </Button>
                </div>
              </div>
              {pbn && lockedSite(a.id) && (
                <p className={`text-[11px] flex items-center gap-1 ${pbnSites.some(s => s.id === lockedSite(a.id)) ? "text-violet-700" : "text-red-600"}`}>
                  {pbnSites.some(s => s.id === lockedSite(a.id))
                    ? <>เขียนตามสไตล์ของเว็บ {siteName(lockedSite(a.id)!)} — push ได้เฉพาะเว็บนี้</>
                    : <><AlertTriangle size={11} /> เว็บที่บทความนี้เขียนให้ถูกลบไปแล้ว — push ไม่ได้ (เขียนใหม่โดยเลือกเว็บที่มีอยู่)</>}
                </p>
              )}
              {pbn && targetSite[a.id] && siblingOnSite(a.id, targetSite[a.id]) && (
                <p className="text-[11px] text-amber-700 flex items-center gap-1">
                  <AlertTriangle size={11} /> {siblingOnSite(a.id, targetSite[a.id])} ของ keyword เดียวกันขึ้นเว็บ {siteName(targetSite[a.id])} ไปแล้ว — ควรเลือกเว็บอื่น
                </p>
              )}

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
                                    <AlertTriangle size={10} /> ปลั๊กอิน/ธีมของเว็บใส่ให้ทุกบทความเองแล้ว{finding?.source ? ` (${finding.source})` : ""} — push ไปจะซ้อนกัน
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
              {result?.ok && result.warning && <p className="text-xs text-amber-700">{result.warning}</p>}
              {!result && a.status === "FAILED" && a.pushError && <p className="text-xs text-rose-500">{a.pushError}</p>}
              {!result && !pbn && a.status === "PUSHED" && a.wordpressUrl && (
                <a href={a.wordpressUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-emerald-600 hover:underline w-fit">
                  <ExternalLink size={11} /> เปิดโพสต์ที่ push แล้ว
                </a>
              )}
              {/* WordPress: Draft ที่ทีมกด Publish ในหลังบ้านเองก็กดได้ (route เช็คสถานะจริงให้) — แพลตฟอร์มอื่นต้อง push แบบ Publish */}
              {!pbn && a.status === "PUSHED" && (platform === "wordpress" || a.pushMode === "publish") && (platform === "wordpress" || !!a.wordpressUrl) && (() => {
                const ir = client.pushPrefs.indexRequests?.[a.id];
                return (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button type="button" onClick={() => requestIndex(a.id)} disabled={!!indexBusy[a.id]}
                      className="flex items-center gap-1 px-2 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                      {indexBusy[a.id] ? <Loader2 size={11} className="animate-spin" /> : <SearchCheck size={11} />}
                      {ir?.ok ? "Request Index อีกครั้ง" : "Request Index"}
                    </button>
                    {ir && (ir.ok
                      ? <span className="text-emerald-600">ส่ง Google แล้ว · {new Date(ir.at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</span>
                      : <span className="text-rose-500">ล่าสุดไม่สำเร็จ: {ir.error}</span>)}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
