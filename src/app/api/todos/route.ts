import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { MarsTask } from "@/lib/mock-data/todos";

export async function GET() {
  const session = await getSession();
  const orgId = session?.user?.organizationId ?? "";
  if (!orgId) return NextResponse.json([]);

  try {
    const [externalTasks, reviews, stuckArticles, projects] = await Promise.all([
      prisma.externalTask.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.review.findMany({
        where: {
          article: { project: { organizationId: orgId } },
          status: { in: ["PENDING", "CHANGES_REQUESTED"] },
        },
        include: {
          article: {
            select: {
              id: true, title: true, status: true, slug: true,
              project: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
        take: 20,
      }),
      prisma.article.findMany({
        where: {
          project: { organizationId: orgId },
          status: { in: ["SEO_REVIEW", "REVIEW"] },
        },
        include: { project: { select: { id: true, name: true } } },
        orderBy: { updatedAt: "asc" },
        take: 10,
      }),
      prisma.project.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true },
      }),
    ]);

    const tasks: MarsTask[] = [];

    // Manual / ExternalTask → MarsTask
    for (const t of externalTasks) {
      const proj = t.articleId
        ? projects.find(p => p.id === (t as typeof t & { projectId?: string }).projectId)
        : null;
      tasks.push({
        id: t.id,
        title: t.title,
        description: t.description ?? "",
        source: (t.source as MarsTask["source"]) ?? "manual",
        status: mapStatus(t.status),
        priority: mapPriority(t.priority),
        assignee: "Team",
        projectId: null,
        projectName: proj?.name ?? null,
        dueDate: t.dueDate
          ? new Date(t.dueDate).toISOString().slice(0, 10)
          : new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
        tags: [],
        createdAt: t.createdAt.toISOString(),
        actionHref: t.externalUrl ?? undefined,
        artifact: t.articleId
          ? {
              type: "article",
              id: t.articleId,
              title: t.title,
              status: "DRAFT",
              href: `/articles/${t.articleId}`,
            }
          : undefined,
      });
    }

    // Pending reviews → tasks
    for (const r of reviews) {
      tasks.push({
        id: `review-${r.id}`,
        title: `รีวิวบทความ "${r.article.title}"`,
        description:
          r.status === "CHANGES_REQUESTED"
            ? "มีการขอแก้ไข — ต้องดำเนินการ"
            : "บทความรอการรีวิวจากทีม",
        source: "review",
        status: r.status === "CHANGES_REQUESTED" ? "blocked" : "todo",
        priority: "high",
        assignee: "Reviewer",
        projectId: r.article.project.id,
        projectName: r.article.project.name,
        dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        tags: ["review"],
        createdAt: r.createdAt.toISOString(),
        actionHref: `/projects/${r.article.project.id}?tab=review`,
        actionLabel: "เปิด Review Queue",
        artifact: {
          type: "review",
          id: r.article.id,
          title: r.article.title,
          status: r.article.status,
          href: `/projects/${r.article.project.id}?tab=review`,
        },
      });
    }

    // Stuck articles (SEO_REVIEW / REVIEW) → tasks
    for (const a of stuckArticles) {
      const alreadyHasReviewTask = tasks.some(
        t => t.id.startsWith("review-") && t.artifact?.id === a.id
      );
      if (alreadyHasReviewTask) continue;
      const daysSince = Math.floor(
        (Date.now() - new Date(a.updatedAt).getTime()) / 86400000
      );
      tasks.push({
        id: `seo-review-${a.id}`,
        title: `SEO Review บทความ "${a.title}"`,
        description: `ค้างอยู่ที่ขั้นตอน ${a.status} มา ${daysSince} วัน`,
        source: "mars",
        status: daysSince > 2 ? "blocked" : "in_progress",
        priority: daysSince > 2 ? "urgent" : "high",
        assignee: "SEO Team",
        projectId: a.project.id,
        projectName: a.project.name,
        dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        tags: ["seo", "review"],
        createdAt: a.updatedAt.toISOString(),
        actionHref: `/projects/${a.project.id}?tab=review`,
        actionLabel: "เปิด Review Queue",
        artifact: {
          type: "article",
          id: a.id,
          title: a.title,
          status: a.status,
          href: `/projects/${a.project.id}?tab=articles`,
        },
      });
    }

    // Sort: blocked/urgent first, then by dueDate
    tasks.sort((a, b) => {
      const pri: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
      const stat: Record<string, number> = { blocked: 0, in_progress: 1, todo: 2, done: 3 };
      if (stat[a.status] !== stat[b.status]) return stat[a.status] - stat[b.status];
      if (pri[a.priority] !== pri[b.priority]) return pri[a.priority] - pri[b.priority];
      return a.dueDate.localeCompare(b.dueDate);
    });

    return NextResponse.json(tasks);
  } catch (e) {
    console.error("[todos GET]", e);
    return NextResponse.json([]);
  }
}

// ── Create manual task ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { title, description, priority, dueDate, actionHref } = await req.json();
  if (!title?.trim()) return NextResponse.json({ error: "title required" }, { status: 400 });

  try {
    const task = await prisma.externalTask.create({
      data: {
        organizationId: orgId,
        source: "manual",
        title: title.trim(),
        description: description?.trim() ?? "",
        priority: (priority ?? "NORMAL").toUpperCase(),
        status: "TODO",
        dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 3 * 86400000),
        externalUrl: actionHref?.trim() || null,
      },
    });
    return NextResponse.json({ ok: true, id: task.id });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ── Update task status ────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, status, priority, title, description, dueDate } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // review-* and seo-review-* are derived from DB — only update status in-memory
  if (id.startsWith("review-") || id.startsWith("seo-review-")) {
    return NextResponse.json({ ok: true });
  }

  try {
    await prisma.externalTask.update({
      where: { id, organizationId: orgId },
      data: {
        ...(status !== undefined && { status: status.toUpperCase() }),
        ...(priority !== undefined && { priority: priority.toUpperCase() }),
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(dueDate !== undefined && { dueDate: new Date(dueDate) }),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ── Delete manual task ────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  if (!id || id.startsWith("review-") || id.startsWith("seo-review-")) {
    return NextResponse.json({ ok: true });
  }

  try {
    await prisma.externalTask.delete({ where: { id, organizationId: orgId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function mapStatus(s: string): MarsTask["status"] {
  const m: Record<string, MarsTask["status"]> = {
    TODO: "todo", IN_PROGRESS: "in_progress", DONE: "done", BLOCKED: "blocked",
  };
  return m[s?.toUpperCase()] ?? "todo";
}

function mapPriority(p: string): MarsTask["priority"] {
  const m: Record<string, MarsTask["priority"]> = {
    URGENT: "urgent", HIGH: "high", MEDIUM: "normal", NORMAL: "normal", LOW: "low",
  };
  return m[p?.toUpperCase()] ?? "normal";
}
