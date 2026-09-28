"use client";

/**
 * ตัวอย่างกล่องผู้เขียนตามสไตล์ที่เลือก — ใช้ buildAuthorCardHtml/Css ตัวเดียวกับตอนเขียนบทความจริง
 * render ใน iframe (ไม่มี script) กัน CSS ของบทความรั่วมาปนหน้า setting
 */
import { useMemo, useRef, useState } from "react";
import { buildAuthorCardCss, buildAuthorCardHtml, type AuthorCardStyle } from "@/lib/articleAuthorCard";
import type { AuthorProfile } from "@/lib/upload-article/author";

// สีตัวอย่าง — บทความจริงใช้สีธีมของเว็บ
const SAMPLE_COLORS = { theme: "#1e3a8a", text: "#334155", border: "#cbd5e1", accent: "#1e3a8a" };

const SAMPLE_AVATAR =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='#e2e8f0'/>` +
      `<circle cx='50' cy='38' r='18' fill='#94a3b8'/><path d='M18 92c4-20 18-30 32-30s28 10 32 30z' fill='#94a3b8'/></svg>`,
  );

export function AuthorCardPreview({ style, author }: { style: AuthorCardStyle; author?: AuthorProfile }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(220);

  const doc = useMemo(() => {
    const hasData = !!(author?.name?.trim() || author?.title?.trim());
    const html = buildAuthorCardHtml({
      style,
      name: hasData ? author!.name : "สมชาย ใจดี",
      title: hasData ? author!.title : "ผู้เชี่ยวชาญด้านอสังหาริมทรัพย์",
      image: author?.image || SAMPLE_AVATAR,
      credentials: hasData ? author!.credentials : ["ประสบการณ์ 10 ปีในวงการอสังหาฯ", "ที่ปรึกษาการลงทุนคอนโดกรุงเทพฯ"],
    });
    const css = buildAuthorCardCss(SAMPLE_COLORS).join("\n");
    return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#f8fafc;}
body{padding:16px;font-family:"IBM Plex Sans Thai","Noto Sans Thai",sans-serif;font-size:15px;color:${SAMPLE_COLORS.text};}
${css}
.content-article .content-author{margin-top:0;}
</style></head><body><div class="content-article">${html}</div></body></html>`;
  }, [style, author]);

  function fit() {
    const body = ref.current?.contentDocument?.body;
    if (body) setHeight(Math.max(80, body.scrollHeight));
  }

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <p className="text-[11px] text-gray-400 px-3 py-1.5 bg-white border-b border-gray-100">
        ตัวอย่างท้ายบทความ{author?.name?.trim() ? "" : " (ข้อมูลสมมติ — เพิ่มผู้เขียนแล้วจะเห็นข้อมูลจริง)"} · สีจริงตามธีมของเว็บ
      </p>
      <iframe
        ref={ref}
        title="ตัวอย่าง Author Box"
        srcDoc={doc}
        sandbox="allow-same-origin"
        onLoad={fit}
        style={{ height }}
        className="w-full block border-0"
      />
    </div>
  );
}
