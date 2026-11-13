"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Chip } from "@/components/ds";
import { api, fmtDateTime, selectCls } from "./shared";

export interface AsanaStatus {
  tokenSource: "db" | "env" | "none";
  projectGid: string;
  projectName: string;
  webhookState: string;
  webhookAvailable: boolean;
  lastSyncAt: string | null;
  lastEventAt: string | null;
  lastError: string;
}

interface ProjectOption { gid: string; name: string; workspaceName: string; teamName?: string }

/** แสดงในรายการเลือกได้สูงสุดเท่านี้ — เกินกว่านี้ให้พิมพ์ค้นหาให้แคบลง */
const MAX_VISIBLE = 300;

/** ดึงเลขโปรเจกต์จากลิงก์ Asana (ทั้งรูปแบบเก่าและใหม่) หรือจากเลขล้วน */
export function projectGidFromInput(input: string): string {
  const t = input.trim();
  const m =
    t.match(/app\.asana\.com\/\d+\/\d+\/project\/(\d+)/) ??
    t.match(/app\.asana\.com\/0\/(\d+)/) ??
    t.match(/^(\d{8,})$/);
  return m ? m[1] : "";
}

function projectLabel(p: ProjectOption): string {
  return [p.name, p.teamName, p.workspaceName].filter(Boolean).join(" · ");
}

