"use client";

/**
 * Settings > "Content Engine" — Business Skill / Master Prompt / Article Brief / Validator Pack
 * ของลูกค้า Upload Article รายนี้ (scope = { projectId: client.id })
 * หน้าตาอ้างอิงจาก src/components/projects/workspace/ProjectContentEngine.tsx (import เท่านั้น ไม่แก้ไฟล์เดิม)
 *
 * ตัว ContentEngineSettingsClient เดิม hardcode fetch ไปที่ /api/prompts, /api/prompts/layer-scan,
 * /api/prompts/business-skill-scan ซึ่งฝั่งนั้น validate ว่า projectId ต้องเป็น Project จริง (client.id
 * ของ Upload Article ไม่ใช่) — ระหว่างที่ component นี้ถูก mount จึงสับ window.fetch ชั่วคราว
 * ให้ 3 path นี้วิ่งไปที่ route เฉพาะของ Upload Article แทน แล้วคืนค่าเดิมตอน unmount
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PBN_MAIN_PROFILE, pbnCeScopeId } from "@/lib/upload-article/pbn-sets";
import { toast } from "sonner";
import { Loader2, Plus, RefreshCw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ContentEngineSettingsClient } from "@/components/settings/content-engine/ContentEngineSettingsClient";
import type { PromptRow } from "@/components/settings/content-engine/types";
import type { UploadClientDTO } from "@/lib/upload-article/types";

const CE_LAYER_TYPES = new Set([
  "CE_BUSINESS_SKILL",
  "CE_MASTER_PROMPT",
  "CE_ARTICLE_BRIEF",
  "CE_VALIDATOR_PACK",
  "CE_IMAGE_PROMPT",
]);

const REQUIRED_TYPES = ["CE_BUSINESS_SKILL", "CE_MASTER_PROMPT", "CE_ARTICLE_BRIEF", "CE_VALIDATOR_PACK"];

const LAYER_LABELS: Record<string, string> = {
  CE_BUSINESS_SKILL: "Business Skill",
  CE_MASTER_PROMPT: "Master Prompt",
  CE_ARTICLE_BRIEF: "Article Brief",
  CE_VALIDATOR_PACK: "Validator Pack",
  CE_IMAGE_PROMPT: "Image Prompt",
};

function toPromptRow(p: {
  id: string; name: string; description?: string | null; promptText: string; type: string;
  isActive: boolean; version: number; updatedAt?: unknown;
  updatedBy?: { name?: string | null } | null; createdBy?: { name?: string | null } | null;
}): PromptRow {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    promptText: p.promptText,
    type: p.type,
    isActive: p.isActive,
    version: p.version,
    updatedAt: String(p.updatedAt ?? ""),
    editorName: p.updatedBy?.name ?? p.createdBy?.name ?? null,
  };
}

// ── window.fetch rewrite (ติดตั้งครั้งเดียวต่อการ mount จริง กันซ้อนตอน React StrictMode) ──

let ceFetchInstallCount = 0;
let ceFetchOriginal: typeof window.fetch | null = null;

function buildCeFetch(original: typeof window.fetch, clientId: string, setId?: string): typeof window.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      let urlStr: string | null = null;
      let method = "GET";
      if (typeof input === "string") {
        urlStr = input;
        method = (init?.method ?? "GET").toUpperCase();
      } else if (typeof URL !== "undefined" && input instanceof URL) {
        urlStr = input.toString();
        method = (init?.method ?? "GET").toUpperCase();
      } else if (typeof Request !== "undefined" && input instanceof Request) {
        urlStr = input.url;
        method = (init?.method ?? input.method ?? "GET").toUpperCase();
      }

      if (urlStr) {
        const u = new URL(urlStr, window.location.origin);
        let newPath: string | null = null;
        if (u.pathname === "/api/prompts" && method === "POST") {
          newPath = `/api/upload-article/clients/${clientId}/prompts`;
        } else if (u.pathname === "/api/prompts/layer-scan") {
          newPath = `/api/upload-article/clients/${clientId}/prompts/layer-scan`;
        } else if (u.pathname === "/api/prompts/business-skill-scan") {
          newPath = `/api/upload-article/clients/${clientId}/prompts/business-skill-scan`;
        }
        if (newPath) {
          // set ข้อมูลโปรเจกต์ของ PBN — ส่ง ?set= ให้ route ใช้ Content Engine ของ set นั้น
          if (setId) u.searchParams.set("set", setId);
          const newUrl = `${newPath}${u.search}`;
          if (typeof Request !== "undefined" && input instanceof Request) {
            return original(new Request(newUrl, input));
          }
          return original(newUrl, init);
        }
      }
    } catch {
      /* parse ไม่ได้ — ปล่อยผ่านไป fetch เดิม ไม่ rewrite */
    }
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}

