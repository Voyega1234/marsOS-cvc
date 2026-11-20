import { redirect, notFound } from "next/navigation";
import { getProjectBySlug } from "@/lib/line-tracking/services/projectService";
import { getConnectionConfig } from "@/lib/line-tracking/services/connectionStore";
import { buildLineLoginUrl } from "@/lib/line-tracking/services/lineService";
import { getTrackingBaseUrl, markLineClicked } from "@/lib/line-tracking/services/trackingService";
import { safeLineDestination } from "@/lib/line-tracking/lineDestination";
import type { LineConfig } from "@/lib/line-tracking/connectors";

export const dynamic = "force-dynamic";

export default async function LineStartPage({
  searchParams,
}: {
  searchParams: { project?: string; click_id?: string; next?: string; mode?: string };
}) {
  const slug = searchParams.project;
  if (!slug) notFound();
  const project = await getProjectBySlug(slug);
  if (!project) notFound();

  const clickId = searchParams.click_id;
  // ต้องประทับก่อนเด้งออกไป — จุดนี้คือที่เดียวที่ระบบรู้ว่า "คลิกไหน" กำลังจะกลาย
  // เป็นคนแอด LINE พอ redirect ไปแล้ว LINE ไม่ส่งอะไรกลับมาให้ผูกได้อีกเลย
  // (โหมด SMOOTH เดิมทิ้ง click_id ตรงนี้ทิ้งไปเฉย ๆ lead จากโฆษณาเลยจับคู่ไม่ติด)
  // ทำก่อนทุกทางออก รวมโหมด login ด้วย ตัวเลข "กดปุ่มแอดไลน์" จะได้ตรงความจริง
  // Both only need project.id, so they run together: one round trip less on every click.
  // The stamp is still finished before any redirect.
  const [config] = await Promise.all([
    getConnectionConfig<LineConfig>(project.id, "LINE"),
    markLineClicked(project.id, clickId),
  ]);
  // `next` comes from the URL, so anyone can write it. Only a LINE address is followed;
  // anything else is dropped and the project's own add-friend link is used.
  const next = safeLineDestination(searchParams.next);
  const wantLogin = searchParams.mode === "login"; // precise attribution (opt-in)

  const realLineDest = next || config.addFriendUrl;

  // Default = SMOOTH: straight to LINE add-friend (one tap, no login page).
  if (!wantLogin && realLineDest) redirect(realLineDest);

  // Opt-in = PRECISE: LINE Login (carries click_id in state for per-person attr).
  const realLoginUrl = buildLineLoginUrl(config, {
    projectSlug: project.slug,
    clickId,
    redirectUri: `${getTrackingBaseUrl()}/line/callback`,
  });
  if (realLoginUrl) redirect(realLoginUrl);

  // Fallbacks.
  if (realLineDest) redirect(realLineDest);

  // 3) No LINE configured at all: a plain "not ready yet" notice.
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-lg">
        <h1 className="text-xl font-bold text-gray-900">{project.name}</h1>
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
          ยังไม่ได้เชื่อมต่อ LINE สำหรับโปรเจกต์นี้ — กรุณาติดต่อผู้ดูแลระบบ
        </p>
      </div>
    </main>
  );
}
