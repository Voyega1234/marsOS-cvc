import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { logAIJob } from "@/lib/logAIJob";
import {
  isDataForSeoConfigured,
  fetchKeywordIdeas,
  fetchSearchVolume,
} from "@/lib/dataforseo";

export const maxDuration = 60;

// GET → สถานะการเชื่อมต่อ (ให้หน้า Keyword Research โชว์ตรงๆ ว่าพร้อมหรือยัง)
export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ configured: isDataForSeoConfigured() });
}

// POST → ดึงข้อมูลจริงจาก DataForSEO
// mode "ideas":  ขยาย keyword จาก seeds + volume จริง
// mode "volume": เติม volume จริงให้ list ที่มีอยู่ (เช่นผลจาก AI)
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "CLIENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!isDataForSeoConfigured()) {
    return NextResponse.json(
      { error: "DATAFORSEO_NOT_CONFIGURED", message: "ใส่ DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD ใน .env ก่อนใช้งาน" },
      { status: 503 }
    );
  }

  const body = await req.json();
  const mode: string = body.mode ?? "ideas";
  const keywords: string[] = (Array.isArray(body.keywords) ? body.keywords : [])
    .map((k: unknown) => String(k).trim())
    .filter(Boolean);

  if (!keywords.length) return NextResponse.json({ error: "keywords is required" }, { status: 400 });

  const orgId = session.user.organizationId ?? null;
  const userId = session.user.id ?? null;
  const modelName =
    mode === "volume"
      ? "/keywords_data/google_ads/search_volume/live"
      : "/keywords_data/google_ads/keywords_for_keywords/live";
  // Cost DataForSEO reports for the call (USD); logged on success and failure
  let reportedCost = 0;
  const onCost = (usd: number) => {
    reportedCost += usd;
  };
  const logCost = (status: "SUCCESS" | "FAILED", errorMessage?: string) => {
    if (!orgId || !userId) return;
    logAIJob({
      organizationId: orgId,
      createdById: userId,
      projectId: null,
      jobType: mode === "volume" ? "DFS_VOLUME_LOOKUP" : "KEYWORD_DFS_IDEAS",
      modelProvider: "DATAFORSEO",
      modelName,
      status,
      externalCost: reportedCost,
      externalCalls: 1,
      externalApi: "DataForSEO",
      inputSummary: `${keywords.length} keywords`,
      errorMessage,
    }).catch(() => {});
  };

  try {
    const results =
      mode === "volume"
        ? await fetchSearchVolume({ keywords, location: body.location, language: body.language, onCost })
        : await fetchKeywordIdeas({ seeds: keywords, location: body.location, language: body.language, onCost });
    logCost("SUCCESS");
    return NextResponse.json({ mode, count: results.length, results });
  } catch (err) {
    logCost("FAILED", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
