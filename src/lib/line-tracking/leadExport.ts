// Builds the Leads CRM export for one project. Used by the export route:
//   /line-tracking/projects/[projectId]/leads/export  (staff only)
// This function does NOT check who is asking: each route does that before calling it.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { leadWhere } from "@/lib/line-tracking/services/leadService";
import { parseChatFilter } from "@/lib/line-tracking/services/leadFilters";
import { LEAD_STATUS } from "@/lib/line-tracking/enums";
import { resolveRange } from "@/lib/line-tracking/date-range";
import { ALL_CHANNELS, activeChannelKey } from "@/lib/line-tracking/services/channelService";
import { attachmentDisposition, leadExportFilename, leadsCsv } from "@/lib/line-tracking/leadExportCsv";

/**
 * The CSV download for a project's leads, or a 404 when the project does not exist.
 *
 * รับตัวกรองชุดเดียวกับหน้า Leads CRM (q / range / from / to / channel / status / chat) ผ่าน
 * query string และใช้ leadWhere ตัวเดียวกับหน้าเว็บ — กรอง channel ไว้บนจอแล้วกด Export
 * ต้องได้เฉพาะ channel นั้น ไม่ใช่ทั้งโปรเจกต์
 */
export async function leadsExportResponse(projectId: string, sp: URLSearchParams): Promise<NextResponse> {
  const project = await prisma.ltProject.findUnique({ where: { id: projectId }, select: { id: true, slug: true } });
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const q = sp.get("q")?.trim() ?? "";
  const channel = activeChannelKey({ channel: sp.get("channel") ?? undefined });
  const statusParam = sp.get("status") ?? "";
  const status = (LEAD_STATUS as readonly string[]).includes(statusParam) ? statusParam : undefined;
  const range = resolveRange({
    range: sp.get("range") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  });

  const leads = await prisma.lead.findMany({
    where: leadWhere(project.id, { q, range, channel, status, chat: parseChatFilter(sp.get("chat")) }),
    orderBy: { createdAt: "desc" },
    include: { lineUser: true },
  });

  const filename = leadExportFilename(project.slug, channel === ALL_CHANNELS ? null : channel, new Date());
  return new NextResponse(leadsCsv(leads), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": attachmentDisposition(filename),
      // Names and phone numbers: never kept by a shared cache.
      "cache-control": "private, no-store",
    },
  });
}
