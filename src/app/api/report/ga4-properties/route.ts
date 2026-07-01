import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getGA4Auth } from "@/lib/google-auth";

export async function GET() {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const auth = getGA4Auth();
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("No token");

    const r = await fetch(
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=50",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!r.ok) {
      const e = await r.json() as { error?: { message?: string } };
      throw new Error(e.error?.message ?? `HTTP ${r.status}`);
    }
    type PropSummary = { property: string; displayName: string };
    type AccSummary  = { name: string; displayName: string; propertySummaries?: PropSummary[] };
    const data = await r.json() as { accountSummaries?: AccSummary[] };
    const properties: { propertyId: string; displayName: string; accountName: string }[] = [];
    for (const acc of data.accountSummaries ?? []) {
      for (const prop of acc.propertySummaries ?? []) {
        const propertyId = prop.property.replace("properties/", "");
        properties.push({ propertyId, displayName: prop.displayName, accountName: acc.displayName });
      }
    }
    return NextResponse.json({ properties });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
