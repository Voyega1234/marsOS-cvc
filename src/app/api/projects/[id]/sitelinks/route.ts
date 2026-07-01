import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getGSCAuth } from "@/lib/google-auth";
import { google } from "googleapis";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const source = req.nextUrl.searchParams.get("source") ?? "gsc";
  const siteUrlParam = req.nextUrl.searchParams.get("siteUrl");

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId },
    select: { id: true, gscSiteUrl: true, website: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // List all GSC properties the org has access to
  if (source === "properties") {
    try {
      const auth = getGSCAuth();
      const sc = google.searchconsole({ version: "v1", auth });
      const res = await sc.sites.list();
      const properties = (res.data.siteEntry ?? [])
        .map((s: { siteUrl?: string | null }) => s.siteUrl ?? "")
        .filter(Boolean);
      return NextResponse.json({ properties });
    } catch {
      return NextResponse.json({ properties: [] });
    }
  }

  if (source === "gsc") {
    const siteUrl = siteUrlParam || project.gscSiteUrl;
    if (!siteUrl) {
      return NextResponse.json({ links: [], warning: "No GSC site URL configured" });
    }
    try {
      const auth = getGSCAuth();
      const sc = google.searchconsole({ version: "v1", auth });
      const now = new Date();
      const endDate = new Date(now.getTime() - 3 * 86400000);
      const startDate = new Date(endDate.getTime() - 90 * 86400000);
      const fmt = (d: Date) => d.toISOString().split("T")[0];

      const res = await sc.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: fmt(startDate),
          endDate: fmt(endDate),
          dimensions: ["query", "page"],
          rowLimit: 500,
        } as never,
      });

      const rows = res.data.rows ?? [];
      const urlMap = new Map<string, { keyword: string; url: string; clicks: number }>();
      for (const r of rows as { keys?: string[] | null; clicks?: number | null }[]) {
        const keyword = r.keys?.[0] ?? "";
        const fullUrl = r.keys?.[1] ?? "";
        const clicks = r.clicks ?? 0;
        const existing = urlMap.get(fullUrl);
        if (!existing || clicks > existing.clicks) {
          urlMap.set(fullUrl, { keyword, url: fullUrl, clicks });
        }
      }

      return NextResponse.json({ links: Array.from(urlMap.values()) });
    } catch (e) {
      return NextResponse.json({ links: [], error: String(e) });
    }
  }

  return NextResponse.json({ links: [] });
}
