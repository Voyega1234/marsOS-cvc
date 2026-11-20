import { prisma } from "@/lib/prisma";

/** Internal owner record required by the current relational schema. It has no shared credentials. */
export async function getDefaultAgency() {
  const workspace = await prisma.ltWorkspace.findFirst({ orderBy: { createdAt: "asc" } });
  if (workspace) return workspace;
  return prisma.ltWorkspace.create({
    data: { name: "Line Tracking Workspace", sharedConfigJson: "{}" },
  });
}
