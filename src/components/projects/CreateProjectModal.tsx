"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const INDUSTRY_OPTIONS = [
  "Healthcare", "Travel", "Ecommerce", "Home Improvement", "Fintech",
  "Education", "Real Estate", "Food & Beverage", "Beauty & Wellness",
  "Technology / SaaS", "Legal", "Finance & Insurance", "Automotive",
  "Fashion", "Media & Entertainment", "Non-profit", "Other",
];

export default function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const logoRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  const [form, setForm] = useState({
    name: "",
    clientName: "",
    website: "",
    businessType: "",
    industry: "",
    targetAudience: "",
    language: "th",
    market: "",
    notes: "",
    wpUrl: "",
    wpUser: "",
    wpAppPassword: "",
  });
  const [showWp, setShowWp] = useState(false);

  function update(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Project name is required."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to create project");
      }
      const project = await res.json();

      // upload logo if selected
      if (logoFile) {
        const fd = new FormData();
        fd.append("logo", logoFile);
        await fetch(`/api/projects/${project.id}/logo`, { method: "POST", body: fd });
      }

      onClose();
      router.push(`/projects/${project.id}`);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>สร้างโปรเจกต์ใหม่</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Logo upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">โลโก้ Client</label>
            <div className="flex items-center gap-3">
              <div
                onClick={() => logoRef.current?.click()}
                className="w-16 h-16 rounded-2xl border-2 border-dashed border-gray-200 hover:border-gray-400 flex items-center justify-center cursor-pointer overflow-hidden transition-colors bg-gray-50"
              >
                {logoPreview
                  ? <img src={logoPreview} alt="logo" className="w-full h-full object-cover" />
                  : <Upload size={18} className="text-gray-300" />
                }
              </div>
              <div>
                <button type="button" onClick={() => logoRef.current?.click()}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                  {logoPreview ? "เปลี่ยนโลโก้" : "อัพโหลดโลโก้"}
                </button>
                <p className="text-[11px] text-gray-400 mt-0.5">PNG, JPG, SVG · แนะนำ 200×200px</p>
                {logoPreview && (
                  <button type="button" onClick={() => { setLogoPreview(null); setLogoFile(null); }}
                    className="text-[11px] text-red-400 hover:text-red-600 flex items-center gap-0.5 mt-0.5">
                    <X size={10} /> ลบ
                  </button>
                )}
              </div>
              <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ชื่อโปรเจกต์ <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="เช่น Convert Cake"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 placeholder:text-gray-300"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">เว็บไซต์</label>
            <input
              type="text"
              value={form.website}
              onChange={(e) => update("website", e.target.value)}
              placeholder="เช่น convertcake.com"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 placeholder:text-gray-300"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ภาษา</label>
              <select
                value={form.language}
                onChange={(e) => update("language", e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
              >
                <option value="th">ไทย (TH)</option>
                <option value="en">English (EN)</option>
                <option value="both">ทั้งสอง (TH + EN)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ประเภทธุรกิจ</label>
              <input
                type="text"
                value={form.businessType}
                onChange={(e) => update("businessType", e.target.value)}
                placeholder="เช่น Performance Marketing Agency"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 placeholder:text-gray-300"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
            <select
              value={form.industry}
              onChange={(e) => update("industry", e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
            >
              <option value="">— เลือก Industry —</option>
              {INDUSTRY_OPTIONS.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">กลุ่มเป้าหมาย</label>
            <textarea
              value={form.targetAudience}
              onChange={(e) => update("targetAudience", e.target.value)}
              placeholder="เช่น ธุรกิจที่ต้องการทำโฆษณา SEO Performance Marketing"
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none placeholder:text-gray-300"
            />
          </div>

          {/* WordPress Connection */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowWp(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">🔗</span>
                <span className="text-sm font-medium text-gray-700">WordPress Connection</span>
                {form.wpUrl && (
                  <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">ตั้งค่าแล้ว</span>
                )}
              </div>
              <span className="text-gray-400 text-xs">{showWp ? "▲" : "▼"}</span>
            </button>

            {showWp && (
              <div className="p-4 space-y-3 border-t border-gray-100">
                <p className="text-xs text-gray-400">
                  ข้อมูลนี้จะถูกเก็บต่อโปรเจค — ใช้สำหรับ Push บทความขึ้นเว็บไซต์นี้โดยเฉพาะ
                </p>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">WordPress URL</label>
                  <input
                    type="url"
                    value={form.wpUrl}
                    onChange={(e) => update("wpUrl", e.target.value)}
                    placeholder="https://yoursite.com"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Username</label>
                    <input
                      type="text"
                      value={form.wpUser}
                      onChange={(e) => update("wpUser", e.target.value)}
                      placeholder="admin"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Application Password</label>
                    <input
                      type="password"
                      value={form.wpAppPassword}
                      onChange={(e) => update("wpAppPassword", e.target.value)}
                      placeholder="xxxx xxxx xxxx xxxx"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-gray-400">
                  สร้าง Application Password ได้ที่ WP Admin → Users → Profile → Application Passwords
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              disabled={loading}
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? "กำลังสร้าง..." : "สร้างโปรเจกต์"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
