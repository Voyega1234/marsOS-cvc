"use client";

/**
 * Project Setting > Author Box — ตั้งได้หลายคน ระบบเลือก 1 คนใส่ท้ายแต่ละบทความ (คนแรกเสมอ หรือสุ่มแบบคงที่ตามบทความ)
 * พอร์ตหน้าตามาจาก Article Lab (ClientDetailTabs.tsx, sub-tab ผู้เขียน) — เก็บที่ pushPrefs.author
 * เป็น heavy key (รูปโปรไฟล์เป็น base64) ไม่ส่งมากับ UploadClientDTO — โหลด/บันทึกผ่าน /clients/[id]/author เอง
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, UserRound, ChevronDown, ChevronUp, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downscaleDataUrl, fileToDownscaledDataUrl } from "@/lib/imageDownscale";
import type { UploadClientDTO } from "@/lib/upload-article/types";
import { AUTHOR_CARD_STYLES } from "@/lib/articleAuthorCard";
import { AuthorCardPreview } from "./AuthorCardPreview";
import {
  DEFAULT_UPLOAD_AUTHOR, UPLOAD_AUTHOR_MAX, uploadAuthorSummary,
  type AuthorProfile, type UploadAuthorSettings,
} from "@/lib/upload-article/author";

function emptyAuthor(id: string): AuthorProfile {
  return { id, name: "", title: "", credentials: [] };
}

/** SEO SME เก็บเพศผู้เขียนไว้ใช้กับ AUTHOR PERSONA ใน prompt — Upload Article ไม่มีช่องนี้ */
export type EditableAuthorProfile = AuthorProfile & { gender?: string };