export default function AsanaDialog({ open, onOpenChange, status, canEdit, onChanged }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  status: AsanaStatus | null;
  canEdit: boolean;
  onChanged: (s: AsanaStatus) => void;
}) {
  const [token, setToken] = useState("");
  const [projectGid, setProjectGid] = useState("");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [search, setSearch] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectsError, setProjectsError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    setProjectsError("");
    try {
      const d = await api<{ projects: ProjectOption[]; truncated?: boolean }>("/api/backlink-management/asana/projects");
      setProjects(d.projects);
      setTruncated(!!d.truncated);
    } catch (e) {
      setProjects([]);
      setTruncated(false);
      setProjectsError(e instanceof Error ? e.message : "โหลดรายการโปรเจกต์ไม่สำเร็จ");
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setToken("");
    setSearch("");
    setProjectGid(status?.projectGid ?? "");
    if (canEdit && status && status.tokenSource !== "none") void loadProjects();
  }, [open, status, canEdit, loadProjects]);

  const pastedGid = projectGidFromInput(search);
  const filtered = useMemo(() => {
    if (pastedGid) return projects.filter((p) => p.gid === pastedGid);
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return projects;
    return projects.filter((p) => {
      const hay = `${p.name} ${p.teamName ?? ""} ${p.workspaceName}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [projects, search, pastedGid]);
  const visible = filtered.slice(0, MAX_VISIBLE);
  const selected = projectGid ? projects.find((p) => p.gid === projectGid) : undefined;
  const selectedLabel = selected
    ? projectLabel(selected)
    : projectGid === status?.projectGid && status?.projectName
      ? status.projectName
      : projectGid ? `โปรเจกต์จากลิงก์ (${projectGid})` : "";

  function onSearch(v: string) {
    setSearch(v);
    const gid = projectGidFromInput(v);
    if (gid) setProjectGid(gid); // วางลิงก์โปรเจกต์ = เลือกโปรเจกต์นั้นเลย (ระบบตรวจกับ Asana ตอนบันทึก)
  }

  async function save() {
    setBusy(true);
    try {
      const s = await api<AsanaStatus>("/api/backlink-management/asana", {
        method: "PUT",
        json: { ...(token.trim() ? { token: token.trim() } : {}), ...(projectGid ? { projectGid } : {}) },
      });
      onChanged(s);
      setToken("");
      toast.success("บันทึกการเชื่อม Asana แล้ว");
      if (token.trim()) void loadProjects();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("ยกเลิกการเชื่อม Asana? งานที่สร้างไว้ใน Asana จะไม่ถูกลบ")) return;
    setBusy(true);
    try {
      const s = await api<AsanaStatus>("/api/backlink-management/asana", { method: "DELETE" });
      onChanged(s);
      toast.success("ยกเลิกการเชื่อมแล้ว");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const connected = !!status && status.tokenSource !== "none" && !!status.projectGid;
  const hookTone = status?.webhookState === "ACTIVE" ? "ok" : status?.webhookState === "PENDING" ? "warn" : "muted";
  const hookLabel = status?.webhookState === "ACTIVE" ? "Webhook ทำงาน (อัปเดตทันที)" : status?.webhookState === "PENDING" ? "กำลังเปิด webhook" : status?.webhookAvailable ? "ยังไม่ได้เปิด webhook" : "ไม่ใช้ webhook (อัปเดตอัตโนมัติทุก ~1 นาทีขณะเปิดหน้านี้)";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>เชื่อมต่อ Asana</DialogTitle>
          <DialogDescription>
            หลังบันทึก ระบบจะสร้างงานใน Asana ให้ทุกคำขอ และอัปเดตสถานะให้อัตโนมัติทั้งสองทาง — ไม่ต้องกด sync
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={connected ? "ok" : "warn"}>{connected ? `เชื่อมแล้ว · ${status?.projectName}` : "ยังไม่ได้เชื่อม"}</Chip>
            <Chip tone={hookTone}>{hookLabel}</Chip>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-xs text-gray-600">
            <span>Token</span><span>{status?.tokenSource === "db" ? "บันทึกในระบบ (เข้ารหัส)" : status?.tokenSource === "env" ? "ใช้ค่าจากเซิร์ฟเวอร์" : "ยังไม่มี"}</span>
            <span>อัปเดตล่าสุด</span><span>{fmtDateTime(status?.lastSyncAt)}</span>
            <span>เหตุการณ์ล่าสุด</span><span>{fmtDateTime(status?.lastEventAt)}</span>
          </div>
          {status?.lastError ? <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{status.lastError}</div> : null}

          {canEdit ? (
            <>
              <div>
                <Label>Personal Access Token (ไม่บังคับ)</Label>
                <Input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="เว้นว่างได้ถ้าเซิร์ฟเวอร์ตั้ง ASANA_ACCESS_TOKEN ไว้แล้ว" />
              </div>
              <div>
                <Label>โปรเจกต์ Asana ที่ใช้สร้างงาน</Label>
                <Input
                  className="mb-1.5"
                  value={search}
                  onChange={(e) => onSearch(e.target.value)}
                  placeholder="ค้นหาชื่อโปรเจกต์หรือชื่อทีม เช่น SEO — หรือวางลิงก์โปรเจกต์จาก Asana"
                  aria-label="ค้นหาโปรเจกต์ Asana"
                />
                <select className={selectCls} value={projectGid} onChange={(e) => setProjectGid(e.target.value)} disabled={loadingProjects}>
                  <option value="">{loadingProjects ? "กำลังโหลด..." : "— เลือกโปรเจกต์ —"}</option>
                  {projectGid && !visible.some((p) => p.gid === projectGid) ? <option value={projectGid}>{selectedLabel}</option> : null}
                  {visible.map((p) => <option key={p.gid} value={p.gid}>{projectLabel(p)}</option>)}
                </select>
                {!loadingProjects && projects.length > 0 ? (
                  <p className="mt-1 text-xs text-gray-500">
                    {search.trim() ? `พบ ${filtered.length.toLocaleString("th-TH")} จาก ${projects.length.toLocaleString("th-TH")} โปรเจกต์` : `ทั้งหมด ${projects.length.toLocaleString("th-TH")} โปรเจกต์`}
                    {filtered.length > MAX_VISIBLE ? ` · แสดง ${MAX_VISIBLE} รายการแรก พิมพ์ค้นหาเพื่อให้รายการแคบลง` : ""}
                  </p>
                ) : null}
                {pastedGid && !selected ? <p className="mt-1 text-xs text-gray-500">ใช้โปรเจกต์จากลิงก์ที่วาง — ระบบจะตรวจกับ Asana ตอนกดบันทึก</p> : null}
                {truncated ? <p className="mt-1 text-xs text-amber-600">โปรเจกต์มีจำนวนมาก รายการนี้ยังไม่ครบ — ถ้าหาไม่เจอ ให้วางลิงก์โปรเจกต์จาก Asana ในช่องค้นหา</p> : null}
                {projectsError ? <p className="mt-1 text-xs text-gray-500">{projectsError}</p> : null}
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-500">เฉพาะ ADMIN / SEO Manager เท่านั้นที่ตั้งค่าการเชื่อม Asana ได้</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          {canEdit && connected ? <Button variant="outline" onClick={disconnect} disabled={busy}>ยกเลิกการเชื่อม</Button> : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>ปิด</Button>
          {canEdit ? <Button onClick={save} disabled={busy || (!token.trim() && !projectGid)}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}บันทึก</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
