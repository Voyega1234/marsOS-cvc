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
