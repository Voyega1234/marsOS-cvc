import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getGSCAuth } from "@/lib/google-auth";
import { google } from "googleapis";

export async function GET() {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const auth = getGSCAuth();
    const sc = google.searchconsole({ version: "v1", auth });
    const res = await sc.sites.list();
    const sites = (res.data.siteEntry ?? []).map(s => ({
      siteUrl:         s.siteUrl ?? "",
      permissionLevel: s.permissionLevel ?? "",
    }));
    return NextResponse.json({ sites });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