function AuthorProfileEditor({ author, onChange, isOpen, onToggle, onRemove, canRemove, withGender }: {
  author: EditableAuthorProfile;
  onChange: (patch: Partial<EditableAuthorProfile>) => void;
  isOpen: boolean;
  onToggle: () => void;
  onRemove: () => void;
  canRemove: boolean;
  withGender?: boolean;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3">
        <button onClick={onToggle} className="text-gray-400 hover:text-gray-600 shrink-0">
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {author.image ? (
          <img src={author.image} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
        ) : (
          <UserRound size={16} className="text-gray-300 shrink-0" />
        )}
        <span className="flex-1 text-sm font-semibold text-brand-navy min-w-0 truncate">
          {author.name || "ผู้เขียนใหม่"}
        </span>
        <button onClick={onRemove} disabled={!canRemove} title="ลบ" className="text-gray-300 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed shrink-0">
          <Trash2 size={14} />
        </button>
      </div>

      {isOpen && (
        <div className="border-t border-gray-100 p-4 space-y-3">
          <div className="flex gap-3">
            <div className="shrink-0">
              {author.image ? (
                <div className="relative">
                  <img src={author.image} alt="" className="w-20 h-20 rounded-full object-cover border border-gray-100" />
                  <button onClick={() => onChange({ image: undefined })}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center leading-none">
                    ✕
                  </button>
                </div>
              ) : (
                <label className="w-20 h-20 rounded-full border border-dashed border-blue-300 flex items-center justify-center cursor-pointer text-[10px] text-blue-500 hover:border-blue-500 transition-colors text-center px-1">
                  <span>+ รูป</span>
                  <input type="file" accept="image/*" className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      fileToDownscaledDataUrl(file, 600)
                        .then((url) => onChange({ image: url }))
                        .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
                      e.target.value = "";
                    }} />
                </label>
              )}
            </div>
            <div className="flex-1 space-y-2 min-w-0">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">ชื่อ</label>
                <input value={author.name} onChange={(e) => onChange({ name: e.target.value.slice(0, 100) })}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">ตำแหน่ง / คำอธิบาย</label>
                <input value={author.title} onChange={(e) => onChange({ title: e.target.value.slice(0, 150) })}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200" />
              </div>
              {withGender && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">เพศ (ใช้ปรับสรรพนามในบทความ)</label>
                  <select value={author.gender || "none"} onChange={(e) => onChange({ gender: e.target.value })}
                    className="text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200">
                    <option value="none">ไม่ระบุ</option>
                    <option value="male">ชาย</option>
                    <option value="female">หญิง</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">วุฒิ/ใบรับรอง/ประสบการณ์ (บรรทัดละข้อ)</label>
            <textarea
              value={author.credentials.join("\n")}
              onChange={(e) => onChange({ credentials: e.target.value.split("\n").slice(0, 20).map((s) => s.slice(0, 200)) })}
              rows={4}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200"
              placeholder={"เช่น ปริญญาโท การตลาดดิจิทัล\nประสบการณ์เขียนบทความ SEO 5 ปี"}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ตัวแก้ Author Box (ไม่ผูกที่เก็บ) — Upload Article / PBN ใช้ผ่าน AuthorSection ด้านล่าง,
 * SEO SME (Article Lab) และ Content Studio ใช้ตัวเดียวกันโดยส่ง load/save ของตัวเองมา
 */
export function AuthorSettingsEditor({ loadKey, load, save: persist, description, withGender }: {
  /** เปลี่ยนค่านี้ = โหลดใหม่ */
  loadKey: string;
  load: () => Promise<UploadAuthorSettings>;
  /** ส่งค่าที่ย่อรูปแล้ว คืนค่าที่บันทึกจริง — error ให้ throw Error(ข้อความ) */
  save: (slim: UploadAuthorSettings) => Promise<UploadAuthorSettings>;
  description?: React.ReactNode;
  withGender?: boolean;
}) {
  const [draft, setDraft] = useState<UploadAuthorSettings>(DEFAULT_UPLOAD_AUTHOR);
  const [saved, setSaved] = useState<UploadAuthorSettings>(DEFAULT_UPLOAD_AUTHOR);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const d = await load();
      setDraft(d);
      setSaved(d);
      setOpenId(d.authors?.[0]?.id ?? null);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "โหลด Author Box ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, [loadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function save() {
    setSaving(true);
    try {
      // รูปโปรไฟล์เป็น base64 ที่อาจใหญ่หลาย MB — ย่อก่อนส่งทุกครั้งกันชนเพดาน 4.5MB ของ Vercel
      const slim: UploadAuthorSettings = {
        ...draft,
        authors: await Promise.all(draft.authors.map(async (a) => (
          a.image ? { ...a, image: await downscaleDataUrl(a.image, 600) } : a
        ))),
      };
      let d: UploadAuthorSettings;
      try {
        d = await persist(slim);
      } catch (e) {
        toast.error(e instanceof Error && e.message ? e.message : "บันทึกไม่สำเร็จ");
        return;
      }
      setDraft(d);
      setSaved(d);
      toast.success("บันทึก Author Box แล้ว");
    } finally {
      setSaving(false);
    }
  }

  function updateAuthor(id: string, patch: Partial<AuthorProfile>) {
    setDraft((p) => ({ ...p, authors: p.authors.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  }

  function addAuthor() {
    if (draft.authors.length >= UPLOAD_AUTHOR_MAX) return;
    const id = `author-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const author = emptyAuthor(id);
    setDraft((p) => ({ ...p, authors: [...p.authors, author] }));
    setOpenId(id);
  }

  function removeAuthor(id: string) {
    const author = draft.authors.find((a) => a.id === id);
    if (!author) return;
    if (!window.confirm(`ลบผู้เขียน "${author.name || "รายการนี้"}" ใช่ไหม?`)) return;
    setDraft((p) => ({ ...p, authors: p.authors.filter((a) => a.id !== id) }));
    if (openId === id) setOpenId(null);
  }

  if (loading) return <p className="text-sm text-gray-400 text-center py-10">กำลังโหลด...</p>;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <div>
            <p className="text-sm font-bold text-brand-navy flex items-center gap-1.5"><UserRound size={14} /> Author Box (กล่องผู้เขียน)</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {description ?? "กล่องผู้เขียนจะถูกใส่ท้ายบทความอัตโนมัติทุกบทความที่เปิดใช้งานนี้ ระบบเลือก 1 คนตามโหมดที่ตั้งไว้"}
            </p>
          </div>
          <button
            onClick={() => setDraft((prev) => ({ ...prev, enabled: !prev.enabled }))}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${draft.enabled ? "bg-emerald-500" : "bg-gray-200"}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${draft.enabled ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>

        {draft.enabled && (
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-xs font-medium text-gray-600 mb-1.5">สไตล์การ์ด</p>
              <div className="flex gap-1">
                {AUTHOR_CARD_STYLES.map((s) => (
                  <button key={s.key} onClick={() => setDraft((p) => ({ ...p, style: s.key }))}
                    title={s.description}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${draft.style === s.key ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 text-gray-500 hover:border-gray-400"}`}>
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 mt-1.5">
                {AUTHOR_CARD_STYLES.find((s) => s.key === draft.style)?.description}
              </p>
              <div className="mt-2">
                <AuthorCardPreview style={draft.style} author={draft.authors[0]} />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-600">เลือกผู้เขียนต่อบทความ</label>
              <select
                value={draft.pick}
                onChange={(e) => setDraft((p) => ({ ...p, pick: e.target.value === "random" ? "random" : "first" }))}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-gray-200"
              >
                <option value="first">ใช้คนแรกเสมอ</option>
                <option value="random">สุ่ม (คงที่ตามบทความ)</option>
              </select>
            </div>
          </div>
        )}

        {!draft.enabled && (
          <div className="text-center py-8 text-gray-400">
            <p className="text-sm">เปิด Author Box เพื่อตั้งค่า</p>
          </div>
        )}
      </div>

      {draft.enabled && (
        <div className="space-y-3">
          {draft.authors.map((author) => (
            <AuthorProfileEditor
              key={author.id}
              author={author}
              onChange={(patch) => updateAuthor(author.id, patch)}
              isOpen={openId === author.id}
              onToggle={() => setOpenId((cur) => (cur === author.id ? null : author.id))}
              onRemove={() => removeAuthor(author.id)}
              canRemove
              withGender={withGender}
            />
          ))}

          {draft.authors.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-6 border border-dashed border-gray-200 rounded-2xl">ยังไม่มีผู้เขียน — กด "เพิ่มผู้เขียน" ด้านล่าง</p>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={addAuthor}
              disabled={draft.authors.length >= UPLOAD_AUTHOR_MAX}
              className="flex items-center gap-1 text-xs px-3 py-1.5 border border-dashed border-gray-300 rounded-full text-gray-500 hover:border-gray-500 hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <Plus size={12} /> เพิ่มผู้เขียน
            </button>
            <span className="text-[11px] text-gray-400">{draft.authors.length}/{UPLOAD_AUTHOR_MAX} คน</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={!dirty || saving}>
          {saving && <Loader2 size={12} className="mr-1.5 animate-spin" />} บันทึก
        </Button>
        {dirty && <span className="text-xs text-amber-600">ยังไม่ได้บันทึก</span>}
      </div>
    </div>
  );
}

export default function AuthorSection({ client, setClient }: {
  client: UploadClientDTO;
  setClient: (c: UploadClientDTO) => void;
}) {
  return (
    <AuthorSettingsEditor
      loadKey={client.id}
      load={async () => {
        const r = await fetch(`/api/upload-article/clients/${client.id}/author`);
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || "โหลด Author Box ไม่สำเร็จ");
        return d;
      }}
      save={async (slim) => {
        const r = await fetch(`/api/upload-article/clients/${client.id}/author`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(slim),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || "บันทึกไม่สำเร็จ");
        setClient({ ...client, authorSummary: uploadAuthorSummary(d) });
        return d;
      }}
    />
  );
}
