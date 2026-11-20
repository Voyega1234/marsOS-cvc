import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getTrackingBaseUrl } from "./trackingService";

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no confusing chars

function genCode(len = 6): string {
  const bytes = randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

/** Create a short link (/s/{code}) that redirects to targetUrl. */
export async function createShortLink(projectId: string, name: string, targetUrl: string) {
  let code = genCode();
  // retry on the rare collision
  for (let i = 0; i < 5; i++) {
    const exists = await prisma.shortLink.findUnique({ where: { code } });
    if (!exists) break;
    code = genCode();
  }
  return prisma.shortLink.create({ data: { projectId, code, name, targetUrl } });
}

export function listShortLinks(projectId: string) {
  return prisma.shortLink.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
}

export function shortUrl(code: string): string {
  return `${getTrackingBaseUrl()}/s/${code}`;
}