function installCeFetch(clientId: string, setId?: string) {
  if (ceFetchInstallCount === 0) {
    ceFetchOriginal = window.fetch.bind(window);
    window.fetch = buildCeFetch(ceFetchOriginal, clientId, setId);
  }
  ceFetchInstallCount++;
}

function uninstallCeFetch() {
  ceFetchInstallCount = Math.max(0, ceFetchInstallCount - 1);
  if (ceFetchInstallCount === 0 && ceFetchOriginal) {
    window.fetch = ceFetchOriginal;
    ceFetchOriginal = null;
  }
}

type ExampleRow = { mode: "url" | "text"; value: string };

const CE_LAYOUT_CSS = `
.ua-ce { container-type: inline-size; }
.ua-ce [class~="md:flex-row"]:has(> nav) { flex-direction: column; }
.ua-ce nav[class~="md:w-56"] { width: auto; flex-direction: row; flex-wrap: wrap; overflow: visible; padding: 0.375rem; }
.ua-ce nav[class~="md:w-56"] > button { width: auto; }
.ua-ce [class~="lg:col-span-2"], .ua-ce [class~="lg:col-span-4"] { grid-column: 1 / -1; }
@container (max-width: 880px) {
  .ua-ce [class~="lg:grid-cols-[300px_1fr]"], .ua-ce [class~="lg:grid-cols-[340px_1fr]"] { grid-template-columns: minmax(0, 1fr); }
}
`;

