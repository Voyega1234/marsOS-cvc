import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { claimOnce, CLAIM_RETENTION_SECONDS } from "./claim";

// These tests write to the claims table, so they only run against the local dev database.
// Against anything else they are skipped: a test run must never write to a real database.
const LOCAL = /@(127\.0\.0\.1|localhost):/.test(process.env.DATABASE_URL ?? "");
const opts = { skip: LOCAL ? false : "needs the local dev database" };

async function forget(keys: string[]) {
  await prisma.$executeRawUnsafe(
    `DELETE FROM "line_tracking"."lt_webhook_dedupe" WHERE key = ANY($1::text[])`,
    keys
  );
}

test("claimOnce: the first call wins, a second call inside the window does not", opts, async () => {
  const key = `test:${randomUUID()}`;
  try {
    assert.equal(await claimOnce(key, 300), true);
    assert.equal(await claimOnce(key, 300), false);
    assert.equal(await claimOnce(key, CLAIM_RETENTION_SECONDS), false);
  } finally {
    await forget([key]);
  }
});

test("claimOnce: keys do not block each other", opts, async () => {
  const a = `test:${randomUUID()}`;
  const b = `test:${randomUUID()}`;
  try {
    assert.equal(await claimOnce(a, 300), true);
    assert.equal(await claimOnce(b, 300), true);
  } finally {
    await forget([a, b]);
  }
});

test("claimOnce: of many calls at the same moment exactly one wins", opts, async () => {
  const key = `test:${randomUUID()}`;
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => claimOnce(key, 300)));
    assert.equal(results.filter(Boolean).length, 1);
  } finally {
    await forget([key]);
  }
});

test("claimOnce: a claim can be taken again once its window has passed", opts, async () => {
  const key = `test:${randomUUID()}`;
  try {
    assert.equal(await claimOnce(key, 300), true);
    // Age the row instead of waiting.
    await prisma.$executeRawUnsafe(
      `UPDATE "line_tracking"."lt_webhook_dedupe" SET seen_at = now() - interval '301 seconds' WHERE key = $1`,
      key
    );
    assert.equal(await claimOnce(key, 300), true);
    assert.equal(await claimOnce(key, 300), false);
  } finally {
    await forget([key]);
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
