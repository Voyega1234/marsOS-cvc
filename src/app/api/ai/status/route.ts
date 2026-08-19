import { NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";

import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// สถานะการเชื่อมต่อ AI จริง — ใช้ตัดสินว่าจะโชว์แบนเนอร์ "ยังไม่ได้เชื่อมต่อ" หรือไม่
export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const claude = Boolean(process.env.ANTHROPIC_API_KEY);

  let gemini = false;
  if (process.env.VERCEL) {
    // บน Vercel ใช้ OIDC (Workload Identity)
    gemini = Boolean(
      process.env.GCP_PROJECT_ID &&
      process.env.GCP_PROJECT_NUMBER &&
      process.env.GCP_SERVICE_ACCOUNT_EMAIL &&
      process.env.GCP_WORKLOAD_IDENTITY_POOL_ID &&
      process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID
    );
  } else {
    // local ใช้ ADC — ตรวจว่ามี credential file แล้วหรือยัง
    const adcPath =
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json");
    gemini = Boolean(process.env.GCP_PROJECT_ID) && fs.existsSync(adcPath);
  }

  return NextResponse.json({ claude, gemini, connected: claude || gemini });
}
