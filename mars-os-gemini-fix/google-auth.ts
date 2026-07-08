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
  // On Vercel: use OIDC Workload Identity Federation (no secret keys needed)
  if (process.env.GCP_PROJECT_NUMBER && process.env.GCP_WORKLOAD_IDENTITY_POOL_ID) {
    const { getGeminiTokenViaOidc } = await import('./vercel-gcp-auth')
    return getGeminiTokenViaOidc()
  }
  // Local dev fallback: service account JSON
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/generative-language"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("Failed to get Gemini access token from service account");
  return token.token;
}
