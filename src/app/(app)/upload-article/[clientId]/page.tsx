import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import UploadClientWorkspace from "@/components/upload-article/UploadClientWorkspace";

export default async function UploadArticleWorkspacePage({
  params,
  searchParams,
}: {
  params: { clientId: string };
  searchParams: { tab?: string; section?: string };
}) {
  const session = await getSession();
  if (!session?.user) redirect("/setup");
  if (session.user.role === "CLIENT") redirect("/projects");

  // ดึงรายละเอียด client ฝั่ง client component เอง (กัน type error ถ้า prisma type ฝั่ง backend
  // ยังไม่ regenerate เสร็จ) — ไม่พบ (404) ให้ component แสดง "ไม่พบลูกค้า"
  return (
    <UploadClientWorkspace
      clientId={params.clientId}
      initialTab={searchParams?.tab}
      initialSection={searchParams?.section}
      userRole={session.user.role}
    />
  );
}
