import { cache } from "react";
import { prisma } from "@/lib/prisma";

/**
 * The project's name and status, read once per server render. The LINE Tracking layout,
 * the project layout, the page guard and the funnel all need it for the same project in
 * the same request. React's `cache` is scoped to one request, so a status change is seen
 * on the very next request, exactly as before; outside a render it is a plain query.
 */
export const getProjectHeader = cache(async function getProjectHeader(projectId: string) {
  return prisma.ltProject.findUnique({ where: { id: projectId }, select: { name: true, status: true } });
});
