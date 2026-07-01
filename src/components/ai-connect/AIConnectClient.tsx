"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Shield, Lock, Trash2, Star, StarOff,
  Eye, EyeOff, Loader2, CheckCircle2,
  AlertTriangle, Zap, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

type AIProviderKeyRow = {
  id: string;
  provider: string;
  displayName: string;
  keyMasked: string;
  isActive: boolean;
  isDefault: boolean;
};

const PROVIDERS = [
  {
    id: "claude",
    label: "Claude (Anthropic)",
    models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
    placeholder: "sk-ant-api03-...",
    getKeyUrl: "https://console.anthropic.com/settings/keys",
    recommended: true,
    note: "แนะนำสำหรับ Thai content และ SEO เชิงลึก",
  },
  {
    id: "openai",
    label: "OpenAI / GPT",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    placeholder: "sk-proj-...",
    getKeyUrl: "https://platform.openai.com/api-keys",
    note: "Structured content, summarization",
  },
  {
    id: "groq",
    label: "Groq",
    models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
    placeholder: "gsk_...",
    getKeyUrl: "https://console.groq.com/keys",
    note: "เร็วมาก ราคาถูก",
  },
];

const PROVIDER_COLOR: Record<string, string> = {
  claude:  "bg-orange-50 text-orange-700 border-orange-200",
  openai:  "bg-emerald-50 text-emerald-700 border-emerald-200",
  gemini:  "bg-blue-50 text-blue-700 border-blue-200",
  groq:    "bg-purple-50 text-purple-700 border-purple-200",
};

