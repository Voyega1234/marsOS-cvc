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
  ADMIN: "bg-red-100 text-red-700",
  USER: "bg-blue-100 text-blue-700",
  CLIENT: "bg-teal-100 text-teal-700",
};

const statusBadge: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  INACTIVE: "bg-gray-100 text-gray-600",
  INVITED: "bg-yellow-100 text-yellow-700",
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
  const [createdInfo, setCreatedInfo] = useState<{ username: string; pw: string } | null>(null);
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
    setSubmitting(true);
    try {
      // use username@mars.local as email placeholder (login uses name field)
      const fakeEmail = `${name.trim().toLowerCase().replace(/\s+/g, "")}@mars.local`;
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: fakeEmail, password, role, projectIds: selectedProjects, orgId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "เกิดข้อผิดพลาด");
      setUsers((prev) => [data.user, ...prev]);
      setCreatedInfo({ username: name.trim(), pw: password });
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
      toast.success("รีเซ็ตรหัสผ่านสำเร็จ");
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
          className="flex items-center gap-2 bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
        >
          <Plus size={14} /> สร้าง User ใหม่
        </button>
      </div>

      {/* Created summary */}
      {createdInfo && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-emerald-800">สร้าง User สำเร็จ — แจ้งข้อมูลนี้ให้ทีม</p>
            <div className="flex items-center gap-3 mt-2">
              <div>
                <span className="text-[10px] text-emerald-600 font-medium block">Username</span>
                <span className="text-sm font-mono font-bold text-gray-900">{createdInfo.username}</span>
              </div>
              <div className="w-px h-8 bg-emerald-200" />
              <div>
                <span className="text-[10px] text-emerald-600 font-medium block">รหัสผ่าน</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-mono font-bold text-gray-900">
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
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">สร้าง User ใหม่</h3>
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
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
                placeholder="เช่น userseo, clientabc"
                required
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">รหัสผ่าน</label>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 pr-9 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
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
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
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
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
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
                className="bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-60 transition-colors"
              >
                {submitting ? "กำลังสร้าง..." : "สร้าง User"}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="text-sm text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
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
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">รีเซ็ตรหัสผ่าน</h3>
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
                  className="w-full px-3 py-2 pr-9 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
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
                  className="bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-60 transition-colors">
                  {resetting ? "กำลังบันทึก..." : "บันทึก"}
                </button>
                <button type="button" onClick={() => { setResetUserId(null); setResetPw(""); }}
                  className="text-sm text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors">
                  ยกเลิก
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">ชื่อ / Username</th>
              <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">Role</th>
              <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">สถานะ</th>
              <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">Projects (CLIENT)</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{u.name || "—"}</p>
                  {u.email && !u.email.endsWith("@mars.local") && (
                    <p className="text-xs text-gray-500">{u.email}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded ${roleBadge[u.role] ?? "bg-gray-100 text-gray-600"}`}>
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusBadge[u.status] ?? "bg-gray-100 text-gray-600"}`}>
                    {u.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {u.role === "CLIENT" && u.clientProjects.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {u.clientProjects.map((cp) => (
                        <span key={cp.projectId} className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded">
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
