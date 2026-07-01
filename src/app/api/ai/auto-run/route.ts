import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toUserMessage } from "@/services/ai/errors";
import type { Role } from "@/types";
import {
  runOutline, runArticleWriter, runSeoCheck,
  runImagePrompt, runWordPressPublisher,
} from "@/services/ai";

// Steps in order: each entry = { requiredStatus, run, nextStatus }
// For SEMI_AUTO: outline and seo-check require human approval before proceeding
// For FULL_AUTO: auto-approve at outline and seo-check steps
const PIPELINE = [
  {
    name: "outline",
    requiredStatuses: ["KEYWORD_DONE", "CONTENT_MAP_DONE", "NEW"],
    run: (args: RunArgs) => runOutline(args),
    pauseOnSemiAuto: false,
  },
  {
    name: "approve-outline",
    requiredStatuses: ["OUTLINE_DONE"],
    run: null,
    pauseOnSemiAuto: true,
    autoApproveStatus: "OUTLINE_APPROVED",
  },
  {
    name: "article",
    requiredStatuses: ["OUTLINE_APPROVED"],
    run: (args: RunArgs) => runArticleWriter(args),
    pauseOnSemiAuto: false,
  },
  {
    name: "seo-check",
    requiredStatuses: ["ARTICLE_DONE"],
    run: (args: RunArgs) => runSeoCheck(args),
    pauseOnSemiAuto: false,
  },
  {
    name: "approve-article",
    requiredStatuses: ["SEO_REVIEW"],
    run: null,
    pauseOnSemiAuto: true,
    autoApproveStatus: "APPROVED",
  },
  {
    name: "image-prompt",
    requiredStatuses: ["ARTICLE_DONE", "APPROVED"],
    run: (args: RunArgs) => runImagePrompt(args),
    pauseOnSemiAuto: false,
  },
  {
    name: "wordpress",
    requiredStatuses: ["APPROVED"],
    run: (args: RunArgs) => runWordPressPublisher(args),
    pauseOnSemiAuto: false,
  },
];

type RunArgs = {
  articleId: string;
  organizationId: string;
  userId: string;
  userRole: Role;
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.user.organizationId) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const { articleId, modeOverride } = await req.json();
  if (!articleId) return NextResponse.json({ error: "articleId required" }, { status: 400 });

  const organizationId = session.user.organizationId;
  const userId = session.user.id;
  const userRole = session.user.role as Role;

  try {
    const article = await prisma.article.findFirst({
      where: { id: articleId, project: { organizationId } },
      include: { project: { select: { automationMode: true } } },
    });
    if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });

    // modeOverride from QuickCreate bypasses project's MANUAL setting
    const mode = (modeOverride ?? article.project.automationMode) as "MANUAL" | "SEMI_AUTO" | "FULL_AUTO";
    if (mode === "MANUAL") {
      return NextResponse.json({ error: "Auto-run is disabled (MANUAL mode)" }, { status: 400 });
    }

    const stepsRun: string[] = [];
    const stepsStopped: string[] = [];
    const visitedSteps = new Set<string>(); // prevent any step running twice in one request

    let currentArticle = article;

    for (const step of PIPELINE) {
      // Reload status
      const fresh = await prisma.article.findFirst({ where: { id: articleId }, select: { status: true } });
      if (!fresh) break;
      currentArticle = { ...currentArticle, status: fresh.status };

      if (!step.requiredStatuses.includes(currentArticle.status)) continue;
      if (visitedSteps.has(step.name)) continue; // guard against misconfigured approval loops
      visitedSteps.add(step.name);

      // Approval step
      if (step.run === null && step.autoApproveStatus) {
        if (mode === "FULL_AUTO") {
          await prisma.article.update({
            where: { id: articleId },
            data: { status: step.autoApproveStatus },
          });
          stepsRun.push(step.name);
        } else if (mode === "SEMI_AUTO" && step.pauseOnSemiAuto) {
          stepsStopped.push(step.name);
          break;
        }
        continue;
      }

      // AI step
      if (step.run) {
        await step.run({ articleId, organizationId, userId, userRole });
        stepsRun.push(step.name);
      }
    }

    return NextResponse.json({
      ok: true,
      mode,
      stepsRun,
      stepsStopped,
      message: stepsStopped.length > 0
        ? `หยุดรอ approve ที่ขั้นตอน: ${stepsStopped.join(", ")}`
        : `รัน ${stepsRun.length} ขั้นตอนเสร็จแล้ว`,
    });
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err) }, { status: 500 });
  }
}
