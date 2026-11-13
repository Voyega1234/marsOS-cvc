import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import BacklinkManagementClient from "@/components/backlink-management/BacklinkManagementClient";

export const dynamic = "force-dynamic";

/** Backlink Management — คำขอ backlink งบประมาณ และการติดตามลิงก์ (โมดูลเสริม ไม่ยุ่งกับ backlink เดิม) */
export default async function BacklinkManagementPage() {
  const session = await getSession();
  if (!session?.user) redirect("/setup");
  if (session.user.role === "CLIENT") redirect("/projects");
  if (!session.user.organizationId || !session.user.id) redirect("/setup");

  return <BacklinkManagementClient userRole={session.user.role} />;
}
