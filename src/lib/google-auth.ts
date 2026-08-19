import { google } from "googleapis";
import { getVercelOidcToken } from "@vercel/oidc";
import { ExternalAccountClient } from "google-auth-library";
import fs from "fs";
import path from "path";

import { prisma } from "@/lib/prisma";

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

// เมล์กลางขององค์กรที่ถือ access GSC/GA4 ของลูกค้าส่วนใหญ่
const GOOGLE_DATA_EMAIL = (process.env.GOOGLE_DATA_EMAIL || "apps@convertcake.com").toLowerCase();

type GoogleOidcConfig = {
  projectId: string;
  projectNumber: string;
  serviceAccountEmail: string;
  poolId: string;
  providerId: string;
};

function readGoogleOidcConfig(): GoogleOidcConfig | null {
  const projectId = process.env.GOOGLE_OIDC_PROJECT_ID || process.env.GCP_PROJECT_ID;
  const projectNumber = process.env.GOOGLE_OIDC_PROJECT_NUMBER || process.env.GCP_PROJECT_NUMBER;
  const serviceAccountEmail = process.env.GOOGLE_OIDC_SERVICE_ACCOUNT_EMAIL || process.env.GCP_SERVICE_ACCOUNT_EMAIL;
  const poolId = process.env.GOOGLE_OIDC_WORKLOAD_IDENTITY_POOL_ID || process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GOOGLE_OIDC_WORKLOAD_IDENTITY_POOL_PROVIDER_ID || process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;

  if (!projectId || !projectNumber || !serviceAccountEmail || !poolId || !providerId) return null;
  return { projectId, projectNumber, serviceAccountEmail, poolId, providerId };
}

function isGoogleOidcConfigured() {
  return Boolean(readGoogleOidcConfig());
}

