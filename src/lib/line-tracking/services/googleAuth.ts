import { createSign } from "crypto";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/**
 * Mint a Google OAuth2 access token from a service-account JSON using a signed
 * JWT (RS256) — implemented with node crypto so we pull in no external SDK.
 * Used by the REAL Google Sheet sync path.
 */
export async function getGoogleAccessToken(
  serviceAccountJson: string,
  scope: string
): Promise<string> {
  const sa = JSON.parse(serviceAccountJson) as ServiceAccount;
  if (!sa.client_email || !sa.private_key) {
    throw new Error("Service account JSON ต้องมี client_email และ private_key");
  }

  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${enc(header)}.${enc(claim)}`;

  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(sa.private_key.replace(/\\n/g, "\n"), "base64url");

  const assertion = `${unsigned}.${signature}`;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("No access_token returned from Google");
  return json.access_token;
}

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
