"use client";

/**
 * คู่มือ "วิธีเอาค่ามาใส่" ของแต่ละแพลตฟอร์ม — แสดงข้างฟอร์ม Connect (สลับตามปุ่มแพลตฟอร์มที่เลือก)
 * ต่อฟิลด์: ไปเอาที่ไหน (ทีละขั้น) / ทำไมต้องใช้ / ปัญหาที่เจอบ่อย
 */
import { BookOpen, ExternalLink } from "lucide-react";
import { UPLOAD_PLATFORM_LABEL, type UploadPlatformId } from "@/lib/upload-article/platform-info";
import { CONNECT_GUIDE, resolveGuideLink, type ConnectGuideCtx } from "@/lib/upload-article/connect-guide";

export default function ConnectHowTo({ platform, ctx = {} }: { platform: UploadPlatformId; ctx?: ConnectGuideCtx }) {
  const items = CONNECT_GUIDE[platform];
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <p className="text-sm font-semibold text-brand-navy flex items-center gap-1.5">
        <BookOpen size={14} className="text-brand-blue" /> วิธีเอาค่ามาใส่ — {UPLOAD_PLATFORM_LABEL[platform]}
      </p>
      <div className="space-y-2 max-h-[calc(100vh-8rem)] overflow-y-auto pr-1">
        {items.map(it => (
          <details key={`${platform}-${it.field}`} open className="group rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-brand-navy select-none">{it.field}</summary>
            <div className="mt-2 space-y-2 text-xs text-gray-600">
              <div>
                <p className="font-semibold text-gray-700 mb-0.5">ไปเอาที่ไหน</p>
                <ol className="list-decimal pl-4 space-y-0.5">
                  {it.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
              {(() => {
                const links = (it.links ?? []).map(l => ({ label: l.label, href: resolveGuideLink(l, ctx) })).filter((l): l is { label: string; href: string } => !!l.href);
                return links.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {links.map(l => (
                      <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-brand-blue/30 bg-white px-2 py-1 text-[11px] font-medium text-brand-blue hover:bg-brand-blue/5">
                        {l.label} <ExternalLink size={11} />
                      </a>
                    ))}
                  </div>
                );
              })()}
              {it.code && (
                <pre className="bg-white border border-gray-200 rounded-md p-2 text-[10px] leading-snug font-mono text-gray-700 overflow-x-auto whitespace-pre">{it.code}</pre>
              )}
              <div>
                <p className="font-semibold text-gray-700 mb-0.5">ใช้ทำอะไร</p>
                <p>{it.why}</p>
              </div>
              {it.problems && it.problems.length > 0 && (
                <div>
                  <p className="font-semibold text-amber-700 mb-0.5">ปัญหาที่เจอบ่อย</p>
                  <ul className="list-disc pl-4 space-y-0.5 text-amber-800">
                    {it.problems.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
