"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EmptyState, Panel, Segmented } from "@/components/ds";
import { boxKeyTakeaways } from "@/lib/article-structure";
import { CLIENT_AWAITING, PROPOSAL_BLOCK_TAGS, PROPOSAL_LIMITS } from "@/lib/client-proposal/constants";
import { DiffText } from "./ClientProposalPanel";

interface ReviewArticle { id: string; title: string; status: string; updatedAt: string }
interface ArticleComment { id: string; body: string; createdAt: string; user: { name: string | null; role: string } | null }
interface LoadedArticle {
  id: string; title: string; htmlContent: string; status: string; slug?: string | null;
  metaDescription?: string | null; seoTitle?: string | null; coverImageUrl?: string | null;
  updatedAt: string; comments: ArticleComment[];
}
interface EditRec { tag: string; section: string; before: string; after: string }

type Filter = "all" | "waiting" | "sent" | "approved";
type Mode = "read" | "edit";

const BLOCK_SELECTOR = PROPOSAL_BLOCK_TAGS.join(",");
const HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6";

/** "team" = ทีมยังตรวจทานภายในอยู่ ลูกค้าอ่านและส่งความเห็นได้ แต่ยังอนุมัติไม่ได้ */
type Group = Exclude<Filter, "all"> | "team";

const isAwaiting = (status: string) => (CLIENT_AWAITING as readonly string[]).includes(status);

const groupOf = (status: string): Group =>
  status === "APPROVED" ? "approved" : status === "CLIENT_REVISION" ? "sent" : isAwaiting(status) ? "waiting" : "team";

function StatusChip({ status }: { status: string }) {
  const g = groupOf(status);
  if (g === "approved") return <span className="chip chip-ok">อนุมัติแล้ว</span>;
  if (g === "sent") return <span className="chip chip-info">ส่งให้ทีมแก้ไขแล้ว</span>;
  if (g === "team") return <span className="chip chip-muted">ทีมกำลังตรวจทาน</span>;
  return <span className="chip chip-warn">รอคุณตรวจ</span>;
}

const fmtDate = (iso: string) => {
  try { return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }); } catch { return iso; }
};

const norm = (s: string) => s.replace(/ /g, " ").trimEnd();

