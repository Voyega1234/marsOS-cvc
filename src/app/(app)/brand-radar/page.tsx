import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import BrandRadarClient from "@/components/brand-radar/BrandRadarClient";

export const dynamic = "force-dynamic";

export default async function BrandRadarPage() {
  const session = await getSession();
  if (!session?.user) redirect("/setup");
  if (session.user.role === "CLIENT") redirect("/projects");
  if (!session.user.organizationId || !session.user.id) redirect("/setup");
  return <BrandRadarClient userRole={session.user.role} />;
}
