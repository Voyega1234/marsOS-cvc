import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import crypto from "crypto";

// ── Verify Slack request signature ───────────────────────────────────────────

function verifySlackSignature(req: NextRequest, rawBody: string): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return true; // skip in dev if not configured

  const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";
  const signature = req.headers.get("x-slack-signature") ?? "";

  // Replay attack protection: reject requests older than 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ── Parse /mars command text ────────────────────────────────────────────────
// Supports: /mars [title] [@user] [--project name] [--priority high|medium|low]

function parseCommand(text: string) {
  const title    = text.replace(/--\w+[^\s]*/g, "").replace(/@\w+/g, "").trim() || "New Task from Slack";
  const projMatch = text.match(/--project\s+([^\s-][^-]*?)(?=\s+--|$)/i);
  const prioMatch = text.match(/--priority\s+(high|medium|low)/i);
  const userMatch = text.match(/@(\S+)/);

  return {
    title: title.slice(0, 200),
    projectName: projMatch?.[1]?.trim() ?? null,
    priority: (prioMatch?.[1]?.toUpperCase() ?? "MEDIUM") as "HIGH" | "MEDIUM" | "LOW",
    slackUsername: userMatch?.[1] ?? null,
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Verify signature
  if (!verifySlackSignature(req, rawBody)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Parse form data (Slack sends application/x-www-form-urlencoded)
  const params = new URLSearchParams(rawBody);
  const command     = params.get("command") ?? "";
  const text        = params.get("text") ?? "";
  const userId      = params.get("user_id") ?? "";
  const userEmail   = params.get("user_email") ?? "";
  const userName    = params.get("user_name") ?? "";
  const teamId      = params.get("team_id") ?? "";

  // Accept /mars, /Mars, /JARVIS (case-insensitive)
  if (!/^\/mars$/i.test(command.trim())) {
    return NextResponse.json({ text: "Unknown command" }, { status: 200 });
  }

  // Handle "help" subcommand
  if (!text.trim() || text.trim().toLowerCase() === "help") {
    return NextResponse.json({
      response_type: "ephemeral",
      text: [
        "*Mars OS — SEO Pipeline* 🤖",
        "```",
        "/mars [title]                     สร้างงานใหม่ใน My Tasks",
        "/mars [title] @username           assign ให้คนอื่น",
        "/mars [title] --project Co Journey  ผูกกับ project",
        "/mars [title] --priority high     ตั้ง priority",
        "```",
        "ตัวอย่าง: `/mars เขียนบทความวีซ่าเชงเก้น --project Co Journey --priority high`",
      ].join("\n"),
    });
  }

  const parsed = parseCommand(text);

  try {
    // Find organization by Slack team (use first org if not mapped yet)
    const org = await prisma.organization.findFirst();
    if (!org) {
      return NextResponse.json({ text: "❌ ยังไม่มี Organization ในระบบ" }, { status: 200 });
    }

    // Find system user by email or name
    let assignedUser = await prisma.user.findFirst({
      where: { OR: [{ email: userEmail }, { name: { contains: userName } }] },
    });

    // If specified @username, look that up instead
    if (parsed.slackUsername) {
      const target = await prisma.user.findFirst({
        where: { name: { contains: parsed.slackUsername } },
      });
      if (target) assignedUser = target;
    }

    // Find project if specified
    let projectId: string | null = null;
    if (parsed.projectName) {
      const proj = await prisma.project.findFirst({
        where: {
          organizationId: org.id,
          name: { contains: parsed.projectName },
        },
      });
      projectId = proj?.id ?? null;
    }

    // Create ExternalTask
    const task = await prisma.externalTask.create({
      data: {
        organizationId: org.id,
        source:         "slack",
        externalId:     `${userId}-${Date.now()}`,
        title:          parsed.title,
        description:    `Assigned via Slack by @${userName}`,
        assignedToId:   assignedUser?.id ?? null,
        priority:       parsed.priority,
        status:         "TODO",
      },
    });

    // If project specified, also create a draft Article
    let articleLink = "";
    if (projectId && assignedUser) {
      const article = await prisma.article.create({
        data: {
          title:       parsed.title,
          slug:        slugify(parsed.title),
          projectId,
          status:      "NEW",
          funnelStage: "TOFU",
          searchIntent:"INFORMATIONAL",
          createdById: assignedUser.id,
          assignedToId:assignedUser.id,
        },
      });
      // Link task to article
      await prisma.externalTask.update({
        where: { id: task.id },
        data: { articleId: article.id },
      });
      articleLink = ` → <${process.env.NEXTAUTH_URL}/articles/${article.id}|ดูบทความ>`;
    }

    const assignee = assignedUser ? `@${assignedUser.name}` : "ยังไม่ได้ assign";

    return NextResponse.json({
      response_type: "in_channel",
      text: [
        `✅ *สร้างงานแล้ว:* ${parsed.title}`,
        `👤 Assigned to: ${assignee}`,
        `🎯 Priority: ${parsed.priority}`,
        projectId ? `📁 Project: ${parsed.projectName}` : "",
        `🔗 <${process.env.NEXTAUTH_URL}/my-tasks|ดูใน My Tasks>${articleLink}`,
      ].filter(Boolean).join("\n"),
    });

  } catch (err) {
    console.error("[Slack webhook]", err);
    return NextResponse.json({ text: "❌ เกิดข้อผิดพลาด กรุณาลองใหม่" }, { status: 200 });
  }
}
