import { Metadata } from "next";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { MyTasksClient } from "@/components/tasks/MyTasksClient";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { FunnelBadge } from "@/components/shared/FunnelBadge";
import { formatDate } from "@/lib/utils";
import {
  CheckCircle2, Clock, AlertTriangle, PenLine, Search,
  ArrowRight, MessageSquare, LayoutList, ExternalLink,
} from "lucide-react";

export const metadata: Metadata = { title: "My Tasks" };

const URGENCY: Record<string, { label: string; color: string; border: string; icon: typeof Clock; order: number }> = {
  REVISION_REQUIRED:  { label: "ต้องแก้ไข",        color: "text-[#9B2525] bg-[#FFF0F0]", border: "border-[#F5C8C8]", icon: AlertTriangle, order: 0 },
  SEO_REVIEW:         { label: "รอตรวจสอบ",        color: "text-[#9A4A00] bg-[#FFF7ED]", border: "border-[#F5C896]", icon: Search,        order: 1 },
  OUTLINE_APPROVED:   { label: "พร้อมเขียน",        color: "text-[#2B4FAD] bg-[#EEF3FF]", border: "border-[#C5D4F8]", icon: PenLine,       order: 2 },
  ARTICLE_GENERATING: { label: "กำลังสร้าง",        color: "text-[#6B35A8] bg-[#F5EEFF]", border: "border-[#D4B8F5]", icon: Clock,         order: 3 },
  OUTLINE_DONE:       { label: "ร่าง Outline แล้ว", color: "text-[#2B4FAD] bg-[#EEF3FF]", border: "border-[#C5D4F8]", icon: PenLine,       order: 4 },
  ARTICLE_DONE:       { label: "บทความพร้อม",       color: "text-[#1A6A46] bg-[#EDFAF4]", border: "border-[#B8E8D0]", icon: CheckCircle2,  order: 5 },
};

const SOURCE_META: Record<string, { label: string; color: string; icon: typeof MessageSquare }> = {
  slack: { label: "Slack",  color: "bg-[#4A154B] text-white", icon: MessageSquare },
  asana: { label: "Asana",  color: "bg-[#F06A6A] text-white", icon: LayoutList },
};

const PRIORITY_COLOR: Record<string, string> = {
  HIGH:   "text-[#9B2525] bg-[#FFF0F0]",
  MEDIUM: "text-[#9A4A00] bg-[#FFF7ED]",
  LOW:    "text-[#444444] bg-[#F5F5F5]",
};

export default async function MyTasksPage() {
  const session = await getSession();
  const userId = session?.user?.id;
  const orgId  = session?.user?.organizationId;
  if (!userId || !orgId) return null;

  const [assigned, reviewing, externalTasks] = await Promise.all([
    prisma.article.findMany({
      where: {
        assignedToId: userId,
        project: { organizationId: orgId },
        status: { notIn: ["POSTED", "APPROVED", "ERROR"] },
      },
      include: { project: true, keyword: true, reviewer: true, assignedTo: true },
      orderBy: { updatedAt: "asc" },
    }),
    prisma.article.findMany({
      where: {
        reviewerId: userId,
        project: { organizationId: orgId },
        status: { in: ["SEO_REVIEW", "OUTLINE_APPROVED"] },
      },
      include: { project: true, keyword: true, reviewer: true, assignedTo: true },
      orderBy: { updatedAt: "asc" },
    }),
    // External tasks from Slack / Asana
    prisma.externalTask.findMany({
      where: {
        OR: [
          { assignedToId: userId },
          { assignedToId: null, organizationId: orgId },
        ],
        status: { notIn: ["DONE", "CANCELLED"] },
      },
      include: { article: { select: { id: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  const allMap = new Map<string, typeof assigned[0]>();
  [...assigned, ...reviewing].forEach((a) => allMap.set(a.id, a));
  const all = Array.from(allMap.values()).sort((a, b) => {
    const oa = URGENCY[a.status]?.order ?? 99;
    const ob = URGENCY[b.status]?.order ?? 99;
    return oa - ob;
  });

  const groups: Record<string, typeof assigned> = {};
  for (const article of all) {
    const key = article.status;
    if (!groups[key]) groups[key] = [];
    groups[key].push(article);
  }
  const sortedGroups = Object.entries(groups).sort(
    ([a], [b]) => (URGENCY[a]?.order ?? 99) - (URGENCY[b]?.order ?? 99)
  );

  const totalCount = all.length + externalTasks.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">งานของฉัน</h1>
          <p className="text-gray-500 text-sm mt-1">
            {totalCount === 0 ? "ไม่มีงานค้างอยู่ 🎉" : `${totalCount} งานที่รอดำเนินการ`}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#4A154B]" />Slack
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#F06A6A]" />Asana
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#2B4FAD]" />บทความ
          </div>
        </div>
      </div>

      {totalCount === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
          <CheckCircle2 className="h-12 w-12 text-[#1A6A46] mx-auto mb-4 opacity-50" />
          <h2 className="text-lg font-bold text-gray-900">ทำงานเสร็จหมดแล้ว!</h2>
          <p className="text-sm text-gray-500 mt-2">ยังไม่มีงานที่มอบหมายมาให้</p>
          <Link href="/articles/new" className="inline-flex items-center gap-2 mt-5 px-4 py-2 bg-[#1A1A1A] text-white text-sm font-semibold rounded-xl hover:bg-[#2D2D2D] transition-colors">
            สร้างบทความใหม่ <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {/* External Tasks (Slack / Asana) */}
      {externalTasks.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-gray-700 bg-gray-100">
              <MessageSquare className="h-3.5 w-3.5" />
              งานจาก Slack &amp; Asana
            </div>
            <span className="text-xs text-gray-400">{externalTasks.length} รายการ</span>
          </div>
          <div className="space-y-2">
            {externalTasks.map((task) => {
              const src  = SOURCE_META[task.source] ?? SOURCE_META.slack;
              const Icon = src.icon;
              return (
                <div key={task.id} className="bg-white rounded-xl border border-gray-100 hover:shadow-sm transition-all p-4">
                  <div className="flex items-start gap-4">
                    {/* Source badge */}
                    <div className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg flex-shrink-0 ${src.color}`}>
                      <Icon className="h-3 w-3" />
                      {src.label}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{task.title}</p>
                      {task.description && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">{task.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLOR[task.priority]}`}>
                          {task.priority}
                        </span>
                        {task.dueDate && (
                          <span className="text-xs text-gray-400">
                            ครบ {formatDate(task.dueDate)}
                          </span>
                        )}
                        {task.article && (
                          <Link
                            href={`/articles/${task.article.id}`}
                            className="text-xs text-[#2B4FAD] hover:underline flex items-center gap-1"
                          >
                            <ExternalLink className="h-3 w-3" />ดูบทความ
                          </Link>
                        )}
                        {task.externalUrl && (
                          <a
                            href={task.externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
                          >
                            <ExternalLink className="h-3 w-3" />
                            ดูใน {task.source === "asana" ? "Asana" : "Slack"}
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-gray-400 flex-shrink-0 text-right">
                      {formatDate(task.createdAt)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Article tasks — with quick actions */}
      <MyTasksClient
        groups={sortedGroups as [string, typeof all[0][]][]}
        urgencyMeta={Object.fromEntries(Object.entries(URGENCY).map(([k, v]) => [k, { label: v.label, color: v.color, border: v.border, order: v.order }]))}
        userId={userId}
      />
    </div>
  );
}
