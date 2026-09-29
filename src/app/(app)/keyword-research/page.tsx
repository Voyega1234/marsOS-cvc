import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import StandaloneKeywordResearch from "@/components/keyword-research/StandaloneKeywordResearch";

export const dynamic = "force-dynamic";

/**
 * Keyword Research — หน้าใหม่ ไม่ผูกกับโปรเจกต์ SEO SME
 * ใช้ WordGodOnlinePanel/WordGodLocalPanel (โหมด standalone) แล้วส่งต่อผลลัพธ์ไป
 * Keyword ของลูกค้า Upload Article เอง (ไม่บันทึกลง Keyword Bank ของโปรเจกต์)
 */
export default async function KeywordResearchPage() {
  const session = await getSession();
  if (!session?.user) redirect("/setup");
  if (session.user.role === "CLIENT") redirect("/projects");

  return <StandaloneKeywordResearch />;
}
