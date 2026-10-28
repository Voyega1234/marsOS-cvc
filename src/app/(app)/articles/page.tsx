import { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { loadArticleOverview } from "@/lib/article-overview-server";
import { AllArticlesClient } from "@/components/articles/AllArticlesClient";

export const metadata: Metadata = { title: "บทความทั้งหมด" };

export default async function ArticlesPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  // ทั้งระบบ: SEO SME + Upload Article + PBN Backlinks
  const { articles, clients } = await loadArticleOverview(orgId);

  return <AllArticlesClient articles={articles} clients={clients} />;
}
