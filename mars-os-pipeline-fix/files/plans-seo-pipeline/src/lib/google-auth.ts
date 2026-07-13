import { google } from "googleapis";
import path from "path";
import fs from "fs";

function getCredentials() {
  // Vercel / production: inline JSON in env var
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }
  // Local dev: path to JSON file
  const envPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
  if (envPath) {
    const abs = path.resolve(process.cwd(), envPath);
    if (fs.existsSync(abs)) {
      return JSON.parse(fs.readFileSync(abs, "utf-8"));
    }
  }
  throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_PATH must be set");
}

export function getGSCAuth() {
  return new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
}

export function getGA4Auth() {
  return new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
}

export const SERVICE_ACCOUNT_EMAIL = (() => {
  try { return getCredentials().client_email as string; } catch { return ""; }
})();

export async function getGeminiAccessToken(): Promise<string> {
  // Preferred on Vercel: OIDC Workload Identity Federation (no secret keys).
  // BUT if WIF is misconfigured (e.g. `invalid_grant: audience ... does not
  // match`), fall back to the service-account JSON that worked before — so
  // Image Studio / keyword expansion / article images keep working instead of
  // failing hard. Only fall back when a service account is actually available.
  if (process.env.GCP_PROJECT_NUMBER && process.env.GCP_WORKLOAD_IDENTITY_POOL_ID) {
    try {
      const { getGeminiTokenViaOidc } = await import('./vercel-gcp-auth')
      return await getGeminiTokenViaOidc()
    } catch (err) {
      const hasServiceAccount = !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_PATH)
      if (!hasServiceAccount) throw err
      console.warn('[gemini-auth] OIDC/WIF failed — falling back to service account JSON:', String(err))
    }
  }
  // Service account JSON (also the local-dev path)
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/generative-language"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("Failed to get Gemini access token from service account");
  return token.token;
}