function getOidcAuth(scopes: string[]) {
  const config = readGoogleOidcConfig();
  if (!config) throw new Error("Google OIDC env vars are not configured");
  const stsAudience = `//iam.googleapis.com/projects/${config.projectNumber}/locations/global/workloadIdentityPools/${config.poolId}/providers/${config.providerId}`;
  const oidcAudience =
    process.env.GOOGLE_OIDC_AUDIENCE ||
    process.env.GCP_AUDIENCE ||
    `https://iam.googleapis.com/projects/${config.projectNumber}/locations/global/workloadIdentityPools/${config.poolId}/providers/${config.providerId}`;

  const authClient = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience: stsAudience,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.serviceAccountEmail}:generateAccessToken`,
    scopes,
    subject_token_supplier: {
      getSubjectToken: () => getVercelOidcToken({ audience: oidcAudience }),
    },
  } as any);

  if (!authClient) throw new Error("Unable to initialize Google external account auth client");

  return new google.auth.GoogleAuth({
    authClient,
    projectId: config.projectId,
    scopes,
  } as any);
}

// ── Service Account key file — mars-seo-reporter (credentials/ ถูก gitignore) ──
// เจ้าของแค่เอา email ของ SA ไปเพิ่มใน GSC/GA4 ของเว็บลูกค้า ระบบก็ดึงข้อมูลได้เลย
const SA_KEY_PATH = process.env.GOOGLE_SA_KEY_PATH || path.join(process.cwd(), "credentials", "service-account.json");

function readServiceAccountKeyEmail(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(SA_KEY_PATH, "utf8")) as { type?: string; client_email?: string };
    return raw.type === "service_account" && raw.client_email ? raw.client_email : "";
  } catch { return ""; }
}

function getServiceAccountKeyAuth(scopes: string[]) {
  if (!readServiceAccountKeyEmail()) return null;
  return new google.auth.GoogleAuth({ keyFile: SA_KEY_PATH, scopes });
}

// ── ชั้นที่ 1: Google Data Connection (เชื่อมผ่าน /api/google-connect/start) ────
// token ของ Gmail ที่ได้ access GSC/GA4 — ใช้กับหน้า Report/Performance เท่านั้น
// *** คนละส่วนกับ login ระบบ (login = Supabase ตอน deploy) ***
// ลำดับ: เมล์กลาง apps@convertcake.com → การเชื่อมต่อล่าสุดที่ admin เชื่อมไว้
type GoogleOAuth2Client = InstanceType<typeof google.auth.OAuth2>;

async function getUserOAuthClient(): Promise<GoogleOAuth2Client | null> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    // 1) เมล์กลางขององค์กร (ถือ access GSC/GA4 ของลูกค้าส่วนใหญ่)
    let account = await prisma.account.findFirst({
      where: { provider: "google", user: { email: GOOGLE_DATA_EMAIL }, refresh_token: { not: null } },
      select: { refresh_token: true },
    });

    // 2) fallback: การเชื่อมต่อ Google Data ตัวล่าสุด (เมล์อื่นที่ admin เชื่อมไว้)
    if (!account?.refresh_token) {
      account = await prisma.account.findFirst({
        where: { provider: "google", refresh_token: { not: null } },
        select: { refresh_token: true },
        orderBy: { userId: "desc" },
      });
    }

    if (!account?.refresh_token) return null;

    // ใช้ class จาก googleapis เอง เพื่อให้ type ตรงกับ google.searchconsole/analyticsdata
    const client = new google.auth.OAuth2(clientId, clientSecret);
    client.setCredentials({ refresh_token: account.refresh_token });
    return client;
  } catch {
    return null;
  }
}

// ลำดับ auth ของหน้า Report/Morning Brief:
//   1. OAuth token ของ Gmail (เมล์กลาง apps@convertcake.com → คน login) — ใช้ได้ทั้ง local และ prod
//   2. Vercel OIDC + service account (ระบบเดิม — งาน server อัตโนมัติยังใช้ได้)
//   3. local ADC (gcloud auth application-default login)
async function getGoogleAuth(scopes: string[]) {
  const userClient = await getUserOAuthClient();
  if (userClient) return userClient;

  // Service Account key (mars-seo-reporter) — ทางหลักของหน้า Report ทั้ง local และ prod
  const saAuth = getServiceAccountKeyAuth(scopes);
  if (saAuth) return saAuth;

  if (process.env.VERCEL) {
    if (isGoogleOidcConfigured()) return getOidcAuth(scopes);
    throw new Error("Google OIDC env vars must be set (หรือ login ด้วย Google เพื่อใช้ token ส่วนตัว)");
  }
  return new google.auth.GoogleAuth({ scopes });
}

export async function getGSCAuth() {
  return getGoogleAuth([GSC_SCOPE]);
}

export async function getGA4Auth() {
  return getGoogleAuth([GA4_SCOPE]);
}

// ดึง access token เป็น string ไม่ว่า auth จะเป็นแบบไหน (OAuth2 user token / GoogleAuth)
export async function getGoogleAccessToken(
  auth: Awaited<ReturnType<typeof getGoogleAuth>>
): Promise<string | null> {
  if (auth instanceof google.auth.GoogleAuth) {
    const client = await auth.getClient();
    const t = await client.getAccessToken();
    return typeof t === "string" ? t : t?.token ?? null;
  }
  const t = await auth.getAccessToken();
  return t?.token ?? null;
}

export const SERVICE_ACCOUNT_EMAIL = (() => {
  const config = readGoogleOidcConfig();
  if (config?.serviceAccountEmail) return config.serviceAccountEmail;
  return "";
})();

/**
 * ตัวตนฝั่ง service (ไม่ใช่ OAuth ของผู้ใช้) สำหรับหน้า Report/Content Refresh:
 * เจ้าของแค่เอา email นี้ไปเพิ่มเป็นผู้ใช้ใน GSC property + GA4 แล้วระบบดึงข้อมูลได้เลย
 * คืน email จาก OIDC env → ADC service-account JSON → และเช็คว่าออก token ได้จริงมั้ย
 */
export async function getServiceIdentity(): Promise<{ email: string; ready: boolean; via: "sa_key" | "oidc" | "adc" | null }> {
  // 0) Service Account key file (mars-seo-reporter)
  const saKeyEmail = readServiceAccountKeyEmail();
  if (saKeyEmail) {
    try {
      const auth = getServiceAccountKeyAuth([GSC_SCOPE, GA4_SCOPE])!;
      const client = await auth.getClient();
      const t = await client.getAccessToken();
      return { email: saKeyEmail, ready: Boolean(typeof t === "string" ? t : t?.token), via: "sa_key" };
    } catch {
      return { email: saKeyEmail, ready: false, via: "sa_key" };
    }
  }
  // 1) OIDC service account (Vercel prod)
  if (SERVICE_ACCOUNT_EMAIL && process.env.VERCEL && isGoogleOidcConfigured()) {
    try {
      const auth = getOidcAuth([GSC_SCOPE]);
      const client = await auth.getClient();
      const t = await client.getAccessToken();
      return { email: SERVICE_ACCOUNT_EMAIL, ready: Boolean(t), via: "oidc" };
    } catch {
      return { email: SERVICE_ACCOUNT_EMAIL, ready: false, via: "oidc" };
    }
  }
  // 2) ADC (GOOGLE_APPLICATION_CREDENTIALS หรือ gcloud auth application-default)
  //    รองรับทั้ง service-account JSON (มี client_email) และ user credential
  //    (จาก gcloud login — ต้องถาม tokeninfo เอาอีเมล + เช็คว่า scope ครอบ GSC/GA4 มั้ย)
  try {
    const auth = new google.auth.GoogleAuth({ scopes: [GSC_SCOPE, GA4_SCOPE] });
    const creds = await auth.getCredentials().catch(() => null);
    const saEmail = (creds as { client_email?: string } | null)?.client_email ?? "";
    const client = await auth.getClient();
    const t = await client.getAccessToken().catch(() => null);
    const token = typeof t === "string" ? t : t?.token;
    if (!token) return { email: saEmail || SERVICE_ACCOUNT_EMAIL, ready: false, via: saEmail ? "adc" : null };
    if (saEmail) return { email: saEmail, ready: true, via: "adc" };
    // user-type ADC — ถามตัวตนและ scope จริงจาก token
    const info = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const email = (info?.email as string | undefined) ?? SERVICE_ACCOUNT_EMAIL ?? "";
    const scope = (info?.scope as string | undefined) ?? "";
    const ready = scope.includes(GSC_SCOPE) || scope.includes(GA4_SCOPE);
    return { email, ready, via: email ? "adc" : null };
  } catch {
    return { email: SERVICE_ACCOUNT_EMAIL, ready: false, via: SERVICE_ACCOUNT_EMAIL ? "oidc" : null };
  }
}
