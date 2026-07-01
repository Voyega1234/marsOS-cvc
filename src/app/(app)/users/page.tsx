import { Metadata } from "next";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UsersClient } from "@/components/professional/UsersClient";

export const metadata: Metadata = { title: "Users & Roles" };

export default async function UsersPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const users = await prisma.user.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Users & Roles</h1>
        <p className="text-sm text-gray-500 mt-0.5">{users.length} team members</p>
      </div>
      <UsersClient
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          status: u.status,
          createdAt: u.createdAt,
        }))}
        currentUserId={session.user.id}
      />
    </div>
  );
}
