import { redirect } from "next/navigation";

export default async function ProjectArticlePage({ params }: { params: { id: string; articleId: string } }) {
  redirect(`/articles/${params.articleId}`);
}
