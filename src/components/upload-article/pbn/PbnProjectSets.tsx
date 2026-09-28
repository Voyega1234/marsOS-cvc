"use client";

/**
 * PBN Backlinks > Project Setting > ข้อมูลโปรเจกต์ PBN (หลาย set)
 * แต่ละ set = เว็บหลักที่ต้องการดันอันดับ (money site) + ภาษา + Content Engine ของตัวเอง
 * - set หลัก = website / language ของโปรเจกต์ PBN เดิม (Content Engine เดิมใช้ต่อได้)
 * - set อื่นเก็บใน pushPrefs.pbnProfiles — ตอนเขียนบทความเลือกได้ว่าจะใช้ set ไหน
 */
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UploadClientDTO } from "@/lib/upload-article/types";
import { PBN_LANGUAGE_LABEL, type PbnLanguage, type PbnProfile } from "@/lib/upload-article/pbn-sets";

const labelCls = "block text-xs font-semibold text-gray-600 mb-1";
const selectCls = "w-full h-10 rounded-md border border-gray-200 px-3 text-sm bg-white";

type SetDraft = { name: string; website: string; language: PbnLanguage };

function SetFields({ d, setD, showName }: { d: SetDraft; setD: (d: SetDraft) => void; showName: boolean }) {
  return (
    <div className={`grid grid-cols-1 gap-3 ${showName ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
      {showName && (
        <div>
          <label className={labelCls}>ชื่อ set</label>
          <Input value={d.name} onChange={e => setD({ ...d, name: e.target.value })} placeholder="เช่น คอนโดกรุงเทพ" />
        </div>
      )}
      <div>
        <label className={labelCls}>เว็บหลักที่ต้องการดันอันดับ (money site)</label>
        <Input value={d.website} onChange={e => setD({ ...d, website: e.target.value })} placeholder="https://www.example.com" />
      </div>
      <div>
        <label className={labelCls}>ภาษา</label>
        <select value={d.language} onChange={e => setD({ ...d, language: e.target.value as PbnLanguage })} className={selectCls}>
          <option value="th">ไทยเท่านั้น</option>
          <option value="en">อังกฤษเท่านั้น</option>
          <option value="both">ไทย+อังกฤษ</option>
        </select>
      </div>
    </div>
  );
}

function MainSet({ client, setClient }: { client: UploadClientDTO; setClient: (c: UploadClientDTO) => void }) {
  const [d, setD] = useState<SetDraft>({ name: "", website: client.website, language: client.language as PbnLanguage });
  const [saving, setSaving] = useState(false);
  const dirty = d.website.trim() !== client.website || d.language !== client.language;

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website: d.website.trim(), language: d.language }),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || "บันทึกไม่สำเร็จ");
      setClient(res);
      toast.success("บันทึก set หลักแล้ว");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-gray-100 rounded-lg p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-brand-navy">set หลัก</span>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brand-mist text-brand-blue">ค่าเริ่มต้นตอนเขียน</span>
      </div>
      <SetFields d={d} setD={setD} showName={false} />
      <Button size="sm" disabled={saving || !dirty} onClick={save}>{saving ? "กำลังบันทึก..." : "บันทึก"}</Button>
    </div>
  );
}

function ProfileForm({
  profile, onDone, onCancel,
}: {
  profile: PbnProfile | null;
  onDone: (p: PbnProfile) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<SetDraft>(
    profile ? { name: profile.name, website: profile.website, language: profile.language } : { name: "", website: "", language: "th" },
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(profile ? `/api/pbn-backlinks/profiles/${profile.id}` : "/api/pbn-backlinks/profiles", {
        method: profile ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: d.name.trim(), website: d.website.trim(), language: d.language }),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || "บันทึกไม่สำเร็จ");
      toast.success(profile ? "บันทึก set แล้ว" : "เพิ่ม set แล้ว — ไปตั้ง Content Engine ของ set นี้ที่เมนู Content Engine");
      onDone(res.profile);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-brand-soft/60 rounded-lg p-3 space-y-3">
      <p className="text-xs font-semibold text-brand-navy">{profile ? `แก้ไข set: ${profile.name}` : "เพิ่ม set ใหม่"}</p>
      <SetFields d={d} setD={setD} showName />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={saving || (!d.name.trim() && !d.website.trim())} onClick={save}>
          {saving ? "กำลังบันทึก..." : profile ? "บันทึก" : "เพิ่ม set"}
        </Button>
        <Button size="sm" variant="outline" disabled={saving} onClick={onCancel}>ยกเลิก</Button>
      </div>
    </div>
  );
}

export default function PbnProjectSets({
  client, setClient, profiles, setProfiles, loading, error,
}: {
  client: UploadClientDTO;
  setClient: (c: UploadClientDTO) => void;
  profiles: PbnProfile[];
  setProfiles: React.Dispatch<React.SetStateAction<PbnProfile[]>>;
  loading: boolean;
  error: string | null;
}) {
  const [editing, setEditing] = useState<PbnProfile | "new" | null>(null);

  async function remove(p: PbnProfile) {
    if (!confirm(`ลบ set "${p.name}"? (บทความที่เขียนด้วย set นี้แล้วยังอยู่ — ถ้าเขียนใหม่/Generate ใหม่จะกลับไปใช้ set หลัก)`)) return;
    const r = await fetch(`/api/pbn-backlinks/profiles/${p.id}`, { method: "DELETE" });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error || "ลบไม่สำเร็จ");
      return;
    }
    setProfiles(prev => prev.filter(x => x.id !== p.id));
    toast.success("ลบ set แล้ว");
  }

  function onSaved(p: PbnProfile) {
    setProfiles(prev => (prev.some(x => x.id === p.id) ? prev.map(x => (x.id === p.id ? p : x)) : [...prev, p]));
    setEditing(null);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-brand-navy">ข้อมูลโปรเจกต์ PBN ({profiles.length + 1} set)</p>
          <p className="text-[11px] text-gray-400">
            แต่ละ set = เว็บหลักที่ต้องการดันอันดับ + ภาษา + Content Engine ของตัวเอง — ตอนเขียนบทความเลือกได้ว่าจะใช้ set ไหน
            (ไม่ใช่เว็บที่ push บทความขึ้น)
          </p>
        </div>
        {editing === null && (
          <Button size="sm" onClick={() => setEditing("new")}><Plus size={13} className="mr-1" /> เพิ่ม set</Button>
        )}
      </div>

      <MainSet client={client} setClient={setClient} />

      {loading && <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> กำลังโหลด...</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}

      {profiles.map(p => (editing !== null && editing !== "new" && editing.id === p.id ? (
        <ProfileForm key={p.id} profile={p} onDone={onSaved} onCancel={() => setEditing(null)} />
      ) : (
        <div key={p.id} className="border border-gray-100 rounded-lg px-3 py-2.5 flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-brand-navy">{p.name}</span>
          <span className="text-[11px] text-gray-400 truncate max-w-[260px]">{p.website || "(ยังไม่ใส่เว็บหลัก)"}</span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{PBN_LANGUAGE_LABEL[p.language]}</span>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => setEditing(p)}><Pencil size={12} /></Button>
            <Button size="sm" variant="outline" onClick={() => remove(p)}><Trash2 size={12} className="text-red-500" /></Button>
          </div>
        </div>
      )))}

      {editing === "new" && <ProfileForm profile={null} onDone={onSaved} onCancel={() => setEditing(null)} />}
    </div>
  );
}
