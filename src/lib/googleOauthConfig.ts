/**
 * Google OAuth Client ของแอป (สำหรับปุ่ม "เชื่อมต่อ Google" หน้า Report/Content Refresh)
 *
 * ลำดับการหา: env (GOOGLE_OAUTH_CLIENT_ID/SECRET) → AppSetting ใน DB
 * ตั้งผ่าน UI ได้ครั้งเดียวทั้งระบบ — ไม่ต้องแก้ไฟล์ env
 * secret เข้ารหัสด้วย WP_ENCRYPTION_KEY ถ้ามี ไม่มีก็เก็บ plain (local dev)
 */
import { prisma } from "@/lib/prisma";

const KEY_ID = "google_oauth_client_id";
const KEY_SECRET = "google_oauth_client_secret";
const ENC_PREFIX = "enc:";

async function tryEncrypt(plain: string): Promise<string> {
  try {
    const { encrypt } = await import("@/lib/crypto");
    return ENC_PREFIX + encrypt(plain);
  } catch {
    return plain; // ไม่มี WP_ENCRYPTION_KEY (เช่น local dev) — เก็บ plain
  }
}

async function tryDecrypt(stored: string): Promise<string> {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  try {
    const { decrypt } = await import("@/lib/crypto");
    return decrypt(stored.slice(ENC_PREFIX.length));
  } catch {
    return "";
  }
}

export interface GoogleOauthClient {
  clientId: string;
  clientSecret: string;
  source: "env" | "db" | null;
}

export async function getGoogleOauthClient(): Promise<GoogleOauthClient> {
  const envId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const envSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret, source: "env" };

  const rows = await prisma.appSetting.findMany({ where: { key: { in: [KEY_ID, KEY_SECRET] } } });
  const id = rows.find((r) => r.key === KEY_ID)?.value ?? "";
  const secretRaw = rows.find((r) => r.key === KEY_SECRET)?.value ?? "";
  const secret = secretRaw ? await tryDecrypt(secretRaw) : "";
  if (id && secret) return { clientId: id, clientSecret: secret, source: "db" };
  return { clientId: "", clientSecret: "", source: null };
}

export async function saveGoogleOauthClient(clientId: string, clientSecret: string): Promise<void> {
  const encSecret = await tryEncrypt(clientSecret.trim());
  await prisma.$transaction([
    prisma.appSetting.upsert({
      where: { key: KEY_ID },
      update: { value: clientId.trim() },
      create: { key: KEY_ID, value: clientId.trim() },
    }),
    prisma.appSetting.upsert({
      where: { key: KEY_SECRET },
      update: { value: encSecret },
      create: { key: KEY_SECRET, value: encSecret },
    }),
  ]);
}

export async function clearGoogleOauthClient(): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: { in: [KEY_ID, KEY_SECRET] } } });
}
