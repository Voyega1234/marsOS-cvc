import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewPrompts } from "@/services/prompts";
import { runWriterDryRun } from "@/lib/ce-writer-dry-run-server";
import { uploadArticleLanguage } from "@/lib/upload-article/build-html";
import { loadArticleLinkPairs } from "@/lib/upload-article/article-links";
import { pickLinksForKeyword } from "@/lib/upload-article/internal-links";
import { isPbnPrefsRaw } from "@/lib/upload-article/pbn";
import { resolveCeSet } from "@/lib/upload-article/pbn-context";
import { readPrefs } from "@/lib/upload-article/prefs-store";
import { DEFAULT_UPLOAD_INTERNAL_LINKS, type UploadInternalLinks, type UploadKeyword } from "@/lib/upload-article/types";
import { structureOptionsFromDetail } from "@/lib/upload-article/references";
import type { UploadThemeDetail } from "@/lib/upload-article/types";

export const dynamic = "force-dynamic";

function readPlan(prefs: Record<string, unknown> | null): UploadKeyword[] {
  return Array.isArray(prefs?.keywordPlan) ? (prefs.keywordPlan as UploadKeyword[]) : [];
}

async function loadClient(req: NextRequest, id: string) {
  const session = await getSession();
  if (!session?.user?.organizationId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (session.user.role === "CLIENT" || !canViewPrompts(session.user.role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const orgId = session.user.organizationId;
  const client = await prisma.uploadClient.findFirst({ where: { id, organizationId: orgId } });
  if (!client) return { error: NextResponse.json({ error: "ไม่พบลูกค้า" }, { status: 404 }) };
  const ceSet = resolveCeSet(client, req.url);
  if ("error" in ceSet) return { error: NextResponse.json({ error: ceSet.error }, { status: 400 }) };
  return { orgId, client, ceSet };
}

function themeDetailOf(themeColors: string | null | undefined): UploadThemeDetail | undefined {
  try {
    return (JSON.parse(themeColors || "{}") as { detail?: UploadThemeDetail }).detail;
  } catch {
    return undefined;
  }
}

// keyword ในแผนของลูกค้า ให้เลือกมาทดสอบ
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await loadClient(req, params.id);
  if (ctx.error) return ctx.error;
  const prefs = await readPrefs(ctx.client.id, ctx.orgId);
  return NextResponse.json({
    keywords: readPlan(prefs).map((k) => ({ id: k.id, keyword: k.keyword, title: k.title, note: k.note ?? "" })),
  });
}

// ประกอบ prompt ด้วยฟังก์ชันเดียวกับ write route — ไม่เรียก AI ไม่สร้างแถวบทความ
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await loadClient(req, params.id);
  if (ctx.error) return ctx.error;
  const { orgId, client, ceSet } = ctx;

  const prefs = await readPrefs(client.id, orgId);
  if (!prefs) return NextResponse.json({ error: "ไม่พบลูกค้า" }, { status: 404 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const keywordId = text(body.keywordId, 200);

  let keyword: UploadKeyword;
  if (keywordId) {
    const found = readPlan(prefs).find((k) => k.id === keywordId);
    if (!found) return NextResponse.json({ error: "ไม่พบ keyword นี้" }, { status: 404 });
    keyword = found;
  } else {
    const keywordText = text(body.keyword, 300);
    if (!keywordText) return NextResponse.json({ error: "ใส่ keyword ก่อน" }, { status: 400 });
    keyword = { id: "dry-run", keyword: keywordText, title: text(body.title, 300), slug: "", intent: "", articleType: "", note: text(body.note, 2000), createdAt: new Date().toISOString() };
  }

  const extra = await loadArticleLinkPairs(client.id, orgId, prefs);
  const rawLinks = prefs.internalLinks;
  const linkSettings: UploadInternalLinks = {
    ...DEFAULT_UPLOAD_INTERNAL_LINKS,
    ...(rawLinks && typeof rawLinks === "object" ? (rawLinks as Partial<UploadInternalLinks>) : {}),
  };
  const links = pickLinksForKeyword(linkSettings, { keyword: keyword.keyword, title: keyword.title, slug: keyword.slug, extra });

  const result = await runWriterDryRun(orgId, { projectId: ceSet.scopeId }, {
    target: "upload",
    keyword,
    links,
    language: uploadArticleLanguage(ceSet.client.language, keyword.title || keyword.keyword, keyword.keyword),
    brandNames: [client.name],
    pbn: isPbnPrefsRaw(client.pushPrefs),
    structure: structureOptionsFromDetail(themeDetailOf(client.themeColors), `${keyword.title} ${keyword.keyword}`),
  });
  return NextResponse.json(result);
}
