import { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { timelineEntries } from "@/lib/project-timeline";
import { CreateProjectButton } from "@/components/projects/CreateProjectButton";
import ProjectsTable from "@/components/projects/ProjectsTable";

export const metadata: Metadata = { title: "Clients" };

export default async function ProjectsPage() {
  const session = await getSession();
  if (!session?.user) return null;

  const userRole = session.user.role ?? "USER";

  // CLIENT must not see the Clients list — redirect to their assigned project if any
  if ((userRole as string) === "CLIENT") {
    const access = await prisma.clientProjectAccess.findFirst({
      where: { userId: session.user.id },
      select: { projectId: true },
    });
    if (access?.projectId) redirect(`/projects/${access.projectId}`);
    return null;
  }
  const orgId = session.user.organizationId;

  // CLIENT: only see projects explicitly assigned by admin.
  if (userRole !== "CLIENT" && !orgId) return null;

  interface TimelineEntry { articleStatus?: string; date?: string; title?: string; keyword?: string }

  // ── Workload: งานค้างจาก timeline (กำหนดวัน + สถานะ) และ SEO tasks ที่มี dueDate ──
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
  const weekEnd = new Date(Date.now() + 6 * 86400_000)
  const weekEndKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(weekEnd)
  const DONE_STATUSES = new Set(['done', 'approved', 'pushed'])

  // Only the fields ProjectsTable + this page actually read (owner name, timeline for
  // server-side stats). Never select secrets like wpAppPassword/siteConnection here.
  const PROJECT_SELECT = {
    id: true,
    name: true,
    clientName: true,
    website: true,
    businessType: true,
    industry: true,
    logoUrl: true,
    status: true,
    updatedAt: true,
    timeline: true,
    owner: { select: { id: true, name: true } },
  } as const;

  // Project list query and open-SEO-tasks query are independent — run them concurrently.
  // Wrapped so a DB/schema error renders an empty state instead of crashing the
  // whole page ("Server Components render error") — see PIPELINE-FIX-HANDOFF.md P0.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectsPromise: Promise<any[]> = (async () => {
    try {
      if (userRole === "CLIENT") {
        const accessList = await prisma.clientProjectAccess.findMany({
          where: { userId: session.user.id },
          include: {
            project: { select: PROJECT_SELECT },
          },
        });
        return accessList.map((a) => a.project);
      }
      // Guaranteed non-null here — the top-level guard above already returned
      // null when userRole !== "CLIENT" && !orgId.
      return await prisma.project.findMany({
        where: { organizationId: orgId! },
        select: PROJECT_SELECT,
        orderBy: { updatedAt: "desc" },
      });
    } catch (err) {
      console.error("[projects] DB query failed:", err);
      return [];
    }
  })();

  const tasksPromise = (async () => {
    try {
      if (!orgId) return [];
      return await prisma.seoTask.findMany({
        where: { organizationId: orgId, status: { notIn: ['DONE', 'CANCELLED'] }, dueDate: { not: null } },
        select: { projectId: true, dueDate: true, title: true },
      })
    } catch (err) {
      console.error('[projects] seoTask query failed:', err)
      return []
    }
  })();

  const [rawProjects, openTasks] = await Promise.all([projectsPromise, tasksPromise]);

  // SEO tasks ค้าง (สถานะไม่จบ) แยกตาม project
  const openTasksByProject = new Map<string, { dueToday: number; dueThisWeek: number; overdue: number; items: { title: string; kind: 'task'; date: string }[] }>()
  for (const t of openTasks) {
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(t.dueDate!)
    const bucket = openTasksByProject.get(t.projectId)
      ?? { dueToday: 0, dueThisWeek: 0, overdue: 0, items: [] as { title: string; kind: 'task'; date: string }[] }
    if (key < todayKey) { bucket.overdue++; bucket.items.push({ title: t.title, kind: 'task', date: key }) }
    else if (key === todayKey) { bucket.dueToday++; bucket.dueThisWeek++; bucket.items.push({ title: t.title, kind: 'task', date: key }) }
    else if (key <= weekEndKey) bucket.dueThisWeek++
    openTasksByProject.set(t.projectId, bucket)
  }

  const projects = rawProjects.map((p) => {
    // Build statusMap from timeline JSON (new system) + Article model (legacy)
    const timeline = timelineEntries<TimelineEntry>((p as any).timeline)

    const timelineStats = { total: 0, writing: 0, review: 0, approved: 0, pushed: 0 }
    const workload = {
      dueToday: 0, dueThisWeek: 0, overdue: 0, review: 0, done: 0, total: 0, progressPct: 0,
      // องค์ประกอบสถานะสำหรับแท่ง progress แบบแบ่งช่วง
      statusCounts: { pushed: 0, approved: 0, review: 0, writing: 0, pending: 0 },
      // งานจริงที่ค้าง/ถึงกำหนดวันนี้ (บทความ + SEO task) — โชว์ในแผงวันนี้
      urgentItems: [] as { title: string; kind: 'article' | 'task'; date: string; overdue: boolean }[],
      nextDue: null as string | null,
    }
    timeline.forEach((e) => {
      timelineStats.total++
      if (e.articleStatus === 'writing')  timelineStats.writing++
      if (e.articleStatus === 'review')   timelineStats.review++
      if (e.articleStatus === 'approved') timelineStats.approved++
      if (e.articleStatus === 'pushed')   timelineStats.pushed++

      workload.total++
      const st = e.articleStatus ?? ''
      const isDone = DONE_STATUSES.has(st)
      if (isDone) workload.done++
      if (st === 'pushed') workload.statusCounts.pushed++
      else if (st === 'approved' || st === 'done') workload.statusCounts.approved++
      else if (st === 'review') { workload.statusCounts.review++; workload.review++ }
      else if (st === 'writing') workload.statusCounts.writing++
      else workload.statusCounts.pending++

      const d = (e.date ?? '').slice(0, 10)
      if (!isDone && d) {
        const label = e.title || e.keyword || 'บทความไม่ระบุชื่อ'
        if (d < todayKey) {
          workload.overdue++
          workload.urgentItems.push({ title: label, kind: 'article', date: d, overdue: true })
        } else if (d === todayKey) {
          workload.dueToday++; workload.dueThisWeek++
          workload.urgentItems.push({ title: label, kind: 'article', date: d, overdue: false })
        } else if (d <= weekEndKey) {
          workload.dueThisWeek++
        }
        if (d >= todayKey && (!workload.nextDue || d < workload.nextDue)) workload.nextDue = d
      }
    })
    const tasks = openTasksByProject.get(p.id)
    if (tasks) {
      workload.dueToday += tasks.dueToday
      workload.dueThisWeek += tasks.dueThisWeek
      workload.overdue += tasks.overdue
      for (const it of tasks.items) {
        workload.urgentItems.push({ ...it, overdue: it.date < todayKey })
      }
    }
    workload.urgentItems.sort((a, b) => a.date.localeCompare(b.date))
    workload.urgentItems = workload.urgentItems.slice(0, 10)
    workload.progressPct = workload.total > 0 ? Math.round((workload.done / workload.total) * 100) : 0

    // Build the object explicitly — never spread the raw project row (it may carry
    // server-only fields like the raw `timeline` JSON) into what reaches the client.
    return {
      id: p.id,
      name: p.name,
      clientName: p.clientName,
      website: p.website,
      businessType: p.businessType,
      industry: p.industry,
      logoUrl: p.logoUrl ?? null,
      status: p.status,
      updatedAt: p.updatedAt,
      owner: p.owner,
      statusMap: {} as Record<string, number>,
      timelineStats,
      workload,
    }
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-brand-navy">Clients</h1>
          <p className="text-gray-500 text-sm mt-0.5">{projects.length} clients · คลิกเพื่อดู pipeline</p>
        </div>
        {userRole !== "CLIENT" && orgId && (
          <CreateProjectButton orgId={orgId} userId={session.user.id} />
        )}
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border">
          <div className="text-5xl mb-4">📁</div>
          <h3 className="text-lg font-semibold text-brand-navy">ยังไม่มี project</h3>
          <p className="text-gray-500 text-sm mt-1">สร้าง project แรกเพื่อเริ่มเขียนบทความ</p>
        </div>
      ) : (
        <ProjectsTable projects={projects.map(p => ({ ...p, userRole }))} userRole={userRole} />
      )}
    </div>
  );
}
