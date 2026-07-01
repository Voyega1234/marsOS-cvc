"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import { ROLE_CONFIG } from "@/types";
import type { Role } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Users, Plus, ShieldCheck, Loader2, MoreHorizontal, KeyRound, UserX, Edit2 } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface User {
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: string;
  createdAt: Date;
}

interface Props {
  users: User[];
  currentUserId: string;
}

const ROLE_DESCS: Record<string, string> = {
  ADMIN:       "Full access. Manage users, settings, AI jobs, prompts.",
  SEO_MANAGER: "Manage projects, assign articles, review AI output.",
  SEO_PLANNER: "Research keywords, build content maps.",
  WRITER:      "Write and edit articles. View assigned work.",
  REVIEWER:    "Review, score, and approve articles.",
  PUBLISHER:   "Publish approved articles to WordPress.",
};

export function UsersClient({ users: initialUsers, currentUserId }: Props) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [showInvite, setShowInvite] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "WRITER" });
  const [submitting, setSubmitting] = useState(false);

  // Edit user
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editRole, setEditRole] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  async function handleEditSave() {
    if (!editUser) return;
    setEditSaving(true);
    try {
      const body: Record<string, string> = { role: editRole };
      if (editPassword) body.password = editPassword;
      const res = await fetch(`/api/users/${editUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setUsers((prev) => prev.map((u) => u.id === editUser.id ? { ...u, role: editRole } : u));
      toast.success("อัปเดตสำเร็จ");
      setEditUser(null);
      setEditPassword("");
    } catch {
      toast.error("เกิดข้อผิดพลาด");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeactivate(userId: string) {
    if (!confirm("ต้องการปิดการใช้งาน user นี้?")) return;
    setLoadingId(userId);
    try {
      await fetch(`/api/users/${userId}`, { method: "DELETE" });
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, status: "INACTIVE" } : u));
      toast.success("ปิดการใช้งานแล้ว");
    } catch {
      toast.error("เกิดข้อผิดพลาด");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleReactivate(userId: string) {
    setLoadingId(userId);
    try {
      await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ACTIVE" }),
      });
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, status: "ACTIVE" } : u));
      toast.success("เปิดใช้งานแล้ว");
    } catch {
      toast.error("เกิดข้อผิดพลาด");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.formErrors?.[0] ?? "Failed");
      }
      const newUser = await res.json();
      setUsers((prev) => [...prev, newUser]);
      toast.success(`${form.name} has been added`);
      setShowInvite(false);
      setForm({ name: "", email: "", password: "", role: "WRITER" });
    } catch (err) {
      toast.error((err as Error).message || "Failed to add user");
    } finally {
      setSubmitting(false);
    }
  }

  const roleGroups = Object.keys(ROLE_CONFIG) as Role[];

  return (
    <div className="space-y-5">

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {roleGroups.slice(0, 4).map((role) => {
          const count = users.filter((u) => u.role === role).length;
          const cfg = ROLE_CONFIG[role];
          return (
            <div key={role} className="bg-white border border-gray-100 rounded-xl p-4">
              <p className={`text-2xl font-bold ${cfg.color}`}>{count}</p>
              <p className="text-xs text-gray-500 mt-0.5">{cfg.label}</p>
            </div>
          );
        })}
      </div>

      {/* Invite Button */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{users.length} total users</p>
        <Button onClick={() => setShowInvite(true)} className="bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white rounded-xl gap-2">
          <Plus className="h-4 w-4" />
          Add User
        </Button>
      </div>

      {/* Users Table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">User</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Joined</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {users.map((user) => {
              const roleCfg = ROLE_CONFIG[user.role as Role];
              const isMe = user.id === currentUserId;
              return (
                <tr key={user.id} className="hover:bg-gray-50/50 transition-colors group">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                        {user.name?.[0]?.toUpperCase() ?? "?"}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {user.name}
                          {isMe && <span className="ml-2 text-xs text-green-600 font-normal">(You)</span>}
                        </p>
                        <p className="text-xs text-gray-400">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${roleCfg?.color ?? "text-gray-600"}`}>
                      {roleCfg?.label ?? user.role}
                    </span>
                    <p className="text-xs text-gray-400 mt-0.5 max-w-xs line-clamp-1">{ROLE_DESCS[user.role] ?? ""}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      user.status === "ACTIVE" ? "bg-green-100 text-green-700" :
                      user.status === "INACTIVE" ? "bg-gray-100 text-gray-500" :
                      "bg-yellow-100 text-yellow-700"
                    }`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">{formatDate(user.createdAt)}</td>
                  <td className="px-4 py-3">
                    {!isMe && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button disabled={loadingId === user.id} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-40">
                            {loadingId === user.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44 rounded-xl">
                          <DropdownMenuItem
                            className="text-sm gap-2 cursor-pointer"
                            onClick={() => { setEditUser(user); setEditRole(user.role); setEditPassword(""); }}
                          >
                            <Edit2 className="h-3.5 w-3.5" /> แก้ไข Role / Password
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {user.status === "ACTIVE" ? (
                            <DropdownMenuItem
                              className="text-sm gap-2 text-red-600 focus:text-red-700 focus:bg-red-50 cursor-pointer"
                              onClick={() => handleDeactivate(user.id)}
                            >
                              <UserX className="h-3.5 w-3.5" /> Deactivate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              className="text-sm gap-2 text-green-600 focus:text-green-700 focus:bg-green-50 cursor-pointer"
                              onClick={() => handleReactivate(user.id)}
                            >
                              <ShieldCheck className="h-3.5 w-3.5" /> Reactivate
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Role Reference */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <p className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-green-600" />
          Role Permissions Reference
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {roleGroups.map((role) => {
            const cfg = ROLE_CONFIG[role];
            return (
              <div key={role} className="p-3 border border-gray-100 rounded-xl">
                <p className={`text-xs font-bold ${cfg.color} mb-1`}>{cfg.label}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{ROLE_DESCS[role]}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit User Dialog */}
      <Dialog open={!!editUser} onOpenChange={(v) => !v && setEditUser(null)}>
        <DialogContent className="sm:max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="h-4 w-4 text-green-600" />
              แก้ไข — {editUser?.name}
            </DialogTitle>
            <DialogDescription>{editUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <Label className="text-sm font-medium">Role</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger className="mt-1 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_CONFIG) as Role[]).map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_CONFIG[r].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" /> เปลี่ยน Password (ไม่บังคับ)
              </Label>
              <Input
                type="password"
                placeholder="ใส่ password ใหม่ หรือเว้นไว้ถ้าไม่เปลี่ยน"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                minLength={6}
                className="mt-1 rounded-xl"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)} className="rounded-xl">ยกเลิก</Button>
            <Button onClick={handleEditSave} disabled={editSaving} className="bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white rounded-xl gap-2">
              {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add User Dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-green-600" />
              Add New User
            </DialogTitle>
            <DialogDescription>Create a new team member account</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label htmlFor="name" className="text-sm font-medium">Full Name</Label>
                <Input
                  id="name"
                  placeholder="Somchai Jaidee"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  className="mt-1 rounded-xl"
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="email" className="text-sm font-medium">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="somchai@company.com"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  required
                  className="mt-1 rounded-xl"
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="password" className="text-sm font-medium">Initial Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Min. 6 characters"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required
                  minLength={6}
                  className="mt-1 rounded-xl"
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="role" className="text-sm font-medium">Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                  <SelectTrigger className="mt-1 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roleGroups.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_CONFIG[r].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.role && (
                  <p className="text-xs text-gray-400 mt-1">{ROLE_DESCS[form.role]}</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowInvite(false)} className="rounded-xl">Cancel</Button>
              <Button type="submit" disabled={submitting} className="bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white rounded-xl gap-2">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add User
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
