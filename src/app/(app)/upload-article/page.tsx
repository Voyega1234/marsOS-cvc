import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import UploadClientsBoard from "@/components/upload-article/UploadClientsBoard";

export default async function UploadArticlePage() {
  const session = await getSession();
  if (!session?.user) redirect("/setup");
  if (session.user.role === "CLIENT") redirect("/projects");

  return <UploadClientsBoard />;
}
