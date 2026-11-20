import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * Bearer-token guard for the Looker Studio feed.
 *
 * Looker pulls these routes from Google's servers, so there is no session cookie to
 * check — the token IS the identity. Three rules keep that safe:
 *
 *  1. Only the sha256 of the token is stored. A dump of lt_project cannot be replayed.
 *  2. The projectId is derived FROM the token, never from the path or query string.
 *     There is therefore no parameter an attacker can tamper with to read another
 *     project: holding project A's token can only ever return project A's rows.
 *  3. It fails CLOSED with no development bypass. Unlike the cron guard (which is only
 *     protecting a job trigger), this feed hands out lead-level data, so "no token
 *     configured" must mean "refuse", in every environment.
 */

const TOKEN_PREFIX = "ltk_";

export function hashLookerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Generate a fresh token. Returned in plaintext ONCE — only the hash is persisted. */
export function generateLookerToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

/**
 * Mint (or re-mint) a project's token and return the plaintext exactly once.
 * Rotating simply overwrites the hash, which instantly invalidates the old token.
 */
export async function rotateLookerToken(projectId: string): Promise<string> {
  const token = generateLookerToken();
  await prisma.ltProject.update({
    where: { id: projectId },
    data: { lookerTokenHash: hashLookerToken(token), lookerTokenSetAt: new Date() },
  });
  return token;
}

/** Revoke without issuing a replacement. Any existing Looker data source breaks. */
export async function revokeLookerToken(projectId: string): Promise<void> {
  await prisma.ltProject.update({
    where: { id: projectId },
    data: { lookerTokenHash: null, lookerTokenSetAt: null },
  });
}

function readBearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;
  // Looker's community connector sends the header; the query form exists only so an
  // owner can smoke-test the feed from a browser tab.
  const fromQuery = new URL(req.url).searchParams.get("token");
  return fromQuery?.trim() || null;
}

export interface LookerProject {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  lookerIncludePii: boolean;
}

export type LookerAuthResult =
  | { ok: true; project: LookerProject }
  | { ok: false; status: 401 | 403; error: string };

export async function authorizeLookerRequest(req: Request): Promise<LookerAuthResult> {
  const token = readBearer(req);
  if (!token) {
    return { ok: false, status: 401, error: "Missing token. Send Authorization: Bearer ltk_..." };
  }

  const project = await prisma.ltProject.findUnique({
    where: { lookerTokenHash: hashLookerToken(token) },
    select: {
      id: true,
      name: true,
      currency: true,
      timezone: true,
      lookerIncludePii: true,
      status: true,
    },
  });

  // Unknown hash — wrong token, or one that has since been rotated/revoked.
  if (!project) return { ok: false, status: 401, error: "Invalid or revoked token" };

  // A paused project is paused everywhere, including here. Reported separately from a
  // bad token so the owner can tell "I broke the token" from "I paused the project".
  if (project.status === "PAUSED") {
    return { ok: false, status: 403, error: "Project is paused" };
  }

  const { status: _status, ...rest } = project;
  return { ok: true, project: rest };
}
