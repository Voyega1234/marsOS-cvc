"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, Search, Loader2 } from "lucide-react";
import { describeActivity, activityKind, readAutoPath, type ActivityKind } from "@/lib/activity-describe";

interface ActivityLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  user: { id: string; name: string | null; email: string } | null;
}

interface OrgUser {
  id: string;
  name: string | null;
  email: string;
}

interface Props {
  users: OrgUser[];
}

const KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "no-view", label: "ทุกการกระทำ (ไม่รวมการเปิดหน้า)" },
  { value: "all", label: "ทั้งหมด" },
  { value: "action", label: "ทำรายการ" },
  { value: "view", label: "เปิดหน้า" },
  { value: "auth", label: "เข้า/ออกระบบ" },
  { value: "legacy", label: "บันทึกเดิม" },
];

const KIND_BADGE: Record<ActivityKind, { label: string; className: string }> = {
  action: { label: "ทำรายการ", className: "bg-blue-50 text-blue-600" },
  view: { label: "เปิดหน้า", className: "bg-gray-100 text-gray-600" },
  auth: { label: "เข้า/ออกระบบ", className: "bg-purple-50 text-purple-600" },
  legacy: { label: "บันทึกเดิม", className: "bg-amber-50 text-amber-700" },
};

function formatThaiDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function detailLine(log: ActivityLog): string | null {
  const kind = activityKind(log.action);
  if (kind === "action") {
    const auto = readAutoPath(log.newValue);
    const method = auto?.method || log.action.slice("API_".length);
    return `${method} ${auto?.path ?? ""}`.trim();
  }
  if (kind === "view") {
    return readAutoPath(log.newValue)?.path ?? log.entityId;
  }
  if (kind === "legacy") {
    return `${log.action} · ${log.entityType} · ${log.entityId}`;
  }
  return null;
}

interface NextCursor {
  before: string;
  beforeId: string;
}

export function ActivityLogsClient({ users }: Props) {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [nextCursor, setNextCursor] = useState<NextCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState("ALL");
  const [kind, setKind] = useState("no-view");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const buildParams = useCallback(
    (cursor?: NextCursor | null) => {
      const params = new URLSearchParams();
      params.set("format", "page");
      params.set("kind", kind);
      if (userId !== "ALL") params.set("userId", userId);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (cursor) {
        params.set("before", cursor.before);
        params.set("beforeId", cursor.beforeId);
      }
      return params;
    },
    [userId, kind, from, to, debouncedSearch]
  );

  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    fetch(`/api/activity-logs?${buildParams().toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error("โหลดข้อมูลไม่สำเร็จ");
        return res.json();
      })
      .then((data: { logs: ActivityLog[]; nextCursor: NextCursor | null }) => {
        if (requestIdRef.current !== requestId) return;
        setLogs(data.logs);
        setNextCursor(data.nextCursor);
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return;
        setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return;
        setLoading(false);
      });
  }, [buildParams]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    fetch(`/api/activity-logs?${buildParams(nextCursor).toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error("โหลดข้อมูลไม่สำเร็จ");
        return res.json();
      })
      .then((data: { logs: ActivityLog[]; nextCursor: NextCursor | null }) => {
        setLogs((prev) => [...prev, ...data.logs]);
        setNextCursor(data.nextCursor);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
      })
      .finally(() => setLoadingMore(false));
  }, [buildParams, nextCursor, loadingMore]);

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="ค้นหา..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 rounded-xl"
          />
        </div>
        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger className="w-44 rounded-xl">
            <SelectValue placeholder="ผู้ใช้" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">ทุกคน</SelectItem>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name ?? u.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-56 rounded-xl">
            <SelectValue placeholder="ประเภท" />
          </SelectTrigger>
          <SelectContent>
            {KIND_OPTIONS.map((k) => (
              <SelectItem key={k.value} value={k.value}>
                {k.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="w-40 rounded-xl"
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="w-40 rounded-xl"
        />
      </div>

      {/* List */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {loading ? (
          <div className="px-4 py-12 text-center text-sm text-gray-400">
            <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin text-gray-300" />
            กำลังโหลด...
          </div>
        ) : error ? (
          <div className="px-4 py-12 text-center text-sm text-red-500">{error}</div>
        ) : logs.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-gray-400">
            <Activity className="h-8 w-8 mx-auto mb-2 text-gray-200" />
            ไม่พบกิจกรรม
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {logs.map((log) => {
              const k = activityKind(log.action);
              const badge = KIND_BADGE[k];
              const detail = detailLine(log);
              return (
                <div key={log.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-3 hover:bg-gray-50/50 transition-colors">
                  <div className="flex items-center gap-2 sm:w-44 flex-shrink-0">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-slate-600 text-xs font-bold flex-shrink-0">
                      {(log.user?.name ?? log.user?.email ?? "?")[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-brand-navy leading-tight truncate">{log.user?.name ?? log.user?.email ?? "System"}</p>
                      <p className="text-xs text-gray-400 leading-tight truncate">{log.user?.email ?? ""}</p>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 leading-tight">{describeActivity(log)}</p>
                    {detail && <p className="text-xs text-gray-400 leading-tight mt-0.5 truncate">{detail}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${badge.className}`}>{badge.label}</span>
                    <span className="text-xs text-gray-400 whitespace-nowrap">{formatThaiDateTime(log.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {nextCursor && !loading && !error && (
        <div className="flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="text-xs font-medium text-brand-navy border border-gray-200 rounded-xl px-4 py-2 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {loadingMore ? "กำลังโหลด..." : "โหลดเพิ่ม"}
          </button>
        </div>
      )}
    </div>
  );
}
