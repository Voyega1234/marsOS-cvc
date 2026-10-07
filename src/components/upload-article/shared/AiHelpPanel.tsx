"use client";

/** กล่องผลลัพธ์ "AI ช่วยดูว่าผิดตรงไหน" + ฟังก์ชันเรียก connect-help (ไม่ส่ง secret — ฝั่งเซิร์ฟเวอร์ตัดซ้ำอีกชั้น) */
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";

export type AiHelp = { cause: string; steps: string[]; checkAgain: string };

export async function requestConnectHelp(
  clientId: string,
  payload: { context: "connect" | "push"; platform?: string; error: string; filled?: Record<string, boolean>; articleTitle?: string },
): Promise<AiHelp> {
  const r = await fetch(`/api/upload-article/clients/${clientId}/connect-help`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || "AI ช่วยไม่ได้ตอนนี้");
  return { cause: d.cause || "", steps: Array.isArray(d.steps) ? d.steps : [], checkAgain: d.checkAgain || "" };
}

export default function AiHelpPanel({ help }: { help: AiHelp }) {
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs text-violet-900 space-y-1.5">
      <p className="font-semibold flex items-center gap-1.5"><Sparkles size={13} /> AI ช่วยดูให้</p>
      {help.cause && <p>{help.cause}</p>}
      {help.steps.length > 0 && (
        <ol className="list-decimal pl-4 space-y-0.5">
          {help.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      )}
      {help.checkAgain && <p className="text-violet-700">แก้แล้วให้: {help.checkAgain}</p>}
    </div>
  );
}

/** ปุ่มเล็ก "AI ช่วยอ่าน error" + ผลลัพธ์ inline — ใช้ใต้ error ของแต่ละแถว */
export function AiHelpInline({
  clientId, platform, error, articleTitle, context = "push",
}: { clientId: string; platform?: string; error: string; articleTitle?: string; context?: "connect" | "push" }) {
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState<AiHelp | null>(null);
  async function run() {
    setBusy(true);
    try {
      setHelp(await requestConnectHelp(clientId, { context, platform, error, articleTitle }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI ช่วยไม่ได้ตอนนี้");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-1.5">
      <button type="button" onClick={run} disabled={busy}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-600 hover:underline disabled:opacity-50">
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} AI ช่วยอ่าน error
      </button>
      {help && <AiHelpPanel help={help} />}
    </div>
  );
}
