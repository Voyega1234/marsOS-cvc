import { Metadata } from "next";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { PromptEditorClient } from "@/components/prompts/PromptEditorClient";

export const metadata: Metadata = { title: "New Prompt" };

export default async function NewPromptPage() {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role;
  if (!["ADMIN", "SEO_MANAGER"].includes(role)) redirect("/dashboard");

  return (
    <PromptEditorClient
      prompt={null}
      orgId={session.user.organizationId!}
      userRole={role}
      versions={[]}
      activity={[]}
    />
  );
}
