import { Metadata } from "next";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NotificationsPageClient } from "@/components/layout/NotificationsPageClient";

export const metadata: Metadata = { title: "การแจ้งเตือน" };

export default async function NotificationsPage() {
  const session = await getSession();
  if (!session?.user?.id) return null;

  const notifications = await prisma.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return <NotificationsPageClient notifications={notifications} />;
}
