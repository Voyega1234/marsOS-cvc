"use client";

/**
 * ตัวจัดการรายชื่อ "ผู้ดูแลบทความ" ของลูกค้า (พิมพ์ชื่อเองได้ เช่น ทีมละ 3 คน) — เป็น chip: เพิ่ม / แก้ชื่อในที่ / ลบ (ยืนยันก่อน)
 * บันทึกทั้งก้อนผ่าน PUT /clients/[id]/owner-tags แล้วส่งผลกลับ workspace เพื่อให้ Report/นำเข้า/Publish ตรงกัน
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UPLOAD_MAX_OWNER_TAGS, UPLOAD_MAX_OWNER_TAG_NAME, type UploadOwnerTag } from "@/lib/upload-article/types";

type TagInput = { id?: string; name: string };

const DEFAULT_DESCRIPTION = "พิมพ์ชื่อคนในทีมที่ดูแลลูกค้านี้ แล้วเลือกผู้ดูแลต่อบทความ (แท็บนำเข้า / Publish / ตาราง “บทความที่อัปโหลด” ด้านล่าง) — กรองรายงานทั้งหน้าตามผู้ดูแลได้";

export default function OwnerTagsEditor({
  clientId, ownerTags, articleOwners, onChange, saveUrl, description = DEFAULT_DESCRIPTION,
}: {
  clientId: string;
  ownerTags: UploadOwnerTag[];
  articleOwners: Record<string, string>;
  onChange: (ownerTags: UploadOwnerTag[], articleOwners: Record<string, string>) => void;
  /** URL สำหรับ PUT รายชื่อผู้ดูแล (ไม่ส่ง = ใช้ endpoint ของ Upload Article) — SEO SME ส่ง /api/projects/[id]/owner-tags */
  saveUrl?: string;
  /** ข้อความอธิบายใต้หัวข้อ (ไม่ส่ง = ข้อความของ Upload Article) */
  description?: string;
}) {
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const cancelEditRef = useRef(false);

  async function save(tags: TagInput[]): Promise<boolean> {
    setSaving(true);
    try {
      const r = await fetch(saveUrl ?? `/api/upload-article/clients/${clientId}/owner-tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "บันทึกผู้ดูแลไม่สำเร็จ"); return false; }
      onChange(Array.isArray(d.ownerTags) ? d.ownerTags : [], d.articleOwners && typeof d.articleOwners === "object" ? d.articleOwners : {});
      return true;
    } catch (e) {
      toast.error(`บันทึกผู้ดูแลไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  const nameTaken = (name: string, exceptId?: string) =>
    ownerTags.some(t => t.id !== exceptId && t.name.trim().toLowerCase() === name.trim().toLowerCase());

  async function addTag() {
    const name = newName.trim();
    if (!name) return;
    if (ownerTags.length >= UPLOAD_MAX_OWNER_TAGS) { toast.error(`เพิ่มได้สูงสุด ${UPLOAD_MAX_OWNER_TAGS} ชื่อ`); return; }
    if (nameTaken(name)) { toast.error("มีชื่อนี้อยู่แล้ว"); return; }
    if (await save([...ownerTags, { name }])) setNewName("");
  }

  async function commitRename(tag: UploadOwnerTag) {
    const name = editName.trim();
    setEditingId(null);
    if (cancelEditRef.current) { cancelEditRef.current = false; return; }
    if (!name || name === tag.name) return;
    if (nameTaken(name, tag.id)) { toast.error("มีชื่อนี้อยู่แล้ว"); return; }
    await save(ownerTags.map(t => t.id === tag.id ? { id: t.id, name } : t));
  }

  async function removeTag(tag: UploadOwnerTag) {
    const count = Object.values(articleOwners).filter(id => id === tag.id).length;
    const msg = count > 0
      ? `ลบผู้ดูแล "${tag.name}" ใช่ไหม? บทความ ${count} บทความที่ผูกกับชื่อนี้จะกลับเป็น "ยังไม่ระบุผู้ดูแล"`
      : `ลบผู้ดูแล "${tag.name}" ใช่ไหม?`;
    if (!window.confirm(msg)) return;
    await save(ownerTags.filter(t => t.id !== tag.id));
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2.5">
      <div>
        <p className="text-sm font-semibold text-brand-navy">ผู้ดูแลบทความ</p>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {ownerTags.length === 0 && <span className="text-[11px] text-gray-400">ยังไม่มีชื่อผู้ดูแล</span>}
        {ownerTags.map(tag => (
          <span key={tag.id} className="inline-flex items-center gap-1 rounded-full bg-brand-mist text-brand-blue text-xs font-medium pl-2.5 pr-1 py-0.5">
            {editingId === tag.id ? (
              <input
                autoFocus
                value={editName}
                maxLength={UPLOAD_MAX_OWNER_TAG_NAME}
                onChange={e => setEditName(e.target.value)}
                onBlur={() => void commitRename(tag)}
                onKeyDown={e => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  else if (e.key === "Escape") { cancelEditRef.current = true; setEditingId(null); }
                }}
                className="h-5 w-28 rounded border border-brand-soft/60 bg-white px-1.5 text-xs text-gray-700"
              />
            ) : (
              <button type="button" disabled={saving} title="คลิกเพื่อแก้ชื่อ"
                onClick={() => { cancelEditRef.current = false; setEditingId(tag.id); setEditName(tag.name); }}
                className="hover:underline">
                {tag.name}
              </button>
            )}
            <button type="button" disabled={saving} title="ลบ" onClick={() => void removeTag(tag)}
              className="p-0.5 rounded-full text-brand-blue/60 hover:text-rose-600 hover:bg-white/70">
              <X size={11} />
            </button>
          </span>
        ))}
        {saving && <Loader2 size={13} className="animate-spin text-gray-400" />}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={newName}
          maxLength={UPLOAD_MAX_OWNER_TAG_NAME}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") void addTag(); }}
          placeholder="พิมพ์ชื่อผู้ดูแล"
          disabled={saving}
          className="h-8 w-48 rounded-md border border-gray-200 px-2.5 text-xs"
        />
        <Button size="sm" variant="outline" onClick={() => void addTag()} disabled={saving || !newName.trim()}>
          <Plus size={12} className="mr-1" /> เพิ่ม
        </Button>
      </div>
    </div>
  );
}
