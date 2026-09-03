import { NextRequest, NextResponse } from "next/server";

import { getSession, getSessionRaw } from "@/lib/auth";

export async function POST(req: NextRequest) {
  // role CLIENT ไม่มีสิทธิ์ใน endpoint นี้ (route เดิมไม่ได้ปิดเคส session ว่าง)
  if ((await getSessionRaw())?.user?.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const session = await getSession();
  

  const { promptText, modelProvider } = await req.json();

  // Mock test response - replace with real AI call
  const mockResponses: Record<string, string> = {
    CLAUDE: `{
  "result": "Mock response from Claude API",
  "note": "Connect OPENROUTER_API_KEY to get real responses",
  "promptLength": ${promptText?.length ?? 0},
  "timestamp": "${new Date().toISOString()}"
}`,
    OPENAI: `{"result": "Mock response from OpenAI API", "model": "gpt-4o"}`,
    default: `{"result": "Mock AI response", "provider": "${modelProvider}"}`,
  };

  return NextResponse.json({ result: mockResponses[modelProvider ?? "default"] ?? mockResponses.default });
}
