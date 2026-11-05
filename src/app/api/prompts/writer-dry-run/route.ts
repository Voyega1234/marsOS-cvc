import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewPrompts } from "@/services/prompts";
import { runWriterDryRun } from "@/lib/ce-writer-dry-run-server";
import { uploadArticleLanguage } from "@/lib/upload-article/build-html";
import { projectThemeToUpload } from "@/lib/project-theme";
import { structureOptionsFromDetail } from "@/lib/upload-article/references";
import type { UploadKeyword, UploadThemeDetail } from "@/lib/upload-article/types";

export const dynamic = "force-dynamic";

// Run Test ของโปรเจกต์ SEO / Content Studio — ไม่มีแผน keyword ให้เลือก ผู้ใช้พิมพ์เอง
export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewPrompts(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ keywords: [] });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewPrompts(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const orgId = session.user.organizationId;

  const projectId = new URL(req.url).searchParams.get("projectId");
  let language: string | null = null;
  let themeDetail: UploadThemeDetail | undefined;
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: orgId }, select: { language: true, themeColors: true, accentColor: true } });
    if (!project) return NextResponse.json({ error: "ไม่พบโปรเจกต์" }, { status: 404 });
    language = project.language;
    themeDetail = projectThemeToUpload(project.themeColors, project.accentColor).detail;
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const keywordText = text(body.keyword, 300);
  if (!keywordText) return NextResponse.json({ error: "ใส่ keyword ก่อน" }, { status: 400 });
  const title = text(body.title, 300);

  const keyword: UploadKeyword = {
    id: "dry-run",
    keyword: keywordText,
    title,
    slug: "",
    intent: "",
    articleType: "",
    note: text(body.note, 2000),
    createdAt: new Date().toISOString(),
  };
  const result = await runWriterDryRun(orgId, projectId ? { projectId } : "studio", {
    target: "seo",
    keyword,
    language: uploadArticleLanguage(language ?? "th", title, keywordText),
    structure: structureOptionsFromDetail(themeDetail, `${title} ${keywordText}`),
  });
  return NextResponse.json(result);
}
