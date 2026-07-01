import nextEnv from "@next/env";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const password = process.env.SEO_LOGIN_PASSWORD;
if (!password || password.length < 12) {
  throw new Error("SEO_LOGIN_PASSWORD must contain at least 12 characters");
}

if (process.env.DATABASE_URL) {
  const databaseUrl = new URL(process.env.DATABASE_URL);
  databaseUrl.searchParams.delete("schema");
  databaseUrl.searchParams.set("connect_timeout", "10");
  databaseUrl.searchParams.set("pgbouncer", "true");
  databaseUrl.searchParams.set("connection_limit", "1");
  process.env.DATABASE_URL = databaseUrl.toString();
}

const prisma = new PrismaClient();

async function upsertLoginUser(client, { username, role, organizationId, passwordHash }) {
  const email = `${username.toLowerCase()}@mars.local`;
  const existing = await client.$queryRawUnsafe(
    `SELECT "id"
     FROM "plans_seo_pipeline"."User"
     WHERE "email" = $1 OR "name" = $2
     LIMIT 1`,
    email,
    username,
  );

  if (existing.length > 0) {
    await client.$executeRawUnsafe(
      `UPDATE "plans_seo_pipeline"."User"
       SET "name" = $1, "email" = $2, "password" = $3,
           "passwordPlain" = NULL, "role" = $4, "status" = 'ACTIVE',
           "organizationId" = $5, "updatedAt" = $6
       WHERE "id" = $7`,
      username,
      email,
      passwordHash,
      role,
      organizationId,
      new Date(),
      existing[0].id,
    );
    return;
  }

  await client.$executeRawUnsafe(
    `INSERT INTO "plans_seo_pipeline"."User"
       ("id", "name", "email", "password", "role", "status",
        "organizationId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $7, $7)`,
    randomUUID(),
    username,
    email,
    passwordHash,
    role,
    organizationId,
    new Date(),
  );
}

async function main() {
  const organizations = await prisma.$queryRawUnsafe(
    `SELECT "id"
     FROM "plans_seo_pipeline"."Organization"
     ORDER BY CASE WHEN "slug" = 'demo-org' THEN 0 ELSE 1 END, "createdAt" ASC
     LIMIT 1`,
  );

  let organizationId = organizations[0]?.id;
  if (!organizationId) {
    organizationId = randomUUID();
    const now = new Date();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "plans_seo_pipeline"."Organization"
         ("id", "name", "slug", "plan", "createdAt", "updatedAt")
       VALUES ($1, 'MarsOS CVC', 'mars-os-cvc', 'pro', $2, $2)`,
      organizationId,
      now,
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction(async (transaction) => {
    await upsertLoginUser(transaction, {
      username: "adminseo",
      role: "ADMIN",
      organizationId,
      passwordHash,
    });
    await upsertLoginUser(transaction, {
      username: "userseo",
      role: "USER",
      organizationId,
      passwordHash,
    });
  });

  console.log("Login users created: adminseo (ADMIN), userseo (USER)");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
