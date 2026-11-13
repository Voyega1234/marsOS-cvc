"use client";

import { useState } from "react";
import { Plus, X, Check, Eye, EyeOff, KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface UserProject {
  projectId: string;
  projectName: string;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  passwordPlain: string | null;
  clientProjects: UserProject[];
}

interface ProjectOption {
  id: string;
  name: string;
  clientName: string;
}

interface Props {
  users: UserRow[];
  projects: ProjectOption[];
  orgId: string;
}

const ROLE_OPTIONS = ["ADMIN", "USER", "CLIENT"] as const;
type RoleOption = (typeof ROLE_OPTIONS)[number];

const roleBadge: Record<string, string> = {
  ADMIN: "chip chip-bad",
  USER: "chip chip-info",
  CLIENT: "chip chip-ok",
};

const statusBadge: Record<string, string> = {
  ACTIVE: "chip chip-ok",
  INACTIVE: "chip chip-muted",
  INVITED: "chip chip-warn",
};

export function AdminUsersClient({ users: initialUsers, projects, orgId }: Props) {
  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [role, setRole] = useState<RoleOption>("USER");
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [createdInfo, setCreatedInfo] = useState<{
    username: string; pw: string; isClient: boolean; loginReady: boolean; loginError?: string;
  } | null>(null);
  const [showCreatedPw, setShowCreatedPw] = useState(false);

  // Reset password state
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [showResetPw, setShowResetPw] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [savedPw, setSavedPw] = useState<{ userId: string; pw: string } | null>(null);
  const [showSavedPw, setShowSavedPw] = useState<Record<string, boolean>>({});

  function resetForm() {
    setName("");
    setPassword("");
    setRole("USER");
    setSelectedProjects([]);
    setShowForm(false);
    setCreatedInfo(null);
  }

  function toggleProject(id: string) {
    setSelectedProjects((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !password.trim()) return;
    // ลูกค้า login ด้วย username + รหัสผ่านจริง — username ต้องกลายเป็นอีเมลที่ระบบ login รับได้
    if (role === "CLIENT") {
      if (!/^[a-z0-9._-]+$/.test(name.trim().toLowerCase().replace(/\s+/g, ""))) {
        toast.error("Username ของลูกค้าใช้ได้เฉพาะ a-z 0-9 จุด ขีดกลาง ขีดล่าง");
        return;
      }
      if (password.length < 6) {
        toast.error("รหัสผ่านของลูกค้าต้องยาวอย่างน้อย 6 ตัวอักษร");
        return;
      }
    }
    setSubmitting(true);
    try {
      // username@mars.local = อีเมลในระบบของบัญชีที่สร้างจากหน้านี้
      // ลูกค้า (CLIENT) พิมพ์แค่ username + รหัสผ่านที่หน้า login — ระบบเติม @mars.local ให้เอง
      const fakeEmail = `${name.trim().toLowerCase().replace(/\s+/g, "")}@mars.local`;
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: fakeEmail, password, role, projectIds: selectedProjects, orgId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "เกิดข้อผิดพลาด");
      setUsers((prev) => [data.user, ...prev]);
      const isClient = role === "CLIENT";
      // loginReady มาจากเซิร์ฟเวอร์เฉพาะ CLIENT — false = สร้าง User แล้ว แต่บัญชี login ยังไม่พร้อม
      const loginReady = !isClient || data.loginReady !== false;
      const loginError = typeof data.loginError === "string" ? data.loginError : undefined;
      setCreatedInfo({ username: name.trim(), pw: password, isClient, loginReady, loginError });
      if (!loginReady) toast.warning(`สร้าง User แล้ว แต่ระบบ login ยังไม่พร้อม${loginError ? `: ${loginError}` : ""}`);
      setShowCreatedPw(false);
      setName("");
      setPassword("");
      setRole("USER");
      setSelectedProjects([]);
      setShowForm(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetUserId || resetPw.length < 6) return;
    setResetting(true);
    try {
      const res = await fetch(`/api/admin/users/${resetUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPw }),
      });
      if (!res.ok) throw new Error("ไม่สามารถรีเซ็ตรหัสผ่านได้");
      // CLIENT: เซิร์ฟเวอร์ตั้งรหัสเดียวกันในระบบ login ด้วย — loginReady false = บันทึกแล้วแต่ยัง login ไม่ได้
      const data = await res.json().catch(() => ({}));
      if (data?.loginReady === false) {
        toast.warning(`บันทึกรหัสผ่านแล้ว แต่ระบบ login ยังไม่พร้อม${typeof data.loginError === "string" ? `: ${data.loginError}` : ""}`);
      } else {
        toast.success("รีเซ็ตรหัสผ่านสำเร็จ");
      }
      setSavedPw({ userId: resetUserId, pw: resetPw });
      setUsers(prev => prev.map(u => u.id === resetUserId ? { ...u, passwordPlain: resetPw } : u));
      setResetUserId(null);
      setResetPw("");
    } catch {
      toast.error("เกิดข้อผิดพลาด");
    } finally {
      setResetting(false);
    }
  }

  async function handleDelete(userId: string, userName: string) {
    if (!confirm(`ลบ "${userName}" ออกจากระบบ? ไม่สามารถกู้คืนได้`)) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("ไม่สามารถลบได้");
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      toast.success(`ลบ ${userName} สำเร็จ`);
    } catch {
      toast.error("เกิดข้อผิดพลาด");
    }
  }

  async function handleToggleStatus(userId: string, currentStatus: string) {
    const newStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("ไม่สามารถอัปเดตได้");
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, status: newStatus } : u))
      );
      toast.success(`อัปเดตสถานะเป็น ${newStatus}`);
    } catch {
      toast.error("เกิดข้อผิดพลาด");
    }
  }

  return (
    <div className="space-y-4">
      {/* Header action */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-brand-blue text-white text-sm font-medium px-4 py-2 rounded-full hover:bg-brand-deep transition-colors"
        >
          <Plus size={14} /> สร้าง User ใหม่
        </button>
      </div>

      {/* Created summary */}
      {createdInfo && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-emerald-800">
              {createdInfo.isClient
                ? "สร้าง User สำเร็จ — ส่ง Username + รหัสผ่านนี้ให้ลูกค้า (กรอกที่หน้า login ช่อง \"สำหรับลูกค้า\")"
                : "สร้าง User สำเร็จ — แจ้งข้อมูลนี้ให้ทีม"}
            </p>
            {createdInfo.isClient && !createdInfo.loginReady && (
              <p className="text-xs font-medium text-amber-700">
                ระบบ login ยังไม่พร้อม{createdInfo.loginError ? `: ${createdInfo.loginError}` : ""} — กดรีเซ็ตรหัสผ่านของ User นี้เพื่อลองใหม่
              </p>
            )}
            <div className="flex items-center gap-3 mt-2">
              <div>
                <span className="text-[10px] text-emerald-600 font-medium block">Username</span>
                <span className="text-sm font-mono font-bold text-brand-navy">{createdInfo.username}</span>
              </div>
              <div className="w-px h-8 bg-emerald-200" />
              <div>
                <span className="text-[10px] text-emerald-600 font-medium block">รหัสผ่าน</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-mono font-bold text-brand-navy">
                    {showCreatedPw ? createdInfo.pw : "••••••••"}
                  </span>
                  <button type="button" onClick={() => setShowCreatedPw(p => !p)}
                    className="text-emerald-500 hover:text-emerald-700">
                    {showCreatedPw ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <button onClick={() => setCreatedInfo(null)} className="text-emerald-400 hover:text-emerald-600 shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="glass rounded-3xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-brand-navy">สร้าง User ใหม่</h3>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Username (ใช้ login)</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
                placeholder="เช่น userseo, clientabc"
                required
                autoFocus
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">รหัสผ่าน</label>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 pr-9 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
                    placeholder="••••••••"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as RoleOption)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Client project selector */}
            {role === "CLIENT" && projects.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">
                  เลือก Projects ที่ Client นี้ดูได้
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleProject(p.id)}
                      className={`flex items-center gap-2 text-left text-xs px-3 py-2 rounded-lg border transition-colors ${
                        selectedProjects.includes(p.id)
                          ? "border-teal-500 bg-teal-50 text-teal-800"
                          : "border-gray-200 hover:border-gray-300 text-gray-700"
                      }`}
                    >
                      <span className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 ${
                        selectedProjects.includes(p.id) ? "bg-teal-500" : "border border-gray-300"
                      }`}>
                        {selectedProjects.includes(p.id) && <Check size={9} className="text-white" />}
                      </span>
                      <span className="truncate">{p.clientName || p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={submitting}
                className="bg-brand-blue text-white text-sm font-medium px-4 py-2 rounded-full hover:bg-brand-deep disabled:opacity-60 transition-colors"
              >
                {submitting ? "กำลังสร้าง..." : "สร้าง User"}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="text-sm text-gray-600 px-4 py-2 rounded-full hover:bg-gray-100 transition-colors"
              >
                ยกเลิก
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reset password modal */}
      {resetUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="glass-strong rounded-3xl shadow-xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-brand-navy">รีเซ็ตรหัสผ่าน</h3>
              <button onClick={() => { setResetUserId(null); setResetPw(""); }} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              ตั้งรหัสผ่านใหม่ให้ <strong className="text-gray-800">{users.find(u => u.id === resetUserId)?.name}</strong>
            </p>
            <form onSubmit={handleResetPassword} className="space-y-3">
              <div className="relative">
                <input
                  type={showResetPw ? "text" : "password"}
                  value={resetPw}
                  onChange={e => setResetPw(e.target.value)}
                  className="w-full px-3 py-2 pr-9 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
                  placeholder="รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)"
                  minLength={6}
                  required
                  autoFocus
                />
                <button type="button" onClick={() => setShowResetPw(p => !p)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showResetPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={resetting || resetPw.length < 6}
                  className="bg-brand-blue text-white text-sm font-medium px-4 py-2 rounded-full hover:bg-brand-deep disabled:opacity-60 transition-colors">
                  {resetting ? "กำลังบันทึก..." : "บันทึก"}
                </button>
                <button type="button" onClick={() => { setResetUserId(null); setResetPw(""); }}
                  className="text-sm text-gray-600 px-4 py-2 rounded-full hover:bg-gray-100 transition-colors">
                  ยกเลิก
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="glass rounded-3xl overflow-x-auto">
        <table className="tbl w-full text-sm min-w-[640px]">
          <thead>
            <tr>
              <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">ชื่อ / Username</th>
              <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">Role</th>
              <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">สถานะ</th>
              <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">Projects (CLIENT)</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium text-brand-navy">{u.name || "—"}</p>
                  {u.email && !u.email.endsWith("@mars.local") && (
                    <p className="text-xs text-gray-500">{u.email}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={roleBadge[u.role] ?? "chip chip-muted"}>
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={statusBadge[u.status] ?? "chip chip-muted"}>
                    {u.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {u.role === "CLIENT" && u.clientProjects.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {u.clientProjects.map((cp) => (
                        <span key={cp.projectId} className="chip chip-info">
                          {cp.projectName}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 flex-wrap">
                    {/* ดูรหัส — โชว์เฉพาะถ้ามี passwordPlain */}
                    {(u.passwordPlain || savedPw?.userId === u.id) ? (
                      <div className="flex items-center gap-1 bg-gray-100 rounded px-2 py-1">
                        <span className="text-xs font-mono text-gray-700">
                          {showSavedPw[u.id]
                            ? (savedPw?.userId === u.id ? savedPw.pw : u.passwordPlain)
                            : "••••••••"}
                        </span>
                        <button
                          onClick={() => setShowSavedPw(prev => ({ ...prev, [u.id]: !prev[u.id] }))}
                          className="text-gray-400 hover:text-gray-700 ml-0.5"
                          title={showSavedPw[u.id] ? "ซ่อน" : "ดูรหัส"}
                        >
                          {showSavedPw[u.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300 px-2 py-1">—</span>
                    )}
                    <button
                      onClick={() => { setResetUserId(u.id); setResetPw(""); setShowResetPw(false); }}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                      title="รีเซ็ตรหัสผ่าน"
                    >
                      <KeyRound size={12} /> รีเซ็ต
                    </button>
                    <button
                      onClick={() => handleToggleStatus(u.id, u.status)}
                      className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                    >
                      {u.status === "ACTIVE" ? "ระงับ" : "เปิดใช้"}
                    </button>
                    {u.role === "CLIENT" && (
                      <button
                        onClick={() => handleDelete(u.id, u.name)}
                        className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                        title="ลบ Client"
                      >
                        <Trash2 size={12} /> ลบ
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                  ยังไม่มี users
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
