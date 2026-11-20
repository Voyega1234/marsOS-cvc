import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Public page (no login): anyone holding the URL can open it, so it shows only the
// project's own public name/website — never the lead's details or the projectId.

export default async function LineSuccessPage({
  searchParams,
}: {
  searchParams: { lead_id?: string };
}) {
  const leadId = searchParams.lead_id;
  if (!leadId) notFound();
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { project: { select: { name: true, clientName: true, websiteUrl: true } } },
  });
  if (!lead) notFound();

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-lg">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#06C755] text-3xl text-white">
          ✓
        </div>
        <h1 className="text-xl font-bold text-gray-900">เพิ่มเพื่อนสำเร็จ! 🎉</h1>
        <p className="mt-2 text-sm text-gray-500">
          ขอบคุณที่แอด LINE ของ {lead.project.name} — ทีมงานจะติดต่อกลับโดยเร็ว
        </p>

        {lead.project.websiteUrl && (
          <a href={lead.project.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#06C755] px-4 py-2 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50 mt-6 w-full">
            🌐 ไปที่เว็บไซต์ {lead.project.clientName}
          </a>
        )}
      </div>
    </main>
  );
}
