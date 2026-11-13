"use client";

/**
 * Upload Article — หน้ารวมลูกค้า (แยกจาก Clients/Project เด็ดขาด)
 * แต่ละการ์ด = ลูกค้าหนึ่งราย มี drop zone ของตัวเอง กันอัปโหลดผิดเว็บ
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Plus, Globe, FileText, CheckCircle2, UploadCloud, Loader2, ArrowUp, ArrowDown, ChevronDown, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { UploadClientDTO } from "@/lib/upload-article/types";
import DropZone from "@/components/upload-article/shared/DropZone";
import PasteDialog from "@/components/upload-article/shared/PasteDialog";
import GoogleDocDialog from "@/components/upload-article/shared/GoogleDocDialog";
import UploadLanguageSelect from "@/components/upload-article/shared/UploadLanguageSelect";
import ClientAvatar from "@/components/upload-article/ClientAvatar";
import { Chip, EmptyState, EntityCard, EntityGrid, PageHeader, Panel, SearchPill, Segmented } from "@/components/ds";

/** เพดานต่อไฟล์ฝั่งเบราว์เซอร์ — เผื่อที่ให้ multipart header ใต้เพดาน 4.5MB ของ Vercel */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

type SortKey = "recent" | "name" | "imported" | "generated" | "reviewed" | "pushed";
type SortDir = "asc" | "desc";
const SORT_STORAGE_KEY = "upload-article:clients-sort";
const SORT_KEYS: SortKey[] = ["recent", "name", "imported", "generated", "reviewed", "pushed"];
/** คอลัมน์ตาราง (md ขึ้นไป): ลูกค้า | ภาษา (xl) | 4 ตัวเลข | ปุ่ม */
const ROW_GRID = "lg:grid lg:items-center lg:gap-3 lg:grid-cols-[minmax(0,1fr)_60px_66px_60px_72px_172px] xl:grid-cols-[minmax(0,1fr)_240px_64px_72px_64px_72px_172px]";
const COUNT_COLS: Array<{ key: "imported" | "generated" | "reviewed" | "pushed"; label: string }> = [
  { key: "imported", label: "นำเข้า" },
  { key: "generated", label: "Generate" },
  { key: "reviewed", label: "Review" },
  { key: "pushed", label: "Push แล้ว" },
];

interface UploadResult {
  createdCount: number;
  errors: Array<{ name: string; error: string }>;
}

