import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import UploadClientWorkspace from "@/components/upload-article/UploadClientWorkspace";
import { getOrCreatePbnClientId } from "@/lib/upload-article/pbn-store";

export const dynamic = "force-dynamic";

/**
 * PBN Backlinks — โปรเจกต์เดียวต่อองค์กร เปิดมาเข้า workspace ทันที (ไม่มีหน้ารวมลูกค้า)
 * ใช้ workspace ชุดเดียวกับ Upload Article ในโหมด "pbn" — ข้อมูล/Content Engine แยกกันด้วย client id ของตัวเอง
 */
export default async function PbnBacklinksPage({
  searchParams,
}: {
  searchParams: { tab?: string; section?: string };
}) {
  const session = await getSession();
  if (!session?.user) redirect("/setup");
  if (session.user.role === "CLIENT") redirect("/projects");
  if (!session.user.organizationId || !session.user.id) redirect("/setup");

  const clientId = await getOrCreatePbnClientId(session.user.organizationId, session.user.id);

  return (
    <UploadClientWorkspace
      clientId={clientId}
      initialTab={searchParams?.tab}
      initialSection={searchParams?.section}
      userRole={session.user.role}
      mode="pbn"
    />
  );
}
