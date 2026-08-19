import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
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

  try {
    const results =
      mode === "volume"
        ? await fetchSearchVolume({ keywords, location: body.location, language: body.language })
        : await fetchKeywordIdeas({ seeds: keywords, location: body.location, language: body.language });
    return NextResponse.json({ mode, count: results.length, results });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
