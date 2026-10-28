import { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { loadArticleOverview } from "@/lib/article-overview-server";
import { CalendarClient } from "@/components/calendar/CalendarClient";

export const metadata: Metadata = { title: "Content Calendar" };

export default async function CalendarPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  // ทั้งระบบ: SEO SME (Project.timeline) + Upload Article + PBN Backlinks
  // plans = ช่วงเวลาทำงานที่ทีมตั้งไว้ในหน้า Project Timeline — ใช้จำกัดวันที่เลือกได้ในปฏิทิน
  const { articles, clients, plans } = await loadArticleOverview(orgId);

  return <CalendarClient articles={articles} clients={clients} plans={plans} />;
}