export default function UploadClientsBoard() {
  const router = useRouter();
  const [clients, setClients] = useState<UploadClientDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"cards" | "table">("cards");
  // ตัวกรองฝั่งเบราว์เซอร์จากตัวเลขที่โหลดมาแล้ว
  const [statusFilter, setStatusFilter] = useState<"all" | "pushed" | "empty">("all");

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newWebsite, setNewWebsite] = useState("");
  const [newLanguage, setNewLanguage] = useState<"th" | "en" | "both">("th");
  const [creating, setCreating] = useState(false);

  // state ต่อการ์ด (client id) — ไม่ล็อกรวม อัปหลายเจ้าพร้อมกันได้
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, UploadResult | undefined>>({});
  const [pasteOpenFor, setPasteOpenFor] = useState<string | null>(null);
  const [gdocOpenFor, setGdocOpenFor] = useState<string | null>(null);
  // แถวที่เปิดแผง "เพิ่มบทความ" + แถวที่กำลังลากไฟล์ทับ
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "recent", dir: "desc" });

  // จำการเรียงไว้ใน localStorage (อ่านหลัง mount กัน hydration ไม่ตรง)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SORT_STORAGE_KEY);
      if (!raw) return;
      const v = JSON.parse(raw);
      if (SORT_KEYS.includes(v?.key) && (v?.dir === "asc" || v?.dir === "desc")) setSort({ key: v.key, dir: v.dir });
    } catch { /* ใช้ค่าเริ่มต้น */ }
  }, []);

  function toggleSort(key: SortKey) {
    // กดซ้ำ: มาก→น้อย/ก→ฮ สลับทิศ, ครั้งที่สามกลับไป "ล่าสุด"
    let next: { key: SortKey; dir: SortDir };
    if (sort.key !== key) next = { key, dir: key === "name" ? "asc" : "desc" };
    else if (sort.dir === (key === "name" ? "asc" : "desc")) next = { key, dir: key === "name" ? "desc" : "asc" };
    else next = { key: "recent", dir: "desc" };
    setSort(next);
    try { localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(next)); } catch { /* ไม่เป็นไร */ }
  }

  async function loadClients() {
    setLoading(true);
    try {
      const r = await fetch("/api/upload-article/clients");
      if (r.ok) setClients(await r.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadClients(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const searched = !q ? clients : clients.filter(c => c.name.toLowerCase().includes(q) || c.website.toLowerCase().includes(q));
    const list = statusFilter === "pushed" ? searched.filter(c => c.counts.pushed > 0)
      : statusFilter === "empty" ? searched.filter(c => c.counts.total === 0)
      : searched;
    if (sort.key === "recent") return list;
    const sign = sort.dir === "asc" ? 1 : -1;
    const key = sort.key;
    return [...list].sort((a, b) => {
      if (key === "name") return sign * a.name.localeCompare(b.name, "th");
      return sign * (a.counts[key] - b.counts[key]) || a.name.localeCompare(b.name, "th");
    });
  }, [clients, search, sort, statusFilter]);

  async function createClient() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/upload-article/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), website: newWebsite.trim() || undefined, language: newLanguage }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "เพิ่มลูกค้าไม่สำเร็จ"); return; }
      toast.success("เพิ่มลูกค้าแล้ว");
      setAddOpen(false);
      setNewName("");
      setNewWebsite("");
      setNewLanguage("th");
      await loadClients();
    } finally {
      setCreating(false);
    }
  }

  async function uploadFiles(clientId: string, files: File[]) {
    if (busy[clientId]) return;
    setBusy(prev => ({ ...prev, [clientId]: true }));
    setResults(prev => ({ ...prev, [clientId]: undefined }));
    let created = 0;
    const errors: Array<{ name: string; error: string }> = [];
    try {
      // ส่งทีละไฟล์ — Vercel ตีกลับคำขอที่ใหญ่เกิน 4.5MB ก่อนถึงโค้ดเรา
      for (const f of files) {
        if (f.size > MAX_UPLOAD_BYTES) {
          errors.push({ name: f.name, error: "ไฟล์ใหญ่เกิน 4MB — ย่อรูปใน Word หรือแยกไฟล์ก่อน" });
          continue;
        }
        try {
          const fd = new FormData();
          fd.append("files", f);
          const r = await fetch(`/api/upload-article/clients/${clientId}/articles`, { method: "POST", body: fd });
          const d = await r.json().catch(() => null);
          if (!r.ok || !d) {
            errors.push({ name: f.name, error: d?.error || (r.status === 413 ? "ไฟล์ใหญ่เกินที่เซิร์ฟเวอร์รับ (413)" : `อัปโหลดไม่สำเร็จ (HTTP ${r.status})`) });
            continue;
          }
          created += Array.isArray(d.created) ? d.created.length : 0;
          if (Array.isArray(d.errors)) errors.push(...d.errors);
        } catch (e) {
          errors.push({ name: f.name, error: e instanceof Error ? e.message : String(e) });
        }
      }
      setResults(prev => ({ ...prev, [clientId]: { createdCount: created, errors } }));
      if (created) toast.success(`นำเข้าสำเร็จ ${created} บทความ`);
      if (errors.length) toast.error(`ผิดพลาด ${errors.length} ไฟล์ — ${errors[0].name}: ${errors[0].error}`);
      await loadClients();
    } finally {
      setBusy(prev => ({ ...prev, [clientId]: false }));
    }
  }

  async function submitItems(clientId: string, items: Array<{ title?: string; text?: string; html?: string; googleDocUrl?: string }>) {
    if (busy[clientId]) return;
    setBusy(prev => ({ ...prev, [clientId]: true }));
    setResults(prev => ({ ...prev, [clientId]: undefined }));
    try {
      const r = await fetch(`/api/upload-article/clients/${clientId}/articles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "นำเข้าไม่สำเร็จ"); return; }
      const created = Array.isArray(d.created) ? d.created.length : 0;
      const errors = Array.isArray(d.errors) ? d.errors : [];
      setResults(prev => ({ ...prev, [clientId]: { createdCount: created, errors } }));
      if (created) toast.success(`นำเข้าสำเร็จ ${created} บทความ`);
      if (errors.length) toast.error(`ผิดพลาด ${errors.length} รายการ`);
      await loadClients();
    } catch (e) {
      toast.error(`นำเข้าไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(prev => ({ ...prev, [clientId]: false }));
    }
  }

  function SortHead({ k, label, className = "" }: { k: SortKey; label: string; className?: string }) {
    const active = sort.key === k;
    const Icon = sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <button type="button" onClick={() => toggleSort(k)} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold hover:text-brand-navy ${active ? "text-brand-navy" : "text-gray-500"} ${className}`}>
        {label}
        {active ? <Icon size={11} /> : <ArrowDown size={11} className="opacity-0" />}
      </button>
    );
  }

  // ── ส่วนที่ใช้ร่วมกันทั้งมุมมองการ์ดและตาราง ──
  const dropProps = (c: UploadClientDTO) => {
    const cardBusy = !!busy[c.id];
    return {
      onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); if (!cardBusy) setDragRow(c.id); } },
      onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragRow(prev => prev === c.id ? null : prev); },
      onDrop: (e: React.DragEvent) => {
        if (!e.dataTransfer.files?.length) return;
        e.preventDefault();
        setDragRow(null);
        if (cardBusy) return;
        uploadFiles(c.id, Array.from(e.dataTransfer.files));
      },
    };
  };

  const langSelectFor = (c: UploadClientDTO) => (
    <UploadLanguageSelect
      compact
      value={c.language}
      clientId={c.id}
      onChange={v => setClients(prev => prev.map(x => x.id === c.id ? { ...x, language: v } : x))}
    />
  );

  const addPanel = (c: UploadClientDTO, className: string) => {
    const result = results[c.id];
    const cardBusy = !!busy[c.id];
    const open = !!expanded[c.id];
    const setLogo = (logo: string | null) => setClients(prev => prev.map(x => x.id === c.id ? { ...x, logo } : x));
    if (!(open || cardBusy || result)) return null;
    return (
      <div className={className}>
        {open && (
          <div className="space-y-2 max-w-xl">
            <DropZone
              label="ลากไฟล์มาวาง (.docx .txt .md .html)"
              disabled={cardBusy}
              compact
              onFiles={files => uploadFiles(c.id, files)}
            />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1 text-xs" disabled={cardBusy}
                onClick={() => setPasteOpenFor(c.id)}>
                วางข้อความ
              </Button>
              <Button variant="outline" size="sm" className="flex-1 text-xs" disabled={cardBusy}
                onClick={() => setGdocOpenFor(c.id)}>
                ลิงก์ Google Doc
              </Button>
            </div>
            {c.logo && (
              <button type="button" className="text-[11px] text-gray-400 hover:text-rose-600 underline"
                onClick={async () => {
                  setLogo(null);
                  try {
                    const r = await fetch(`/api/upload-article/clients/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientLogo: null }) });
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                  } catch (e) {
                    setLogo(c.logo ?? null);
                    toast.error(`ลบโลโก้ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
                  }
                }}>
                ลบโลโก้
              </button>
            )}
          </div>
        )}
        {cardBusy && (
          <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <UploadCloud size={11} className="animate-pulse" /> กำลังนำเข้า...
          </p>
        )}
        {result && (
          <div className="text-[11px] space-y-0.5">
            {result.createdCount > 0 && (
              <p className="flex items-center gap-1 text-emerald-600">
                <CheckCircle2 size={11} /> นำเข้าสำเร็จ {result.createdCount} บทความ
              </p>
            )}
            {result.errors.map((e, i) => (
              <p key={i} className="text-rose-500">✕ {e.name}: {e.error}</p>
            ))}
          </div>
        )}
      </div>
    );
  };

  const clientStatus = (c: UploadClientDTO): { tone: "ok" | "info" | "bad" | "muted"; label: string } => {
    if (c.counts.failed > 0) return { tone: "bad", label: `ผิดพลาด ${c.counts.failed}` };
    if (c.counts.pushed > 0) return { tone: "ok", label: "Push แล้ว" };
    if (c.counts.total > 0) return { tone: "info", label: `${c.counts.total} บทความ` };
    return { tone: "muted", label: "ยังไม่มีบทความ" };
  };

  return (
    <div className="px-4 py-6 sm:px-6 w-full space-y-4">
      <PageHeader
        className="!mb-2"
        eyebrow="Upload Article"
        title="Upload Article"
        subtitle={<>นำบทความที่เขียนเสร็จแล้วขึ้นเว็บลูกค้า — แยกลูกค้า แยกเว็บ ชัดเจน{!loading && clients.length > 0 ? ` · ${clients.length} ลูกค้า` : ""}</>}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus size={14} className="mr-1.5" /> เพิ่มลูกค้า
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SearchPill value={search} onChange={setSearch} placeholder="ค้นหาชื่อลูกค้า / เว็บไซต์" className="w-full max-w-sm" />
        {!loading && clients.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}
                className={statusFilter === "all" ? "!bg-brand-navy !text-white !border-brand-navy" : ""}>ทั้งหมด</Chip>
              <Chip active={statusFilter === "pushed"} onClick={() => setStatusFilter("pushed")}
                className={statusFilter === "pushed" ? "!bg-brand-navy !text-white !border-brand-navy" : ""}>Push แล้ว</Chip>
              <Chip active={statusFilter === "empty"} onClick={() => setStatusFilter("empty")}
                className={statusFilter === "empty" ? "!bg-brand-navy !text-white !border-brand-navy" : ""}>ยังไม่มีบทความ</Chip>
            </div>
            <p className="text-xs text-gray-500" aria-live="polite">
              {search.trim() || statusFilter !== "all" ? `พบ ${filtered.length} จาก ${clients.length} ลูกค้า` : `ทั้งหมด ${clients.length} ลูกค้า`}
            </p>
            <Segmented<"cards" | "table"> className="ml-auto" ariaLabel="มุมมอง" value={view} onChange={setView}
              options={[{ value: "cards", label: "การ์ด" }, { value: "table", label: "ตาราง" }]} />
          </>
        )}
      </div>

      {!loading && clients.length > 0 && view === "cards" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-gray-500 mr-1">เรียง:</span>
          <SortHead k="name" label="ลูกค้า" className="rounded-full border border-gray-200 bg-white/70 px-2.5 py-1" />
          {COUNT_COLS.map(col => (
            <SortHead key={col.key} k={col.key} label={col.label} className="rounded-full border border-gray-200 bg-white/70 px-2.5 py-1" />
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 text-sm gap-2">
          <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
        </div>
      ) : filtered.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<FileText size={24} />}
            title={clients.length === 0 ? "ยังไม่มีลูกค้าใน Upload Article" : "ไม่พบลูกค้าที่ค้นหา"}
            action={clients.length === 0 ? (
              <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                <Plus size={12} className="mr-1" /> เพิ่มลูกค้ารายแรก
              </Button>
            ) : undefined}
          />
        </Panel>
      ) : (
view === "cards" ? (
        <EntityGrid>
          {filtered.map(c => {
            const host = c.website.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
            const cardBusy = !!busy[c.id];
            const open = !!expanded[c.id];
            const setLogo = (logo: string | null) => setClients(prev => prev.map(x => x.id === c.id ? { ...x, logo } : x));
            const st = clientStatus(c);
            return (
              <div key={c.id} {...dropProps(c)} className="min-w-0">
                <EntityCard
                  className={`h-full ${dragRow === c.id ? "ring-2 ring-brand-blue bg-brand-mist/60" : ""}`}
                  avatar={<ClientAvatar clientId={c.id} name={c.name} theme={c.theme.theme} logo={c.logo} onChange={setLogo} size={44} />}
                  title={
                    <button type="button" onClick={() => router.push(`/upload-article/${c.id}`)}
                      className="block max-w-full text-left truncate hover:text-brand-blue hover:underline focus:outline-none focus-visible:underline">
                      {c.name}
                    </button>
                  }
                  subtitle={<span className="flex items-center gap-1"><Globe size={11} className="shrink-0" /> <span className="truncate">{host || "ยังไม่ตั้งเว็บไซต์"}</span></span>}
                  stats={COUNT_COLS.map(col => ({ label: col.label, value: c.counts[col.key], tone: col.key === "pushed" && c.counts.pushed > 0 ? "ok" as const : "default" as const }))}
                  footerLeft={c.updatedAt ? formatDistanceToNow(new Date(c.updatedAt), { addSuffix: true }) : undefined}
                  footerRight={<Chip tone={st.tone}>{st.label}</Chip>}
                  actions={
                    <>
                      <Button size="sm" variant="outline" className="text-xs" aria-expanded={open}
                        onClick={() => setExpanded(prev => ({ ...prev, [c.id]: !prev[c.id] }))}>
                        {open ? <ChevronDown size={12} className="mr-1" /> : <ChevronRight size={12} className="mr-1" />}
                        เพิ่มบทความ
                      </Button>
                      <Button size="sm" onClick={() => router.push(`/upload-article/${c.id}`)}>เปิด</Button>
                    </>
                  }
                >
                  <div className="space-y-2">
                    <div>{langSelectFor(c)}</div>
                    {addPanel(c, "space-y-2")}
                  </div>
                </EntityCard>
              </div>
            );
          })}
        </EntityGrid>
      ) : (
        <Panel padded={false}>
        <div role="table" aria-label="รายชื่อลูกค้า">
          {/* หัวตาราง (md ขึ้นไป) — ติดบนเมื่อเลื่อน */}
          <div role="row" className={`hidden ${ROW_GRID} sticky top-[4.5rem] z-10 bg-white/80 backdrop-blur border-b border-gray-200/70 rounded-t-3xl px-3 py-2`}>
            <div role="columnheader"><SortHead k="name" label="ลูกค้า" /></div>
            <div role="columnheader" className="hidden xl:block text-left text-[11px] font-semibold text-gray-500">ภาษา</div>
            {COUNT_COLS.map(col => (
              <div key={col.key} role="columnheader" className="text-right"><SortHead k={col.key} label={col.label} /></div>
            ))}
            <div role="columnheader" className="text-right text-[11px] font-semibold text-gray-500">จัดการ</div>
          </div>

          <div className="divide-y divide-gray-200/60">
            {filtered.map(c => {
              const host = c.website.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
              const cardBusy = !!busy[c.id];
              const open = !!expanded[c.id];
              const setLogo = (logo: string | null) => setClients(prev => prev.map(x => x.id === c.id ? { ...x, logo } : x));
              const langSelect = langSelectFor(c);
              return (
                <div key={c.id} {...dropProps(c)}
                  className={dragRow === c.id ? "bg-brand-mist/40 ring-2 ring-inset ring-brand-blue" : "hover:bg-white/60"}
                >
                  <div role="row" className={`${ROW_GRID} px-3 py-2 space-y-2 lg:space-y-0`}>
                    <div role="cell" className="flex items-center gap-3 min-w-0">
                      <ClientAvatar clientId={c.id} name={c.name} theme={c.theme.theme} logo={c.logo} onChange={setLogo} />
                      <div className="min-w-0 flex-1">
                        <button type="button" onClick={() => router.push(`/upload-article/${c.id}`)}
                          className="block max-w-full text-left text-sm font-bold text-brand-navy truncate hover:text-brand-blue hover:underline focus:outline-none focus-visible:underline">
                          {c.name}
                        </button>
                        <p className="text-xs text-gray-400 flex items-center gap-1 truncate">
                          <Globe size={11} className="shrink-0" /> <span className="truncate">{host || "ยังไม่ตั้งเว็บไซต์"}</span>
                        </p>
                      </div>
                      <Button size="sm" variant="outline" className="lg:hidden shrink-0" onClick={() => router.push(`/upload-article/${c.id}`)}>เปิด</Button>
                    </div>

                    {/* ภาษา: xl = คอลัมน์ของมันเอง, ต่ำกว่านั้นอยู่ใต้แถว */}
                    <div role="cell" className="hidden xl:block">{langSelect}</div>

                    {/* ตัวเลข: มือถือ = บรรทัดสรุป */}
                    <div role="cell" className="lg:hidden flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                      {COUNT_COLS.map(col => (
                        <span key={col.key}>{col.label} <b className={`tabular-nums ${c.counts[col.key] ? "text-brand-navy" : "text-gray-300"}`}>{c.counts[col.key]}</b></span>
                      ))}
                    </div>
                    {COUNT_COLS.map(col => (
                      <div key={col.key} role="cell" className={`hidden lg:block text-right pr-[15px] text-sm tabular-nums ${c.counts[col.key] ? "font-semibold text-brand-navy" : "text-gray-300"}`}>
                        {c.counts[col.key]}
                      </div>
                    ))}

                    <div role="cell" className="flex items-center gap-2 lg:justify-end">
                      <div className="mr-auto lg:hidden">{langSelect}</div>
                      <Button size="sm" variant="outline" className="text-xs" aria-expanded={open}
                        onClick={() => setExpanded(prev => ({ ...prev, [c.id]: !prev[c.id] }))}>
                        {open ? <ChevronDown size={12} className="mr-1" /> : <ChevronRight size={12} className="mr-1" />}
                        เพิ่มบทความ
                      </Button>
                      <Button size="sm" variant="outline" className="hidden lg:inline-flex" onClick={() => router.push(`/upload-article/${c.id}`)}>เปิด</Button>
                    </div>
                  </div>

                  {/* ภาษาสำหรับ md–xl: แถวเสริมใต้ชื่อ */}
                  <div className="hidden lg:block xl:hidden px-3 pb-2 pl-[60px]">{langSelect}</div>

                  {addPanel(c, "px-3 pb-3 lg:pl-[60px] space-y-2")}
                </div>
              );
            })}
          </div>
        </div>
        </Panel>
        )
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="rounded-3xl glass-strong">
          <DialogHeader>
            <DialogTitle>เพิ่มลูกค้าใหม่</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">ชื่อลูกค้า</label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="เช่น บริษัท เอบีซี จำกัด" maxLength={120} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">เว็บไซต์ (ไม่บังคับ)</label>
              <Input value={newWebsite} onChange={e => setNewWebsite(e.target.value)} placeholder="https://www.example.com" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">ภาษาที่ใช้เขียนบทความ</label>
              <UploadLanguageSelect value={newLanguage} onChange={setNewLanguage} showHint />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>ยกเลิก</Button>
            <Button disabled={!newName.trim() || creating} onClick={createClient}>
              {creating ? "กำลังบันทึก..." : "เพิ่มลูกค้า"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PasteDialog
        open={!!pasteOpenFor}
        onOpenChange={v => !v && setPasteOpenFor(null)}
        busy={pasteOpenFor ? busy[pasteOpenFor] : false}
        onSubmit={async data => {
          const id = pasteOpenFor;
          if (!id) return;
          await submitItems(id, [data]);
          setPasteOpenFor(null);
        }}
      />

      <GoogleDocDialog
        open={!!gdocOpenFor}
        onOpenChange={v => !v && setGdocOpenFor(null)}
        busy={gdocOpenFor ? busy[gdocOpenFor] : false}
        onSubmit={async data => {
          const id = gdocOpenFor;
          if (!id) return;
          await submitItems(id, [data]);
          setGdocOpenFor(null);
        }}
      />
    </div>
  );
}
