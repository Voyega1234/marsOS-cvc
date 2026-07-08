import { google } from "googleapis";
import { getVercelOidcToken } from "@vercel/oidc";
import { ExternalAccountClient } from "google-auth-library";
import path from "path";
import fs from "fs";

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

type GoogleOidcConfig = {
  projectId: string;
  projectNumber: string;
  serviceAccountEmail: string;
  poolId: string;
  providerId: string;
};

function readGoogleOidcConfig(): GoogleOidcConfig | null {
  const projectId = process.env.GOOGLE_OIDC_PROJECT_ID;
  const projectNumber = process.env.GOOGLE_OIDC_PROJECT_NUMBER;
  const serviceAccountEmail = process.env.GOOGLE_OIDC_SERVICE_ACCOUNT_EMAIL;
  const poolId = process.env.GOOGLE_OIDC_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GOOGLE_OIDC_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;

  if (!projectId || !projectNumber || !serviceAccountEmail || !poolId || !providerId) return null;
  return { projectId, projectNumber, serviceAccountEmail, poolId, providerId };
}

function isGoogleOidcConfigured() {
  return Boolean(readGoogleOidcConfig());
}

function getOidcAuth(scopes: string[]) {
  const config = readGoogleOidcConfig();
  if (!config) throw new Error("Google OIDC env vars are not configured");
  const audience = `//iam.googleapis.com/projects/${config.projectNumber}/locations/global/workloadIdentityPools/${config.poolId}/providers/${config.providerId}`;

  const authClient = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.serviceAccountEmail}:generateAccessToken`,
    scopes,
    subject_token_supplier: {
      getSubjectToken: () => getVercelOidcToken(),
    },
  } as any);

  if (!authClient) throw new Error("Unable to initialize Google external account auth client");

  return new google.auth.GoogleAuth({
    authClient,
    projectId: config.projectId,
    scopes,
  } as any);
}

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
  return null;
}

function getJsonAuth(scopes: string[]) {
  const credentials = getCredentials();
  if (!credentials) return null;

  return new google.auth.GoogleAuth({
    credentials,
    scopes,
  });
}

export function getGSCAuth() {
  const jsonAuth = getJsonAuth([GSC_SCOPE]);
  if (jsonAuth) return jsonAuth;

  if (isGoogleOidcConfigured()) return getOidcAuth([GSC_SCOPE]);
  throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON/GOOGLE_SERVICE_ACCOUNT_PATH or Google OIDC env vars must be set");
}

export function getGA4Auth() {
  if (isGoogleOidcConfigured()) return getOidcAuth([GA4_SCOPE]);

  const jsonAuth = getJsonAuth([GA4_SCOPE]);
  if (jsonAuth) return jsonAuth;
  throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON/GOOGLE_SERVICE_ACCOUNT_PATH or Google OIDC env vars must be set");
}

export const SERVICE_ACCOUNT_EMAIL = (() => {
  const credentials = getCredentials();
  if (credentials?.client_email) return credentials.client_email as string;

  const config = readGoogleOidcConfig();
  if (config?.serviceAccountEmail) return config.serviceAccountEmail;
  return "";
})();
