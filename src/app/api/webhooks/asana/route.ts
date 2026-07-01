import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

// ── Verify Asana webhook signature ───────────────────────────────────────────

function verifyAsana(req: NextRequest, rawBody: string): boolean {
  const secret = process.env.ASANA_WEBHOOK_SECRET;
  if (!secret) return true; // skip in dev

  const signature = req.headers.get("x-hook-signature") ?? "";
  const expected  = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return signature === expected;
}

// ── Asana priority → system priority ─────────────────────────────────────────

function mapPriority(tags: string[]): string {
  const t = tags.join(" ").toLowerCase();
  if (t.includes("high") || t.includes("urgent")) return "HIGH";
  if (t.includes("low"))                           return "LOW";
  return "MEDIUM";
}

// ── Asana status → system status ─────────────────────────────────────────────

function mapStatus(completed: boolean, completedAt: string | null): string {
  if (completed) return "DONE";
  return "TODO";
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Asana handshake: first request has X-Hook-Secret header → echo it back
  const hookSecret = req.headers.get("x-hook-secret");
  if (hookSecret) {
    return new NextResponse(null, {
      status: 200,
      headers: { "X-Hook-Secret": hookSecret },
    });
  }

  if (!verifyAsana(req, rawBody)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let events: AsanaEvent[];
  try {
    const body = JSON.parse(rawBody);
    events = body.events ?? [];
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const org = await prisma.organization.findFirst();
  if (!org) return NextResponse.json({ ok: true });

  for (const event of events) {
    if (event.resource?.resource_type !== "task") continue;

    const asanaGid = event.resource.gid;
    if (!asanaGid) continue;

    try {
      // Fetch task details from Asana API
      const asanaToken = process.env.ASANA_ACCESS_TOKEN;
      if (!asanaToken) continue;

      const taskRes = await fetch(
        `https://app.asana.com/api/1.0/tasks/${asanaGid}?opt_fields=name,notes,completed,completed_at,assignee.email,due_on,permalink_url,tags.name`,
        { headers: { Authorization: `Bearer ${asanaToken}` } }
      );
      if (!taskRes.ok) continue;

      const { data: task } = await taskRes.json() as { data: AsanaTask };

      // Find assigned user by email
      const assignedUser = task.assignee?.email
        ? await prisma.user.findFirst({ where: { email: task.assignee.email } })
        : null;

      const status   = mapStatus(task.completed, task.completed_at ?? null);
      const priority = mapPriority((task.tags ?? []).map((t) => t.name));
      const dueDate  = task.due_on ? new Date(task.due_on) : null;

      // Upsert ExternalTask
      await prisma.externalTask.upsert({
        where: {
          organizationId_source_externalId: {
            organizationId: org.id,
            source:         "asana",
            externalId:     asanaGid,
          },
        },
        update: {
          title:        task.name,
          description:  task.notes ?? null,
          assignedToId: assignedUser?.id ?? null,
          status,
          priority,
          dueDate,
        },
        create: {
          organizationId: org.id,
          source:         "asana",
          externalId:     asanaGid,
          title:          task.name,
          description:    task.notes ?? null,
          assignedToId:   assignedUser?.id ?? null,
          status,
          priority,
          dueDate,
          externalUrl:    task.permalink_url ?? null,
        },
      });
    } catch (err) {
      console.error("[Asana webhook] task error:", err);
    }
  }

  return NextResponse.json({ ok: true });
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AsanaEvent {
  resource?: { gid: string; resource_type: string };
  action?: string;
}

interface AsanaTask {
  name:          string;
  notes?:        string;
  completed:     boolean;
  completed_at?: string | null;
  due_on?:       string | null;
  permalink_url?:string;
  assignee?:     { email: string } | null;
  tags?:         { name: string }[];
}