export default function UploadContentEngine({ client, userRole, setId }: {
  client: UploadClientDTO;
  userRole: string;
  /** PBN เท่านั้น: set ข้อมูลโปรเจกต์ที่กำลังแก้ Content Engine (ไม่ส่ง = set หลัก / Upload Article) — เปลี่ยน set ต้อง remount ด้วย key */
  setId?: string;
}) {
  const ceSet = setId && setId !== PBN_MAIN_PROFILE ? setId : undefined;
  const scopeId = pbnCeScopeId(client.id, ceSet);
  const setQs = ceSet ? `?set=${encodeURIComponent(ceSet)}` : "";
  const [fetchReady, setFetchReady] = useState(false);
  const [items, setItems] = useState<PromptRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const seedAttemptedRef = useRef(false);

  useLayoutEffect(() => {
    installCeFetch(client.id, ceSet);
    setFetchReady(true);
    return () => {
      uninstallCeFetch();
      setFetchReady(false);
    };
  }, [client.id, ceSet]);

  useEffect(() => { seedAttemptedRef.current = false; }, [scopeId]);

  useEffect(() => {
    setError(null);
    fetch(`/api/prompts?projectId=${encodeURIComponent(scopeId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 403 ? "เฉพาะ ADMIN / SEO Manager เท่านั้น" : `โหลด Content Engine ไม่สำเร็จ (${res.status})`);
        const prompts = await res.json();
        setItems(
          (Array.isArray(prompts) ? prompts : [])
            .filter((p: { type: string }) => CE_LAYER_TYPES.has(p.type))
            .map(toPromptRow)
        );
      })
      .catch((e) => setError((e as Error).message));
  }, [scopeId, refreshKey]);

  useEffect(() => {
    if (items && items.length === 0 && !seedAttemptedRef.current) {
      seedAttemptedRef.current = true;
      void runSeed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  async function runSeed() {
    setSeeding(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}/prompts/seed${setQs}`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "ตั้งค่าเริ่มต้นไม่สำเร็จ"); return; }
      if (typeof d.created === "number" && d.created > 0) toast.success(`คัดลอก ${d.created} layer จากระบบล่าสุดแล้ว`);
      setRefreshKey(k => k + 1);
    } catch (e) {
      toast.error(`ตั้งค่าเริ่มต้นไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSeeding(false);
    }
  }

  // ── การ์ด: สร้าง Master Prompt จากบทความตัวอย่าง ──
  const [exampleRows, setExampleRows] = useState<ExampleRow[]>([
    { mode: "url", value: "" }, { mode: "url", value: "" }, { mode: "url", value: "" },
  ]);
  const [exampleName, setExampleName] = useState("");
  const [exampleActivate, setExampleActivate] = useState(false);
  const [creatingMaster, setCreatingMaster] = useState(false);
  const [createElapsed, setCreateElapsed] = useState(0);

  useEffect(() => {
    if (!creatingMaster) { setCreateElapsed(0); return; }
    const start = Date.now();
    const t = setInterval(() => setCreateElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [creatingMaster]);

  function addExampleRow() {
    setExampleRows(prev => (prev.length >= 5 ? prev : [...prev, { mode: "url", value: "" }]));
  }
  function removeExampleRow(i: number) {
    setExampleRows(prev => (prev.length <= 3 ? prev : prev.filter((_, j) => j !== i)));
  }
  function updateExampleRow(i: number, patch: Partial<ExampleRow>) {
    setExampleRows(prev => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function createMasterFromExamples() {
    const sources = exampleRows
      .filter(r => r.value.trim())
      .map(r => (r.mode === "url" ? { url: r.value.trim() } : { text: r.value.trim() }));
    if (sources.length < 3) { toast.error("ต้องมีตัวอย่างอย่างน้อย 3 รายการ (URL หรือข้อความ)"); return; }
    setCreatingMaster(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}/prompts/master-from-examples${setQs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources, name: exampleName.trim() || undefined, activate: exampleActivate }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "สร้าง Master Prompt ไม่สำเร็จ"); return; }
      toast.success("สร้าง Master Prompt จากตัวอย่างสำเร็จ");
      setExampleRows([{ mode: "url", value: "" }, { mode: "url", value: "" }, { mode: "url", value: "" }]);
      setExampleName("");
      setExampleActivate(false);
      setRefreshKey(k => k + 1);
    } catch (e) {
      toast.error(`สร้าง Master Prompt ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreatingMaster(false);
    }
  }

  // ── การ์ด: แก้ Master Prompt ด้วยคำสั่ง ──
  const masterPrompts = (items ?? []).filter(p => p.type === "CE_MASTER_PROMPT");
  const defaultMasterId = masterPrompts.find(p => p.isActive)?.id ?? masterPrompts[0]?.id ?? "";
  const [selectedMasterId, setSelectedMasterId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [editingMaster, setEditingMaster] = useState(false);
  const [proposal, setProposal] = useState<{ promptText: string; summary: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    if (!selectedMasterId && defaultMasterId) setSelectedMasterId(defaultMasterId);
  }, [defaultMasterId, selectedMasterId]);

  const selectedMaster = masterPrompts.find(p => p.id === selectedMasterId) ?? null;

  async function runMasterEdit() {
    if (!selectedMasterId || !instruction.trim()) { toast.error("เลือก Master Prompt และใส่คำสั่งก่อน"); return; }
    setEditingMaster(true);
    setProposal(null);
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}/prompts/master-edit${setQs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId: selectedMasterId, instruction: instruction.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "ปรับ Master Prompt ไม่สำเร็จ"); return; }
      setProposal({ promptText: d.promptText, summary: d.summary });
    } catch (e) {
      toast.error(`ปรับ Master Prompt ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setEditingMaster(false);
    }
  }

  async function saveMasterEdit() {
    if (!proposal || !selectedMasterId) return;
    setSavingEdit(true);
    try {
      const r = await fetch(`/api/prompts/${selectedMasterId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptText: proposal.promptText, changeNote: proposal.summary || instruction.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "บันทึกไม่สำเร็จ"); return; }
      toast.success("บันทึกเวอร์ชันใหม่แล้ว");
      setProposal(null);
      setInstruction("");
      setRefreshKey(k => k + 1);
    } finally {
      setSavingEdit(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{error}</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-brand-navy mb-2">สถานะ Layer</p>
        <div className="flex flex-wrap gap-1.5">
          {REQUIRED_TYPES.map(t => {
            const active = !!items?.some(p => p.type === t && p.isActive);
            return (
              <span key={t} className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                {active ? "✓" : "✕"} {LAYER_LABELS[t]}
              </span>
            );
          })}
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          การเขียนบทความต้องมีครบ Business Skill, Master Prompt, Article Brief, Validator Pack — Business Skill ต้องสแกน/เขียนเฉพาะของลูกค้ารายนี้เท่านั้น
        </p>
      </div>

      {seeding && (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 px-4 py-3 text-sm text-indigo-700">
          <Loader2 size={14} className="animate-spin" /> กำลังตั้งค่าเริ่มต้นจากระบบล่าสุด…
        </div>
      )}
      {!seeding && items && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={runSeed}>
            <RefreshCw size={12} className="mr-1.5" /> รีเซ็ต layer ที่ขาดจากระบบล่าสุด
          </Button>
        </div>
      )}

      {/* การ์ด: สร้าง Master Prompt จากบทความตัวอย่าง */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-brand-navy">สร้าง Master Prompt จากบทความตัวอย่าง</p>
          <p className="text-xs text-gray-500 mt-0.5">ใส่ลิงก์หรือวางข้อความบทความตัวอย่าง 3-5 ชิ้น ให้ Mars สรุปเป็น Master Prompt (อาจใช้เวลาถึง 5 นาที)</p>
        </div>
        <div className="space-y-2">
          {exampleRows.map((row, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
                <button type="button" onClick={() => updateExampleRow(i, { mode: "url" })}
                  className={`px-2 py-1.5 text-[11px] font-semibold ${row.mode === "url" ? "bg-brand-mist text-brand-blue" : "bg-white text-gray-400"}`}>URL</button>
                <button type="button" onClick={() => updateExampleRow(i, { mode: "text" })}
                  className={`px-2 py-1.5 text-[11px] font-semibold border-l border-gray-200 ${row.mode === "text" ? "bg-brand-mist text-brand-blue" : "bg-white text-gray-400"}`}>ข้อความ</button>
              </div>
              {row.mode === "url" ? (
                <Input value={row.value} onChange={e => updateExampleRow(i, { value: e.target.value })}
                  placeholder="https://example.com/article" className="flex-1 text-xs h-9" />
              ) : (
                <Textarea value={row.value} onChange={e => updateExampleRow(i, { value: e.target.value })}
                  placeholder="วางเนื้อหาบทความตัวอย่างที่นี่" rows={2} className="flex-1 text-xs" />
              )}
              <button onClick={() => removeExampleRow(i)} disabled={exampleRows.length <= 3}
                className="text-gray-300 hover:text-red-400 disabled:opacity-30 disabled:hover:text-gray-300 shrink-0 mt-2">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        {exampleRows.length < 5 && (
          <button onClick={addExampleRow} className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl py-2 hover:border-gray-400 hover:text-gray-600 transition-colors">
            <Plus size={12} /> เพิ่มตัวอย่าง (สูงสุด 5)
          </button>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-center pt-1">
          <Input value={exampleName} onChange={e => setExampleName(e.target.value)} placeholder="ชื่อ Master Prompt (ไม่บังคับ)" className="text-xs h-9" />
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer whitespace-nowrap">
            <input type="checkbox" checked={exampleActivate} onChange={e => setExampleActivate(e.target.checked)} />
            ตั้งเป็น Master Prompt ที่ใช้งาน
          </label>
        </div>
        <Button size="sm" disabled={creatingMaster} onClick={createMasterFromExamples}>
          {creatingMaster ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Sparkles size={12} className="mr-1.5" />}
          {creatingMaster ? `กำลังสร้าง... (${createElapsed}s)` : "สร้าง Master Prompt"}
        </Button>
      </div>

      {/* การ์ด: แก้ Master Prompt ด้วยคำสั่ง */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-brand-navy">แก้ Master Prompt ด้วยคำสั่ง</p>
          <p className="text-xs text-gray-500 mt-0.5">บอก Mars ว่าอยากแก้อะไรในภาษาคน แล้วตรวจร่างก่อนบันทึกจริง</p>
        </div>
        {masterPrompts.length === 0 ? (
          <p className="text-xs text-gray-400">ยังไม่มี Master Prompt — สร้างจากบทความตัวอย่างด้านบนก่อน</p>
        ) : (
          <>
            <select value={selectedMasterId} onChange={e => { setSelectedMasterId(e.target.value); setProposal(null); }}
              className="w-full h-9 rounded-md border border-gray-200 px-2 text-xs bg-white">
              {masterPrompts.map(p => <option key={p.id} value={p.id}>{p.name}{p.isActive ? " (ใช้งานอยู่)" : ""}</option>)}
            </select>
            <Textarea value={instruction} onChange={e => setInstruction(e.target.value)} rows={2}
              placeholder="เช่น เพิ่มโทนเป็นกันเอง ลดความยาว 20%" className="text-xs" />
            <Button size="sm" disabled={editingMaster} onClick={runMasterEdit}>
              {editingMaster ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Wand2 size={12} className="mr-1.5" />}
              {editingMaster ? "กำลังปรับ..." : "ให้ Mars ปรับ"}
            </Button>

            {proposal && (
              <div className="space-y-2 pt-2 border-t border-gray-100">
                {proposal.summary && <p className="text-xs text-gray-600">{proposal.summary}</p>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 mb-1">เดิม</p>
                    <pre className="text-[11px] whitespace-pre-wrap font-mono bg-gray-50 border border-gray-100 rounded-lg p-2 max-h-56 overflow-y-auto">{selectedMaster?.promptText}</pre>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 mb-1">ร่างใหม่</p>
                    <pre className="text-[11px] whitespace-pre-wrap font-mono bg-emerald-50 border border-emerald-100 rounded-lg p-2 max-h-56 overflow-y-auto">{proposal.promptText}</pre>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" disabled={savingEdit} onClick={saveMasterEdit}>
                    {savingEdit ? "กำลังบันทึก..." : "บันทึกเป็นเวอร์ชันใหม่"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setProposal(null)}>ยกเลิก</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {!items || !fetchReady ? (
        <div className="p-8 text-sm text-gray-400">กำลังโหลด Content Engine...</div>
      ) : (
        <div className="ua-ce">
          {/* Content Engine เป็น component กลาง (แก้ไฟล์ไม่ได้) ออกแบบมาให้กินเต็มหน้า — พอมาอยู่ใน Project Setting ที่มีเมนูซ้ายอีกชั้น
              จอเลยถูกบีบ: ปรับเฉพาะในหน้านี้ ① เมนู CE เป็นแถบแนวนอน ② พื้นที่แคบให้ลิสต์กับฟอร์มแก้ไขซ้อนกัน
              ③ ช่องที่สั่ง span 2/4 ใน grid 2 คอลัมน์ทำคอลัมน์งอกจนช่องโดนบีบ → ให้เต็มแถว */}
          <style>{CE_LAYOUT_CSS}</style>
          <ContentEngineSettingsClient
            items={items}
            scope={{ projectId: scopeId }}
            userRole={userRole}
            onRefresh={() => setRefreshKey(k => k + 1)}
          />
        </div>
      )}
    </div>
  );
}
