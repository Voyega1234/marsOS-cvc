import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import ComplianceClient from "@/components/compliance/ComplianceClient";

export const dynamic = "force-dynamic";

/** Compliance Checker — ตรวจบทความกับกฎโฆษณารายอุตสาหกรรม (เฉพาะทีมงาน ไม่รวม CLIENT) */
export default async function CompliancePage() {
  const session = await getSession();
  if (!session?.user) redirect("/setup");
  if (session.user.role === "CLIENT") redirect("/projects");
  if (!session.user.organizationId || !session.user.id) redirect("/setup");

  return <ComplianceClient userRole={session.user.role} />;
}