export function AIConnectClient({ initialKeys }: { initialKeys: AIProviderKeyRow[] }) {
  const router = useRouter();
  const [keys, setKeys] = useState<AIProviderKeyRow[]>(initialKeys);

  // Single add form
  const [selectedProvider, setSelectedProvider] = useState(PROVIDERS[0].id);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);

  const provider = PROVIDERS.find((p) => p.id === selectedProvider)!;
  const connectedForProvider = keys.filter((k) => k.provider === selectedProvider);
  const hasAnyKey = keys.length > 0;

  async function handleAdd() {
    if (!apiKey.trim()) { toast.error("กรุณาใส่ API Key"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/ai-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedProvider,
          displayName: provider.label,
          apiKey: apiKey.trim(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created: AIProviderKeyRow = await res.json();
      setKeys((prev) => [...prev, created]);
      setApiKey("");
      toast.success(`เชื่อมต่อ ${provider.label} สำเร็จ! 🔐`);
      router.refresh();
    } catch {
      toast.error("บันทึก Key ไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(keyId: string) {
    const res = await fetch(`/api/settings/ai-providers/${keyId}`, { method: "DELETE" });
    if (!res.ok) { toast.error("ลบ Key ไม่สำเร็จ"); return; }
    setKeys((prev) => prev.filter((k) => k.id !== keyId));
    toast.success("ลบ API Key แล้ว");
  }

  async function handleToggleDefault(key: AIProviderKeyRow) {
    const res = await fetch(`/api/settings/ai-providers/${key.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: !key.isDefault }),
    });
    if (!res.ok) { toast.error("อัปเดตไม่สำเร็จ"); return; }
    const updated: AIProviderKeyRow = await res.json();
    setKeys((prev) =>
      prev.map((k) =>
        k.provider === key.provider
          ? { ...k, isDefault: k.id === updated.id ? updated.isDefault : false }
          : k
      )
    );
    toast.success(updated.isDefault ? "ตั้งเป็น Default แล้ว ⭐" : "ยกเลิก Default แล้ว");
  }

  return (
    <div className="max-w-xl mx-auto space-y-5">

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <h1 className="text-xl font-bold text-gray-900">เชื่อมต่อ AI</h1>
          <span className="flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
            <Lock className="h-3 w-3" />Admin
          </span>
        </div>
        <p className="text-sm text-gray-500">เพิ่ม API key ครั้งเดียว — ระบบใช้ key นี้กับทุกหน้าโดยอัตโนมัติ</p>
      </div>

      {/* Add key form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">

        {/* Provider picker */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">AI Provider</label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setProviderOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white hover:border-gray-300 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-lg border", PROVIDER_COLOR[selectedProvider] ?? "bg-gray-100 text-gray-600")}>
                  {provider.label}
                </span>
                {provider.recommended && (
                  <span className="text-xs text-green-600 font-medium">แนะนำ</span>
                )}
              </div>
              <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
            </button>

            {providerOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setProviderOpen(false)} />
                <div className="absolute z-20 top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                  {PROVIDERS.map((p) => {
                    const connected = keys.some((k) => k.provider === p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => { setSelectedProvider(p.id); setProviderOpen(false); setApiKey(""); }}
                        className={cn(
                          "w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0",
                          selectedProvider === p.id && "bg-blue-50"
                        )}
                      >
                        <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-lg border shrink-0", PROVIDER_COLOR[p.id] ?? "bg-gray-100 text-gray-600")}>
                          {p.label}
                        </span>
                        <span className="flex-1 text-xs text-gray-500">{p.note}</span>
                        {connected && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                        {p.recommended && !connected && <span className="text-xs text-green-600 font-medium shrink-0">แนะนำ</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Models available */}
          <div className="flex flex-wrap gap-1 mt-2">
            {provider.models.map((m) => (
              <span key={m} className="text-[11px] font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{m}</span>
            ))}
          </div>
        </div>

        {/* API Key input */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-gray-500">API Key</label>
            <a
              href={provider.getKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline"
            >
              สร้าง key ที่ {provider.label} →
            </a>
          </div>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
              placeholder={provider.placeholder}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 pr-10 text-sm font-mono placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-900/8 focus:border-gray-400"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Already connected for this provider */}
        {connectedForProvider.length > 0 && (
          <p className="text-xs text-amber-600 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {provider.label} มี key อยู่แล้ว {connectedForProvider.length} ตัว — ใส่เพื่อเพิ่ม key ใหม่
          </p>
        )}

        <button
          onClick={handleAdd}
          disabled={saving || !apiKey.trim()}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          {saving ? "กำลังบันทึก..." : "เชื่อมต่อ"}
        </button>
      </div>

      {/* Security note */}
      <div className="flex items-start gap-2.5 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
        <Shield className="h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-400" />
        <p>Keys เข้ารหัส AES-256 server-side — แสดงเฉพาะ 4 ตัวท้าย ไม่ส่งออก client</p>
      </div>

      {/* Connected keys list */}
      {hasAnyKey && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-700">Keys ที่เชื่อมต่อแล้ว</p>
            <span className="text-xs text-gray-400">{keys.length} keys · ⭐ = Default</span>
          </div>
          <div className="divide-y divide-gray-50">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 px-4 py-3">
                <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-lg border shrink-0", PROVIDER_COLOR[k.provider] ?? "bg-gray-100 text-gray-600 border-gray-200")}>
                  {PROVIDERS.find((p) => p.id === k.provider)?.label ?? k.provider}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="text-sm text-gray-700 font-mono truncate block">{k.keyMasked}</span>
                </span>
                <button
                  onClick={() => handleToggleDefault(k)}
                  title={k.isDefault ? "ยกเลิก Default" : "ตั้งเป็น Default"}
                  className="p-1.5 rounded-lg text-gray-300 hover:text-amber-500 hover:bg-amber-50 transition-colors shrink-0"
                >
                  {k.isDefault
                    ? <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                    : <StarOff className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => handleDelete(k.id)}
                  className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasAnyKey && (
        <div className="text-center py-8 text-gray-400 bg-white rounded-xl border border-dashed border-gray-200">
          <Zap className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">ยังไม่มี API key — เพิ่มด้านบนได้เลย</p>
        </div>
      )}

      {/* Cost estimate */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-700">ประมาณการค่าใช้จ่าย Claude Sonnet</p>
        </div>
        <div className="grid grid-cols-4 divide-x divide-gray-100">
          {[
            { label: "Outline",    cost: "$0.01" },
            { label: "บทความ",    cost: "$0.04" },
            { label: "SEO Check", cost: "$0.02" },
            { label: "100 บทความ/เดือน", cost: "~$7", highlight: true },
          ].map((item) => (
            <div key={item.label} className={`px-3 py-3 ${item.highlight ? "bg-green-50" : ""}`}>
              <p className="text-[11px] text-gray-500">{item.label}</p>
              <p className={`text-base font-semibold tabular-nums mt-0.5 ${item.highlight ? "text-green-700" : "text-gray-900"}`}>{item.cost}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
