"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Plus, Star, Edit2, Layers } from "lucide-react";

interface Template {
  id: string;
  name: string;
  brandName: string;
  language: string;
  brandVoice?: string | null;
  colorTheme?: string | null;
  isDefault: boolean;
  ctaText?: string | null;
  referenceRules?: string | null;
  forbiddenClaims?: string | null;
  imageStyle?: string | null;
}

interface Props { templates: Template[]; orgId: string; }

export function TemplatesClient({ templates: initial, orgId }: Props) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Omit<Template, "id">>({
    name: "", brandName: "", language: "th", brandVoice: "", colorTheme: "", isDefault: false,
    ctaText: "", referenceRules: "", forbiddenClaims: "", imageStyle: "",
  });

  const editingTemplate = templates.find((t) => t.id === editingId);

  function openEdit(t: Template) {
    setForm({ ...t });
    setEditingId(t.id);
  }

  function openCreate() {
    setForm({ name: "", brandName: "", language: "th", brandVoice: "", colorTheme: "", isDefault: false, ctaText: "", referenceRules: "", forbiddenClaims: "", imageStyle: "" });
    setCreating(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const url = editingId ? `/api/templates/${editingId}` : "/api/templates";
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, organizationId: orgId }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("บันทึก Template สำเร็จ!");
      setEditingId(null);
      setCreating(false);
      router.refresh();
    } catch {
      toast.error("เกิดข้อผิดพลาด");
    } finally {
      setSaving(false);
    }
  }

  const isOpen = !!editingId || creating;
  const closeDialog = () => { setEditingId(null); setCreating(false); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Brand Templates</h1>
          <p className="text-gray-500 text-sm mt-1">{templates.length} templates</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> สร้าง Template ใหม่
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {templates.map((t) => (
          <div key={t.id} className={`bg-white rounded-xl border p-5 ${t.isDefault ? "border-green-400 ring-2 ring-green-200" : ""}`}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center">
                  <Layers className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{t.name}</h3>
                  <p className="text-xs text-gray-500">{t.brandName} · {t.language.toUpperCase()}</p>
                </div>
              </div>
              {t.isDefault && (
                <div className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                  <Star className="h-3 w-3 fill-current" /> Default
                </div>
              )}
            </div>

            <div className="space-y-1.5 text-sm text-gray-600">
              {t.brandVoice && <p className="truncate">🗣️ {t.brandVoice}</p>}
              {t.colorTheme && <p>🎨 {t.colorTheme}</p>}
              {t.imageStyle && <p className="truncate">🖼️ {t.imageStyle}</p>}
            </div>

            {t.forbiddenClaims && (
              <div className="mt-3 p-2.5 bg-red-50 rounded-lg">
                <p className="text-xs text-red-600 font-medium">⛔ ข้อห้าม:</p>
                <p className="text-xs text-red-500 truncate">{t.forbiddenClaims}</p>
              </div>
            )}

            <div className="mt-4 pt-3 border-t flex justify-end">
              <Button variant="outline" size="sm" onClick={() => openEdit(t)} className="gap-1.5">
                <Edit2 className="h-3.5 w-3.5" /> แก้ไข
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit/Create Dialog */}
      <Dialog open={isOpen} onOpenChange={closeDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "แก้ไข Template" : "สร้าง Template ใหม่"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>ชื่อ Template</Label>
              <Input className="mt-1" value={form.name} onChange={(e) => setForm((f) => ({...f, name: e.target.value}))} />
            </div>
            <div>
              <Label>Brand Name</Label>
              <Input className="mt-1" value={form.brandName} onChange={(e) => setForm((f) => ({...f, brandName: e.target.value}))} />
            </div>
            <div>
              <Label>ภาษา</Label>
              <Input className="mt-1" value={form.language} onChange={(e) => setForm((f) => ({...f, language: e.target.value}))} placeholder="th" />
            </div>
            <div>
              <Label>Color Theme</Label>
              <Input className="mt-1" value={form.colorTheme ?? ""} onChange={(e) => setForm((f) => ({...f, colorTheme: e.target.value}))} placeholder="green-cream" />
            </div>
            <div className="col-span-2">
              <Label>Brand Voice</Label>
              <Textarea className="mt-1" rows={2} value={form.brandVoice ?? ""} onChange={(e) => setForm((f) => ({...f, brandVoice: e.target.value}))} placeholder="ภาษาทางการ น่าเชื่อถือ..." />
            </div>
            <div className="col-span-2">
              <Label>CTA Text</Label>
              <Textarea className="mt-1" rows={2} value={form.ctaText ?? ""} onChange={(e) => setForm((f) => ({...f, ctaText: e.target.value}))} />
            </div>
            <div className="col-span-2">
              <Label>Reference Rules</Label>
              <Textarea className="mt-1" rows={2} value={form.referenceRules ?? ""} onChange={(e) => setForm((f) => ({...f, referenceRules: e.target.value}))} />
            </div>
            <div className="col-span-2">
              <Label>Forbidden Claims (ข้อห้าม)</Label>
              <Textarea className="mt-1" rows={2} value={form.forbiddenClaims ?? ""} onChange={(e) => setForm((f) => ({...f, forbiddenClaims: e.target.value}))} />
            </div>
            <div className="col-span-2">
              <Label>Image Style</Label>
              <Input className="mt-1" value={form.imageStyle ?? ""} onChange={(e) => setForm((f) => ({...f, imageStyle: e.target.value}))} />
            </div>
            <div className="col-span-2 flex items-center gap-3">
              <Switch checked={form.isDefault} onCheckedChange={(v) => setForm((f) => ({...f, isDefault: v}))} />
              <Label>ตั้งเป็น Default Template</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>ยกเลิก</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "กำลังบันทึก..." : "บันทึก"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
