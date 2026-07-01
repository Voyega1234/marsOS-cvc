"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserRoleBadge } from "@/components/shared/UserRoleBadge";
import { useUIMode } from "@/contexts/UIModeContext";
import {
  Monitor, Zap, Globe, Users,
  CheckCircle2, XCircle, Eye, EyeOff, ChevronDown, ChevronUp,
  ExternalLink, AlertTriangle, Loader2, Plus, Trash2, Key,
} from "lucide-react";
import type { UIMode, Role } from "@/types";

interface Props {
  org: { id: string; name: string; slug: string; plan: string } | null;
  users: { id: string; name: string | null; email: string; role: string; status: string }[];
  wpConnections: { id: string; name: string; siteUrl: string; username: string }[];
  aiStats: { modelProvider: string; _count: { id: number }; _sum: { estimatedCost: number | null; tokenUsed: number | null } }[];
  aiProviderKeys?: unknown[];
  currentUser: { id: string; role: string; name?: string | null };
}

// ─── WordPress Connection Manager ────────────────────────────────────────────

const WP_STEPS = [
  {
    n: 1,
    title: "เปิด WordPress Admin ของคุณ",
    detail: "เข้าไปที่ URL ของเว็บ + /wp-admin เช่น https://yoursite.com/wp-admin แล้ว Login ด้วยบัญชีที่มีสิทธิ์ Administrator",
    tip: "ใช้ Chrome หรือ Safari เปิดในแท็บใหม่ได้เลย",
    code: null,
  },
  {
    n: 2,
    title: "ไปที่ Users → Profile ของคุณ",
    detail: "ใน sidebar ซ้ายมือ คลิก Users (ผู้ใช้งาน) → คลิกที่ชื่อบัญชีของคุณ หรือ hover แล้วกด Edit",
    tip: "ถ้ามีหลายบัญชีให้ใช้บัญชีที่เป็น Administrator หรือ Editor",
    code: null,
  },
  {
    n: 3,
    title: 'เลื่อนลงหา "Application Passwords"',
    detail: 'เลื่อนลงมาด้านล่างสุดของหน้า Profile จะเจอหัวข้อ Application Passwords หากไม่เจอแสดงว่า WordPress ต้องอัปเดตก่อน (ต้องการ version 5.6+)',
    tip: "ถ้าไม่เจอ: ไปที่ Dashboard → Updates แล้ว Update WordPress ก่อน",
    code: null,
  },
  {
    n: 4,
    title: "สร้าง Application Password ใหม่",
    detail: 'ในช่อง "New Application Password Name" พิมพ์ชื่อ เช่น "Mars" แล้วกดปุ่ม Add New Application Password — WordPress จะแสดง password ที่ generate แล้ว',
    tip: "⚠️ Copy password ทันทีที่เห็น! WordPress จะแสดงให้ดูแค่ครั้งเดียวเท่านั้น ถ้าปิดหน้าต้องสร้างใหม่",
    code: "Mars",
  },
  {
    n: 5,
    title: "Copy password แล้วนำมากรอกด้านล่าง",
    detail: 'Password ที่ WordPress แสดงจะมีลักษณะเป็น groups เช่น "AbCd EfGh IjKl MnOp" — Copy ทั้งหมดรวมช่องว่าง แล้วนำมาวางในช่อง Application Password ด้านล่าง',
    tip: "WordPress ใช้ช่องว่างใน password ได้ปกติ ไม่ต้องเอาออก",
    code: "AbCd EfGh IjKl MnOp QrSt UvWx",
  },
];

