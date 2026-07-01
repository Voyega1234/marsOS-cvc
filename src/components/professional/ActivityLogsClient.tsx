"use client";

import { useState, useMemo } from "react";
import { formatDate } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, Search, User, FileText, Cpu, FolderOpen, ChevronRight } from "lucide-react";

interface ActivityLog {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
  user: { name: string | null; email: string } | null;
}

interface Props {
  logs: ActivityLog[];
}

const ACTION_LABELS: Record<string, string> = {
  CREATE_ARTICLE: "Created article",
  UPDATE_ARTICLE: "Updated article",
  DELETE_ARTICLE: "Deleted article",
  STATUS_CHANGE: "Changed status",
  GENERATE_KEYWORDS: "Generated keywords",
  GENERATE_CONTENT_MAP: "Generated content map",
  GENERATE_OUTLINE: "Generated outline",
  GENERATE_ARTICLE: "Generated article HTML",
  GENERATE_IMAGE_PROMPT: "Generated image prompt",
  GENERATE_SEO_REVIEW: "Generated SEO review",
  CREATE_WORDPRESS_DRAFT: "Created WordPress draft",
  APPROVE_ARTICLE: "Approved article",
  REJECT_ARTICLE: "Rejected article",
  CREATE_REVIEW: "Submitted review",
  CREATE_PROJECT: "Created project",
  UPDATE_PROJECT: "Updated project",
  CREATE_USER: "Added user",
  UPDATE_USER: "Updated user",
  UPDATE_SETTINGS: "Updated settings",
};

const ENTITY_ICONS: Record<string, React.ReactNode> = {
  Article: <FileText className="h-3.5 w-3.5" />,
  Project: <FolderOpen className="h-3.5 w-3.5" />,
  AIJob: <Cpu className="h-3.5 w-3.5" />,
  User: <User className="h-3.5 w-3.5" />,
};

const ENTITY_TYPES = ["Article", "Project", "AIJob", "User", "Review"];

const ACTION_GROUPS = [
  { label: "All Actions", value: "ALL" },
  { label: "Article Changes", value: "ARTICLE" },
  { label: "AI Generation", value: "GENERATE" },
  { label: "Reviews", value: "REVIEW" },
  { label: "Projects", value: "PROJECT" },
  { label: "Users / Settings", value: "USER" },
];

function matchesGroup(action: string, group: string): boolean {
  if (group === "ALL") return true;
  if (group === "ARTICLE") return action.includes("ARTICLE") || action === "STATUS_CHANGE";
  if (group === "GENERATE") return action.startsWith("GENERATE") || action === "CREATE_WORDPRESS_DRAFT";
  if (group === "REVIEW") return action.includes("REVIEW") || action.includes("APPROVE") || action.includes("REJECT");
  if (group === "PROJECT") return action.includes("PROJECT");
  if (group === "USER") return action.includes("USER") || action.includes("SETTINGS");
  return true;
}

function parseChange(oldVal: string | null, newVal: string | null) {
  if (!oldVal && !newVal) return null;
  try {
    const o = oldVal ? JSON.parse(oldVal) : null;
    const n = newVal ? JSON.parse(newVal) : null;
    if (o?.status && n?.status && o.status !== n.status) {
      return { from: o.status, to: n.status };
    }
    return null;
  } catch {
    return null;
  }
}

export function ActivityLogsClient({ logs }: Props) {
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("ALL");
  const [actionGroup, setActionGroup] = useState("ALL");

  const filtered = useMemo(() => {
    return logs.filter((log) => {
      if (entityFilter !== "ALL" && log.entityType !== entityFilter) return false;
      if (!matchesGroup(log.action, actionGroup)) return false;
      if (search) {
        const q = search.toLowerCase();
        const label = (ACTION_LABELS[log.action] ?? log.action).toLowerCase();
        const userName = (log.user?.name ?? log.user?.email ?? "").toLowerCase();
        const entity = (log.entityId ?? "").toLowerCase();
        if (!label.includes(q) && !userName.includes(q) && !entity.includes(q)) return false;
      }
      return true;
    });
  }, [logs, search, entityFilter, actionGroup]);

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Events", value: logs.length, color: "text-slate-800" },
          { label: "AI Generations", value: logs.filter((l) => l.action.startsWith("GENERATE")).length, color: "text-purple-600" },
          { label: "Status Changes", value: logs.filter((l) => l.action === "STATUS_CHANGE").length, color: "text-blue-600" },
          { label: "Reviews", value: logs.filter((l) => l.action.includes("REVIEW") || l.action.includes("APPROVE")).length, color: "text-green-600" },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-4">
            <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search by action, user, or entity..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 rounded-xl"
          />
        </div>
        <Select value={actionGroup} onValueChange={setActionGroup}>
          <SelectTrigger className="w-44 rounded-xl">
            <SelectValue placeholder="Action group" />
          </SelectTrigger>
          <SelectContent>
            {ACTION_GROUPS.map((g) => (
              <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={entityFilter} onValueChange={setEntityFilter}>
          <SelectTrigger className="w-36 rounded-xl">
            <SelectValue placeholder="Entity type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Types</SelectItem>
            {ENTITY_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-gray-400">{filtered.length} of {logs.length} events</p>

      {/* Log table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">User</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Entity</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Change</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-400">
                  <Activity className="h-8 w-8 mx-auto mb-2 text-gray-200" />
                  No activity found
                </td>
              </tr>
            ) : (
              filtered.map((log) => {
                const change = parseChange(log.oldValue, log.newValue);
                return (
                  <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-slate-600 text-xs font-bold flex-shrink-0">
                          {(log.user?.name ?? log.user?.email ?? "?")[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-900 leading-tight">{log.user?.name ?? "System"}</p>
                          <p className="text-xs text-gray-400 leading-tight">{log.user?.email ?? ""}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium text-gray-700">
                        {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {log.entityType ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-gray-400">
                            {ENTITY_ICONS[log.entityType] ?? <Activity className="h-3.5 w-3.5" />}
                          </span>
                          <span className="text-xs text-gray-600">{log.entityType}</span>
                          {log.entityId && (
                            <span className="text-xs text-gray-400 font-mono truncate max-w-[80px]">{log.entityId.slice(0, 8)}…</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {change ? (
                        <div className="flex items-center gap-1 text-xs">
                          <span className="px-1.5 py-0.5 bg-red-50 text-red-600 rounded font-mono">{change.from}</span>
                          <ChevronRight className="h-3 w-3 text-gray-400" />
                          <span className="px-1.5 py-0.5 bg-green-50 text-green-700 rounded font-mono">{change.to}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{formatDate(log.createdAt)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