// บทความแสดงในหน้าของระบบโดยตรง (ไม่ได้อยู่ใน iframe แบบฝั่งทีม) จึงต้องล้างทุกอย่างที่รันโค้ดหรือส่งข้อมูลออกได้
const DROP_TAGS = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "link", "meta", "base", "title",
  "form", "input", "button", "textarea", "select", "option", "noscript", "noembed", "noframes", "template",
  "xmp", "plaintext", "listing", "svg", "math", "audio", "video", "source", "track", "portal", "dialog",
]);
const URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction", "poster", "data", "background", "ping", "cite"]);
const SAFE_IMAGE_DATA = /^data:image\/(png|jpe?g|gif|webp|avif)[;,]/;
const UNSAFE_STYLE = /position\s*:\s*(fixed|sticky)|expression\s*\(|javascript:|@import|behavior\s*:|-moz-binding/i;

function unsafeUrl(value: string, isImageSrc: boolean): boolean {
  // เบราว์เซอร์ข้ามช่องว่างและอักขระควบคุมใน scheme จึงต้องตัดออกก่อนเทียบ
  // eslint-disable-next-line no-control-regex
  const v = value.replace(/[\u0000- \u007f-\u009f]/g, "").toLowerCase();
  if (v.startsWith("javascript:") || v.startsWith("vbscript:")) return true;
  if (v.startsWith("data:")) return !(isImageSrc && SAFE_IMAGE_DATA.test(v));
  return false;
}

/** ล้าง HTML บทความด้วย DOM จริงของเบราว์เซอร์ (ไม่ใช้ regex) คืนค่าว่างเมื่อรันฝั่งเซิร์ฟเวอร์ */
function sanitizeArticleHtml(html: string): string {
  if (typeof window === "undefined" || !html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const comments: Node[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const c of comments) c.parentNode?.removeChild(c);
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    const tag = el.localName.toLowerCase();
    if (DROP_TAGS.has(tag)) { el.remove(); continue; }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || name === "contenteditable" || name === "autofocus") {
        el.removeAttribute(attr.name);
      } else if (URL_ATTRS.has(name) && unsafeUrl(attr.value, tag === "img" && name === "src")) {
        el.removeAttribute(attr.name);
      } else if (name === "style" && UNSAFE_STYLE.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
    if (tag === "a") { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
    // FAQ แบบกดเปิด: เปิดไว้ทุกข้อให้ลูกค้าอ่านและแก้ได้โดยไม่ต้องกดทีละข้อ
    if (tag === "details") el.setAttribute("open", "");
  }
  return doc.body.innerHTML;
}

function prepareHtml(html: string): string {
  let out = html || "";
  try { out = boxKeyTakeaways(out); } catch { /* ใช้ HTML เดิม */ }
  return sanitizeArticleHtml(out);
}

/** React ต้องไม่ render ส่วนนี้ซ้ำระหว่างลูกค้าแก้ไข: memo + __html คงที่ */
const ArticleBody = memo(function ArticleBody({ html, innerRef }: { html: { __html: string }; innerRef: RefObject<HTMLDivElement> }) {
  return <div ref={innerRef} className="article-preview cp-article break-words px-5 py-6 sm:px-8" dangerouslySetInnerHTML={html} />;
});

// <style> ของบทความถูกตัดตอน sanitize จึงต้องมีสไตล์อ่านของพอร์ทัลเอง (scope ใต้ .cp-article เท่านั้น)
const EDIT_CSS = `
.cp-article { color: #1f2937; font-size: 16px; }
.cp-article p { margin: 0 0 1em; }
.cp-article ul, .cp-article ol { margin: 0 0 1em; padding-left: 1.5em; }
.cp-article ul { list-style: disc; }
.cp-article ol { list-style: decimal; }
.cp-article li { margin: .3em 0; }
.cp-article a { color: #1d48f3; text-decoration: underline; text-underline-offset: 2px; }
.cp-article img { max-width: 100%; height: auto; border-radius: 16px; margin: 1em auto; display: block; }
.cp-article figure { margin: 1.25em 0; }
.cp-article figcaption { margin-top: .4em; text-align: center; font-size: .85em; color: #6b7280; }
.cp-article blockquote { margin: 1.25em 0; padding: .75em 1em; border-left: 4px solid #6b8cef; background: #eff5f9; border-radius: 0 12px 12px 0; }
@media (max-width: 640px) { .cp-article table { display: block; overflow-x: auto; } }
.cp-article th, .cp-article td { border-color: #DAE1E7; text-align: left; vertical-align: top; }
.cp-article th { background: #eff5f9; color: #000E3F; }
.cp-article .content-takeaways, .cp-article .content-highlight, .cp-article .content-notice { margin: 1.25em 0; padding: 1em 1.25em; border: 1px solid rgba(29,72,243,.18); background: rgba(29,72,243,.05); border-radius: 16px; }
.cp-article .content-takeaways > :last-child, .cp-article .content-highlight > :last-child, .cp-article .content-notice > :last-child { margin-bottom: 0; }
.cp-article .content-takeaways__title { font-weight: 700; color: #000E3F; margin-bottom: .5em; }
.cp-article details { margin: .6em 0; padding: .75em 1em; border: 1px solid #DAE1E7; border-radius: 14px; background: #fff; }
.cp-article summary { font-weight: 600; color: #000E3F; cursor: default; }
.cp-article details > :not(summary) { margin-top: .6em; }
.cp-article details > :last-child { margin-bottom: 0; }
.cp-article [data-ci][contenteditable="true"], .cp-article [data-ci][contenteditable="plaintext-only"] { outline: 1px dashed rgba(29,72,243,.35); outline-offset: 2px; cursor: text; border-radius: 4px; }
.cp-article [data-ci][contenteditable="true"]:focus, .cp-article [data-ci][contenteditable="plaintext-only"]:focus { outline: 2px solid #1d48f3; }
.cp-article .cp-changed { border-left: 3px solid #1d48f3; background: rgba(29,72,243,.07); padding-left: 8px; }
`;

export default function ClientReviewTab({ projectId, articles, initialArticleId }: {
  projectId: string;
  articles: ReviewArticle[];
  initialArticleId?: string | null;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [statusOverride, setStatusOverride] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(
    initialArticleId && articles.some((a) => a.id === initialArticleId) ? initialArticleId : null,
  );
  const [article, setArticle] = useState<LoadedArticle | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [bodyNonce, setBodyNonce] = useState(0);
  const [mode, setMode] = useState<Mode>("read");
  const [edits, setEdits] = useState<Map<number, EditRec>>(new Map());
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<HTMLElement[]>([]);
  const originalsRef = useRef<Map<number, string>>(new Map());
  const fallbackRef = useRef(false);
  const modeRef = useRef<Mode>("read");
  modeRef.current = mode;

  const statusOf = useCallback((a: ReviewArticle) => statusOverride[a.id] ?? a.status, [statusOverride]);

  const counts = useMemo(() => {
    const c = { all: articles.length, waiting: 0, sent: 0, approved: 0, team: 0 };
    for (const a of articles) c[groupOf(statusOf(a))]++;
    return c;
  }, [articles, statusOf]);

  const visible = useMemo(
    () => articles.filter((a) => filter === "all" || groupOf(statusOf(a)) === filter),
    [articles, filter, statusOf],
  );

  const dirty = edits.size > 0 || comment.trim().length > 0;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const editsRef = useRef(edits);
  editsRef.current = edits;

  // เตือนก่อนปิดแท็บเมื่อยังไม่ได้ส่ง
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  const resetEditing = useCallback(() => {
    blocksRef.current = [];
    originalsRef.current = new Map();
    setEdits(new Map());
    setComment("");
    setMode("read");
  }, []);

  const trySelect = (id: string | null) => {
    if (id === selectedId) return;
    if (dirty && !window.confirm("คุณมีการแก้ไขหรือข้อความที่ยังไม่ได้ส่ง ต้องการละทิ้งและเปลี่ยนบทความหรือไม่")) return;
    resetEditing();
    setArticle(null);
    setSelectedId(id);
  };

  // โหลดบทความ
  useEffect(() => {
    if (!selectedId) return;
    const ctrl = new AbortController();
    setLoading(true);
    setLoadError("");
    fetch(`/api/articles/by-title?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(selectedId)}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const d = await res.json();
        setArticle({
          id: d.id, title: d.title, htmlContent: d.htmlContent ?? "", status: d.status, slug: d.slug,
          metaDescription: d.metaDescription, seoTitle: d.seoTitle, coverImageUrl: d.coverImageUrl,
          updatedAt: d.updatedAt, comments: Array.isArray(d.comments) ? d.comments : [],
        });
      })
      .catch((e) => { if (e?.name !== "AbortError") setLoadError("โหลดบทความไม่สำเร็จ กรุณาลองอีกครั้ง"); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [projectId, selectedId, reloadKey]);

  const html = useMemo(() => ({ __html: prepareHtml(article?.htmlContent ?? "") }), [article?.htmlContent]);
  const bodyKey = `${article?.id ?? ""}-${bodyNonce}`;

  // ลิงก์ในบทความเปิดแท็บใหม่ (โหมดอ่าน)
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    root.querySelectorAll("a").forEach((a) => { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener noreferrer"); });
  }, [bodyKey, article?.id]);

  const sectionFor = useCallback((el: HTMLElement): string => {
    const root = bodyRef.current;
    if (!root) return "";
    let last = "";
    for (const n of Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))) {
      if (n === el) break;
      if (n.matches(HEADING_SELECTOR)) last = (n.innerText || "").trim();
    }
    return last.slice(0, PROPOSAL_LIMITS.maxSectionChars);
  }, []);

  // listener ตัวเดียวที่ container (input / paste / click)
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const onInput = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-ci]") as HTMLElement | null;
      if (!el || !root.contains(el)) return;
      const i = Number(el.getAttribute("data-ci"));
      const original = originalsRef.current.get(i);
      if (original === undefined) return;
      const after = norm(el.innerText);
      const before = norm(original);
      // แก้ DOM และแจ้งเตือนนอก state updater (updater ต้องไม่มีผลข้างเคียง)
      const drop = () => {
        el.classList.remove("cp-changed");
        setEdits((prev) => { if (!prev.has(i)) return prev; const next = new Map(prev); next.delete(i); return next; });
      };
      if (after.length > PROPOSAL_LIMITS.maxTextChars) {
        el.innerText = original;
        drop();
        toast.error(`ย่อหน้านี้ยาวเกินไป (สูงสุด ${PROPOSAL_LIMITS.maxTextChars.toLocaleString()} ตัวอักษร)`);
        return;
      }
      if (after === before) { drop(); return; }
      const known = editsRef.current.get(i);
      if (!known && editsRef.current.size >= PROPOSAL_LIMITS.maxEdits) {
        el.innerText = original;
        toast.error(`แก้ได้สูงสุด ${PROPOSAL_LIMITS.maxEdits} จุดต่อครั้ง`);
        return;
      }
      el.classList.add("cp-changed");
      const rec: EditRec = { tag: el.tagName.toLowerCase(), section: known?.section ?? sectionFor(el), before, after };
      setEdits((prev) => new Map(prev).set(i, rec));
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!fallbackRef.current || modeRef.current !== "edit") return;
      const el = (e.target as HTMLElement | null)?.closest?.("[data-ci]");
      if (!el) return;
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") ?? "";
      document.execCommand("insertText", false, text);
    };
    const onClick = (e: MouseEvent) => {
      if (modeRef.current !== "edit") return;
      if ((e.target as HTMLElement | null)?.closest?.("a")) e.preventDefault();
    };
    root.addEventListener("input", onInput);
    root.addEventListener("paste", onPaste);
    root.addEventListener("click", onClick);
    return () => {
      root.removeEventListener("input", onInput);
      root.removeEventListener("paste", onPaste);
      root.removeEventListener("click", onClick);
    };
  }, [bodyKey, article?.id, sectionFor]);

  // เข้า/ออกโหมดแก้ไข
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    if (mode === "edit") {
      if (blocksRef.current.length === 0) {
        const all = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
        const leaves = all.filter((el) => !el.querySelector(BLOCK_SELECTOR));
        blocksRef.current = leaves;
        leaves.forEach((el, i) => {
          el.setAttribute("data-ci", String(i));
          if (!originalsRef.current.has(i)) originalsRef.current.set(i, el.innerText);
        });
      }
      for (const el of blocksRef.current) {
        el.contentEditable = "plaintext-only";
        if (el.contentEditable !== "plaintext-only") {
          el.contentEditable = "true";
          fallbackRef.current = true;
        }
        el.spellcheck = false;
      }
    } else {
      for (const el of blocksRef.current) el.contentEditable = "false";
    }
  }, [mode, bodyKey, article?.id]);

  const revertOne = (i: number) => {
    const el = blocksRef.current[i];
    const original = originalsRef.current.get(i);
    if (el && original !== undefined) { el.innerText = original; el.classList.remove("cp-changed"); }
    setEdits((prev) => { const n = new Map(prev); n.delete(i); return n; });
  };

  const revertAll = () => {
    for (const i of Array.from(edits.keys())) {
      const el = blocksRef.current[i];
      const original = originalsRef.current.get(i);
      if (el && original !== undefined) { el.innerText = original; el.classList.remove("cp-changed"); }
    }
    setEdits(new Map());
  };

  const markStatus = (id: string, status: string) => setStatusOverride((p) => ({ ...p, [id]: status }));

  const post = async (body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> => {
    if (!article) return { ok: false };
    try {
      const res = await fetch(`/api/articles/${encodeURIComponent(article.id)}/client-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: d?.error || "ส่งไม่สำเร็จ กรุณาลองอีกครั้ง" };
      return { ok: true };
    } catch {
      return { ok: false, error: "เชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง" };
    }
  };

  const send = async () => {
    if (!article || busy) return;
    const text = comment.trim();
    if (edits.size === 0 && !text) return;
    setBusy(true);
    const body = edits.size > 0
      ? {
          action: "propose", comment: text, baseUpdatedAt: article.updatedAt,
          edits: Array.from(edits.entries()).sort((a, b) => a[0] - b[0]).map(([i, e]) => ({ i, tag: e.tag, section: e.section, before: e.before, after: e.after })),
        }
      : { action: "revision", comment: text };
    const r = await post(body);
    setBusy(false);
    if (!r.ok) { toast.error(r.error || "ส่งไม่สำเร็จ"); return; }
    toast.success("ส่งให้ทีมแล้ว ทีมงานได้รับแจ้งเตือน");
    markStatus(article.id, "CLIENT_REVISION");
    // ล้างสถานะแก้ไขและให้ container สร้างใหม่จาก HTML เดิม
    blocksRef.current = [];
    originalsRef.current = new Map();
    setEdits(new Map());
    setComment("");
    setMode("read");
    setBodyNonce((n) => n + 1);
    setReloadKey((n) => n + 1);
    router.refresh();
  };

  const approve = async () => {
    if (!article || busy) return;
    const warn = edits.size > 0 ? "\n\nการแก้ไขที่ยังไม่ได้ส่งจะไม่ถูกส่งให้ทีม" : "";
    if (!window.confirm("ยืนยันอนุมัติบทความนี้หรือไม่" + warn)) return;
    setBusy(true);
    const r = await post({ action: "approve" });
    setBusy(false);
    if (!r.ok) { toast.error(r.error || "อนุมัติไม่สำเร็จ"); return; }
    toast.success("อนุมัติบทความแล้ว");
    markStatus(article.id, "APPROVED");
    blocksRef.current = [];
    originalsRef.current = new Map();
    setEdits(new Map());
    setComment("");
    setMode("read");
    setBodyNonce((n) => n + 1);
    setReloadKey((n) => n + 1);
    router.refresh();
  };

  const currentStatus = article ? (statusOverride[article.id] ?? article.status) : "";
  // เซิร์ฟเวอร์รับอนุมัติเฉพาะบทความที่รอลูกค้าตรวจ สถานะอื่นจะตอบ 409
  const canApprove = isAwaiting(currentStatus);
  const readerShown = selectedId !== null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* ค่าคงที่ในไฟล์นี้ ไม่มีข้อมูลผู้ใช้ — ใช้ __html เพราะ React escape เครื่องหมายคำพูดต่างกันระหว่าง server/client (hydration error) */}
      <style dangerouslySetInnerHTML={{ __html: EDIT_CSS }} />

      {/* รายการ */}
      <div className={`space-y-4 ${readerShown ? "hidden lg:block" : ""}`}>
        <Segmented<Filter>
          size="sm"
          ariaLabel="กรองบทความ"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "ทั้งหมด", count: counts.all },
            { value: "waiting", label: "รอตรวจ", count: counts.waiting },
            { value: "sent", label: "ส่งแก้ไขแล้ว", count: counts.sent },
            { value: "approved", label: "อนุมัติแล้ว", count: counts.approved },
          ]}
        />
        {visible.length === 0 ? (
          <Panel>
            <EmptyState title="ยังไม่มีบทความรอตรวจ" description="เมื่อทีมงานส่งบทความมาให้คุณตรวจ จะแสดงที่นี่ ไม่ต้องรีบนะคะ" />
          </Panel>
        ) : (
          <div className="space-y-3">
            {visible.map((a) => {
              const st = statusOf(a);
              const active = a.id === selectedId;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => trySelect(a.id)}
                  className={`block w-full rounded-2xl border bg-white/80 p-4 text-left shadow-sm transition hover:bg-white ${active ? "border-brand-blue ring-2 ring-brand-blue" : "border-white/80"}`}
                >
                  <div className="line-clamp-2 font-medium text-brand-navy">{a.title}</div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <StatusChip status={st} />
                    <span className="text-xs text-gray-500">{fmtDate(a.updatedAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ตัวอ่าน */}
      <div className={`min-w-0 space-y-5 ${readerShown ? "" : "hidden lg:block"}`}>
        {!readerShown ? (
          <Panel>
            <EmptyState title="เลือกบทความจากรายการ" description="คลิกบทความทางซ้ายเพื่อเริ่มอ่านและตรวจ" />
          </Panel>
        ) : (
          <>
            <button type="button" onClick={() => trySelect(null)} className="btn-secondary lg:hidden">← กลับไปรายการ</button>
            {loadError ? (
              <Panel>
                <EmptyState title={loadError} action={<button type="button" className="btn-primary" onClick={() => setReloadKey((n) => n + 1)}>ลองอีกครั้ง</button>} />
              </Panel>
            ) : !article ? (
              <Panel>
                <div className="space-y-3">
                  {[0, 1, 2, 3].map((i) => <div key={i} className="h-6 animate-pulse rounded-lg bg-gray-100" />)}
                  {loading && <span className="sr-only">กำลังโหลด</span>}
                </div>
              </Panel>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2"><StatusChip status={currentStatus} /></div>
                  <h2 className="break-words text-2xl font-bold leading-snug text-brand-navy sm:text-3xl">{article.title}</h2>
                </div>

                <div className="space-y-2">
                  <Segmented<Mode>
                    size="sm"
                    ariaLabel="โหมดการดู"
                    value={mode}
                    onChange={setMode}
                    options={[{ value: "read", label: "อ่าน" }, { value: "edit", label: "แก้ไขข้อความ" }]}
                  />
                  <p className="text-xs leading-relaxed text-gray-500">
                    คลิกที่ข้อความที่ต้องการแก้ได้เลย ทีมงานจะเห็นว่าคุณแก้ตรงไหน บทความจริงจะยังไม่เปลี่ยนจนกว่าทีมจะตรวจ
                  </p>
                </div>

                <div className="overflow-hidden rounded-3xl border border-white/80 bg-white shadow-sm">
                  {article.coverImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={article.coverImageUrl} alt="" className="h-auto w-full object-cover" />
                  )}
                  <ArticleBody key={bodyKey} html={html} innerRef={bodyRef} />
                </div>

                <Panel title="ส่งถึงทีม" subtitle="ตรวจเสร็จแล้วกดส่งให้ทีมได้เลย หรืออนุมัติถ้าบทความดีแล้ว">
                  <div className="space-y-4">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-brand-navy">สิ่งที่คุณแก้ ({edits.size} จุด)</h3>
                        {edits.size > 0 && (
                          <button type="button" onClick={revertAll} className="text-xs font-medium text-red-600 hover:underline">ยกเลิกการแก้ทั้งหมด</button>
                        )}
                      </div>
                      {edits.size === 0 ? (
                        <p className="text-sm text-gray-500">ยังไม่มีการแก้ไข สลับเป็น &ldquo;แก้ไขข้อความ&rdquo; แล้วคลิกที่ข้อความในบทความได้เลย</p>
                      ) : (
                        <div className="space-y-2">
                          {Array.from(edits.entries()).sort((a, b) => a[0] - b[0]).map(([i, e]) => (
                            <div key={i} className="rounded-2xl border border-gray-200 bg-white/80 p-3">
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <div className="min-w-0 truncate text-xs text-gray-500">{e.section ? `ใต้หัวข้อ: ${e.section}` : "ส่วนต้นบทความ"}</div>
                                <button type="button" onClick={() => revertOne(i)} className="shrink-0 text-xs font-medium text-brand-blue hover:underline">คืนค่าเดิม</button>
                              </div>
                              <DiffText before={e.before} after={e.after} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <label htmlFor="cp-comment" className="mb-1 block text-sm font-semibold text-brand-navy">ข้อความถึงทีม (ไม่บังคับ)</label>
                      <textarea
                        id="cp-comment"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        maxLength={5000}
                        rows={4}
                        className="field-input w-full"
                        placeholder="เช่น อยากให้ปรับน้ำเสียงให้เป็นกันเองมากขึ้น"
                      />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={send} disabled={busy || (edits.size === 0 && !comment.trim())} className="btn-primary disabled:opacity-50">
                        {busy ? "กำลังส่ง..." : "ส่งให้ทีม"}
                      </button>
                      <button type="button" onClick={approve} disabled={busy || !canApprove} className="btn-secondary disabled:opacity-50">
                        {currentStatus === "APPROVED" ? "อนุมัติแล้ว" : "อนุมัติบทความนี้"}
                      </button>
                    </div>
                    {!canApprove && currentStatus !== "APPROVED" && (
                      <p className="text-xs leading-relaxed text-gray-500">
                        {currentStatus === "CLIENT_REVISION"
                          ? "ทีมกำลังปรับตามที่คุณส่งมา จะอนุมัติได้เมื่อทีมส่งบทความกลับมาให้ตรวจอีกครั้ง"
                          : "ทีมกำลังตรวจทานบทความนี้อยู่ คุณอ่านและส่งความเห็นได้ก่อน ส่วนการอนุมัติจะเปิดเมื่อทีมส่งให้ตรวจ"}
                      </p>
                    )}
                  </div>
                </Panel>

                <Panel title="ความคิดเห็น">
                  {article.comments.length === 0 ? (
                    <p className="text-sm text-gray-500">ยังไม่มีความคิดเห็น</p>
                  ) : (
                    <ul className="space-y-3">
                      {article.comments.map((c) => (
                        <li key={c.id} className="rounded-2xl bg-brand-mist p-3">
                          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            <span className="font-semibold text-brand-navy">
                              {c.user?.role === "CLIENT" ? (c.user.name ? `คุณ${c.user.name}` : "คุณ") : "ทีมงาน"}
                            </span>
                            <span>{fmtDate(c.createdAt)}</span>
                          </div>
                          <p className="whitespace-pre-wrap break-words text-sm text-brand-navy">{c.body}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