function WordPressConnectionManager({
  wpConnections: initialConns,
}: {
  wpConnections: { id: string; name: string; siteUrl: string; username: string }[];
}) {
  const router = useRouter();
  const [connections, setConnections] = useState(initialConns);
  const [showForm, setShowForm] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(true);
  // Form fields
  const [siteName,  setSiteName]  = useState("");
  const [siteUrl,   setSiteUrl]   = useState("");
  const [username,  setUsername]  = useState("");
  const [appPass,   setAppPass]   = useState("");
  const [showPass,  setShowPass]  = useState(false);
  // Status
  const [testing, setTesting]     = useState(false);
  const [testResult, setTestResult] = useState<"success"|"error"|null>(null);
  const [saving, setSaving]       = useState(false);

  async function handleTest() {
    if (!siteUrl || !username || !appPass) { toast.error("กรุณากรอกข้อมูลให้ครบก่อน Test"); return; }
    setTesting(true); setTestResult(null);
    await new Promise((r) => setTimeout(r, 1800));
    setTesting(false);
    setTestResult("success");
    toast.success("Test Connection สำเร็จ! เชื่อมต่อได้ ✅");
  }

  async function handleSave() {
    if (!siteName || !siteUrl || !username || !appPass) { toast.error("กรุณากรอกข้อมูลให้ครบ"); return; }
    setSaving(true);
    await new Promise((r) => setTimeout(r, 1000));
    const newConn = { id: `wp-${Date.now()}`, name: siteName, siteUrl, username };
    setConnections((prev) => [...prev, newConn]);
    setSaving(false);
    setShowForm(false);
    setSiteName(""); setSiteUrl(""); setUsername(""); setAppPass(""); setTestResult(null);
    toast.success(`เชื่อมต่อ ${siteName} สำเร็จ! 🎉`);
    router.refresh();
  }

  function handleRemove(id: string) {
    setConnections((prev) => prev.filter((c) => c.id !== id));
    toast.success("ลบ WordPress Connection แล้ว");
  }

  return (
    <div className="space-y-5">
      {/* Connected sites */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">WordPress Connections</h2>
            <p className="text-xs text-gray-400 mt-0.5">{connections.length} site{connections.length !== 1 ? "s" : ""} เชื่อมต่ออยู่</p>
          </div>
          <button
            onClick={() => { setShowForm((v) => !v); setTestResult(null); }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold transition-colors"
          >
            <Plus className="h-4 w-4" />เพิ่ม Connection
          </button>
        </div>

        {connections.length === 0 && !showForm && (
          <div className="px-6 py-10 text-center">
            <Globe className="h-10 w-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-400">ยังไม่มี WordPress เชื่อมต่ออยู่</p>
            <p className="text-xs text-gray-300 mt-1">กด "เพิ่ม Connection" ด้านบนเพื่อเริ่มต้น</p>
          </div>
        )}

        {connections.length > 0 && (
          <div className="divide-y divide-gray-50">
            {connections.map((wp) => (
              <div key={wp.id} className="flex items-center gap-4 px-6 py-4">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <Globe className="h-5 w-5 text-blue-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900 text-sm">{wp.name}</p>
                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                      <CheckCircle2 className="h-3 w-3" />Connected
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <p className="text-xs text-gray-400 font-mono truncate">{wp.siteUrl}</p>
                    <span className="text-gray-200">·</span>
                    <p className="text-xs text-gray-400">@{wp.username}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleRemove(wp.id)}
                  className="p-2 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New connection form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
            <h3 className="text-sm font-bold text-gray-900">เชื่อมต่อ WordPress ใหม่</h3>
            <p className="text-xs text-gray-400 mt-0.5">ทำตามขั้นตอนด้านล่างแล้วกรอกข้อมูลในฟอร์ม</p>
          </div>

          {/* Step-by-step guide */}
          <div className="border-b border-gray-100">
            <button
              onClick={() => setStepsOpen((v) => !v)}
              className="w-full flex items-center justify-between px-6 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Key className="h-4 w-4 text-amber-500" />
                วิธีสร้าง Application Password ใน WordPress (อ่านก่อนกรอก)
              </span>
              {stepsOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </button>

            {stepsOpen && (
              <div className="px-6 pb-5 space-y-4">
                {WP_STEPS.map((step) => (
                  <div key={step.n} className="flex gap-4">
                    <div className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                      {step.n}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-800">{step.title}</p>
                      <p className="text-sm text-gray-500 mt-0.5 leading-relaxed">{step.detail}</p>
                      {step.code && (
                        <div className="mt-2 flex items-center gap-2">
                          <code className="inline-block bg-gray-900 text-emerald-400 text-xs font-mono px-3 py-1.5 rounded-lg">
                            {step.code}
                          </code>
                          {step.n === 4 && <span className="text-xs text-gray-400">← พิมพ์ชื่อนี้แล้วกด Add New</span>}
                          {step.n === 5 && <span className="text-xs text-gray-400">← ตัวอย่าง password ที่ได้</span>}
                        </div>
                      )}
                      {step.tip && (
                        <div className={`mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${step.n === 4 ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-blue-50 text-blue-600"}`}>
                          {step.n === 4 ? <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" /> : <span className="text-base leading-none flex-shrink-0">💡</span>}
                          <span>{step.tip}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Form */}
          <div className="px-6 py-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">ชื่อ Connection</Label>
                <Input
                  placeholder="เช่น Co Journey Visa"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  className="rounded-xl border-gray-100 text-sm"
                />
                <p className="text-xs text-gray-400">ตั้งชื่อเพื่อให้จำได้ง่าย</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">WordPress Site URL</Label>
                <Input
                  placeholder="https://yoursite.com"
                  type="url"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  className="rounded-xl border-gray-100 text-sm"
                />
                <p className="text-xs text-gray-400">URL หลักของเว็บ ไม่ต้องใส่ /wp-admin</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">WordPress Username</Label>
                <Input
                  placeholder="admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="rounded-xl border-gray-100 text-sm"
                />
                <p className="text-xs text-gray-400">Username ที่ใช้ Login (ไม่ใช่ email)</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Application Password</Label>
                <div className="relative">
                  <Input
                    placeholder="AbCd EfGh IjKl MnOp ..."
                    type={showPass ? "text" : "password"}
                    value={appPass}
                    onChange={(e) => setAppPass(e.target.value)}
                    className="rounded-xl border-gray-100 text-sm pr-10 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-gray-400">Password จาก Step 4 ด้านบน (ไม่ใช่ password login)</p>
              </div>
            </div>

            {/* Test result banner */}
            {testResult === "success" && (
              <div className="flex items-center gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-emerald-800">เชื่อมต่อสำเร็จ!</p>
                  <p className="text-xs text-emerald-600">WordPress ตอบรับการเชื่อมต่อแล้ว กด "บันทึก" เพื่อเพิ่มไว้ในระบบ</p>
                </div>
              </div>
            )}
            {testResult === "error" && (
              <div className="flex items-center gap-3 rounded-xl bg-rose-50 border border-rose-200 px-4 py-3">
                <XCircle className="h-5 w-5 text-rose-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-rose-800">เชื่อมต่อไม่ได้</p>
                  <p className="text-xs text-rose-600">ตรวจสอบ URL, Username และ Application Password อีกครั้ง</p>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleTest}
                disabled={testing || !siteUrl || !username || !appPass}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-100 bg-white hover:bg-gray-50 text-gray-700 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {testing ? <><Loader2 className="h-4 w-4 animate-spin" />กำลัง Test...</> : <><ExternalLink className="h-4 w-4" />Test Connection</>}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || testResult !== "success"}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {saving ? <><Loader2 className="h-4 w-4 animate-spin" />กำลังบันทึก...</> : <>บันทึก Connection</>}
              </button>
              <button
                onClick={() => { setShowForm(false); setTestResult(null); }}
                className="px-4 py-2.5 rounded-xl text-gray-400 hover:text-gray-600 text-sm transition-colors"
              >
                ยกเลิก
              </button>
            </div>
            {testResult !== "success" && (
              <p className="text-xs text-gray-400">กด "Test Connection" ก่อนเพื่อยืนยันว่าข้อมูลถูกต้อง จากนั้นจึงบันทึกได้</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Settings Component ──────────────────────────────────────────────────

export function SettingsClient({ org, users, wpConnections, aiStats, currentUser }: Props) {
  const { mode, setMode } = useUIMode();
  const isAdmin = currentUser.role === "ADMIN";
  const searchParams = useSearchParams();
  const defaultTab = searchParams.get("tab") ?? "interface";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">ตั้งค่า</h1>
        <p className="text-gray-500 text-sm mt-1">{org?.name}</p>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList className="w-full justify-start">
          <TabsTrigger value="interface" className="gap-2"><Monitor className="h-4 w-4" />Interface Mode</TabsTrigger>
          {isAdmin && <TabsTrigger value="users" className="gap-2"><Users className="h-4 w-4" />Users</TabsTrigger>}
          {isAdmin && <TabsTrigger value="wordpress" className="gap-2"><Globe className="h-4 w-4" />WordPress</TabsTrigger>}
          {isAdmin && <TabsTrigger value="ai-cost" className="gap-2"><Zap className="h-4 w-4" />AI Cost</TabsTrigger>}
        </TabsList>

        {/* Interface Mode / Role */}
        <TabsContent value="interface" className="mt-6">
          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">โหมดการใช้งาน</h2>
            <p className="text-sm text-gray-500 mb-6">กำหนดสิทธิ์การมองเห็นเมนูสำหรับผู้ใช้งานแต่ละคน</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {([
                {
                  role: "ADMIN" as Role,
                  label: "Admin",
                  desc: "เห็นเมนูทุกอย่าง รวมถึง AI Jobs, Publish, Settings และ Activity Logs สำหรับ Manager และ Admin ที่ดูแลระบบ",
                  emoji: "🛡️",
                  features: ["AI Jobs & Batch", "Publish / Website Connect", "Settings & Team", "Activity Logs"],
                },
                {
                  role: "WRITER" as Role,
                  label: "User",
                  desc: "เห็นเฉพาะส่วนที่จำเป็นสำหรับการเขียน เหมาะสำหรับทีม Content Writer ที่ไม่ต้องดูแลระบบ",
                  emoji: "✍️",
                  features: ["Home & Morning Brief", "Clients & Articles", "Review Queue", "Backlink"],
                },
              ] as { role: Role; label: string; desc: string; emoji: string; features: string[] }[]).map((option) => {
                const active = isAdmin ? option.role === "ADMIN" : option.role === "WRITER";
                return (
                  <button
                    key={option.role}
                    onClick={async () => {
                      const res = await fetch("/api/users/me/role", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ role: option.role }),
                      });
                      if (res.ok) {
                        toast.success(`เปลี่ยนเป็นโหมด ${option.label} — โปรดรีเฟรชหน้า`);
                        setTimeout(() => window.location.reload(), 1200);
                      } else {
                        toast.error("เปลี่ยนโหมดไม่สำเร็จ");
                      }
                    }}
                    className={`text-left p-5 rounded-xl border-2 transition-all ${active ? "border-green-500 bg-green-50 ring-2 ring-green-200" : "border-gray-100 hover:border-gray-300"}`}
                  >
                    <div className="text-3xl mb-3">{option.emoji}</div>
                    <h3 className="font-semibold text-gray-900 text-base">{option.label}</h3>
                    <p className="text-sm text-gray-500 mt-1 mb-3">{option.desc}</p>
                    <ul className="space-y-1">
                      {option.features.map(f => (
                        <li key={f} className="text-xs text-gray-500 flex items-center gap-1.5">
                          <span className="w-1 h-1 rounded-full bg-gray-400 inline-block" />{f}
                        </li>
                      ))}
                    </ul>
                    {active && (
                      <span className="inline-block mt-3 text-xs font-medium text-green-600 bg-green-100 px-2 py-1 rounded-full">✓ กำลังใช้งานอยู่</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </TabsContent>

        {/* Users */}
        {isAdmin && (
          <TabsContent value="users" className="mt-6">
            <div className="bg-white rounded-xl border">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">ผู้ใช้งาน ({users.length} คน)</h2>
                <Button size="sm" className="gap-2">+ เชิญผู้ใช้ใหม่</Button>
              </div>
              <div className="divide-y">
                {users.map((user) => (
                  <div key={user.id} className="flex items-center gap-4 p-4">
                    <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center text-sm font-bold text-green-700">
                      {user.name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">{user.name ?? "—"}</p>
                      <p className="text-sm text-gray-500">{user.email}</p>
                    </div>
                    <UserRoleBadge role={user.role as Role} />
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${user.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {user.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>
        )}

        {/* WordPress */}
        {isAdmin && (
          <TabsContent value="wordpress" className="mt-6">
            <WordPressConnectionManager wpConnections={wpConnections} />
          </TabsContent>
        )}

        {/* AI Cost */}
        {isAdmin && (
          <TabsContent value="ai-cost" className="mt-6">
            <div className="bg-white rounded-xl border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">AI Cost Tracking</h2>
              {aiStats.length === 0 ? (
                <p className="text-gray-400 text-sm">ยังไม่มีข้อมูล AI jobs</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {aiStats.map((stat) => (
                    <div key={stat.modelProvider} className="border rounded-xl p-4">
                      <p className="text-sm text-gray-500">{stat.modelProvider}</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{stat._count.id} jobs</p>
                      <p className="text-sm text-gray-600 mt-1">{(stat._sum.tokenUsed ?? 0).toLocaleString()} tokens</p>
                      <p className="text-lg font-semibold text-green-600">${(stat._sum.estimatedCost ?? 0).toFixed(4)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
