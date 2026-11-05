"use client";

/**
 * สรุปสั้น ๆ ว่าสแกนเจออะไรจากบทความจริง (ฟอนต์/สี/กล่อง/โครงบทความ/อ้างอิง)
 * ใช้ร่วมใน SiteScanView (Upload + SME/SEO) — แสดงเฉพาะที่อ่านมาได้ ที่ไม่พบเขียนว่า "ไม่พบข้อมูล"
 */
import { articleFontStacks, fontCoverage } from "@/lib/upload-article/font-faces";
import type { UploadArticleStyle, UploadTextStyle, UploadThemeDetail } from "@/lib/upload-article/types";

const NONE = "ไม่พบข้อมูล";

function firstFamily(f?: string): string {
  if (!f) return "";
  return f.split(",")[0].trim().replace(/^["']|["']$/g, "");
}

function Swatch({ label, value }: { label: string; value?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 mr-3">
      <span className="text-gray-500">{label}:</span>
      {value ? (
        <>
          <span aria-hidden className="inline-block w-3.5 h-3.5 rounded border border-gray-300 shrink-0" style={{ background: value }} />
          <span className="font-mono text-[11px]">{value}</span>
        </>
      ) : <span className="text-gray-400">{NONE}</span>}
    </span>
  );
}

function FontRow({ label, t }: { label: string; t?: UploadTextStyle }) {
  const fam = firstFamily(t?.fontFamily);
  const rest = [t?.fontSize, t?.fontWeight ? `น้ำหนัก ${t.fontWeight}` : ""].filter(Boolean).join(" · ");
  return (
    <li>
      <span className="text-gray-500">{label}:</span>{" "}
      {fam || rest
        ? <><b title={t?.fontFamily}>{fam || "ไม่ระบุฟอนต์"}</b>{rest && <span className="text-gray-600"> · {rest}</span>}</>
        : <span className="text-gray-400">{NONE}</span>}
    </li>
  );
}

/** สรุปฟอนต์บรรทัดเดียว รายละเอียดและช่องวางลิงก์อยู่ในส่วนฟอนต์ของบทความด้านล่าง */
function FontFiles({ article }: { article: UploadArticleStyle }) {
  const rows = fontCoverage(articleFontStacks(article), article.fontFaces);
  if (!rows.length) return null;
  const missing = rows.filter((r) => r.status === "missing").map((r) => r.family);
  if (!missing.length) return <p className="mt-1.5 text-emerald-700">มีไฟล์ฟอนต์ครบ {rows.length} ตัว พรีวิวตรงกับเว็บ</p>;
  return (
    <p className="mt-1.5 text-amber-700">
      ไม่พบไฟล์ {missing.join(", ")} บนเว็บจริงแสดงถูก แต่พรีวิวใช้ตัวสำรอง กด ใช้กับบทความ แล้ววางลิงก์ไฟล์ได้
    </p>
  );
}

function yesNo(v: boolean | undefined, yes: string, no: string): string {
  return v === undefined ? NONE : v ? yes : no;
}

export default function ScannedStyleSummary({ detail }: { detail: UploadThemeDetail }) {
  const a = detail.article;
  const s = detail.structure;
  const refCount = detail.references?.length ?? 0;
  const source = a?.source && /^https?:\/\//i.test(a.source) ? a.source : "";
  return (
    <div className="rounded-lg border border-brand-blue/20 bg-white p-3 space-y-2.5">
      <p className="font-semibold text-brand-navy">สิ่งที่สแกนเจอจากบทความจริง</p>

      {a && (
        <>
          <div>
            <p className="text-[11px] font-semibold text-gray-500 mb-0.5">ฟอนต์</p>
            <ul className="space-y-0.5">
              <FontRow label="หัวข้อ H2" t={a.h2} />
              <FontRow label="หัวข้อ H3" t={a.h3} />
              <FontRow label="เนื้อหา" t={a.p} />
            </ul>
            <FontFiles article={a} />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-gray-500 mb-0.5">สี</p>
            <div className="flex flex-wrap gap-y-1">
              <Swatch label="เนื้อหา" value={a.p?.color} />
              <Swatch label="H2" value={a.h2?.color} />
              <Swatch label="H3" value={a.h3?.color} />
              <Swatch label="ลิงก์" value={a.link?.color} />
              <Swatch label="จุดนำหน้ารายการ" value={a.li?.markerColor} />
            </div>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-gray-500 mb-0.5">กล่องเนื้อหา</p>
            <div className="flex flex-wrap gap-y-1">
              <span className="mr-3"><span className="text-gray-500">ความกว้าง:</span> {a.container?.width || NONE}</span>
              <Swatch label="พื้นกล่อง" value={a.container?.background} />
              <Swatch label="พื้นหน้าเว็บ" value={a.pageBackground} />
            </div>
          </div>
        </>
      )}

      {s && (
        <div>
          <p className="text-[11px] font-semibold text-gray-500 mb-0.5">โครงบทความ</p>
          <ul className="space-y-0.5">
            <li><span className="text-gray-500">สารบัญ:</span> {yesNo(s.toc, "มี", "ไม่มี")}</li>
            <li><span className="text-gray-500">กล่องสรุป:</span> {yesNo(s.takeaways, "มี", "ไม่มี")}</li>
            <li><span className="text-gray-500">FAQ แบบเปิดตลอด:</span> {yesNo(s.faqPlain, "ใช่ (ไม่มีกรอบ)", "ไม่ใช่")}</li>
            <li><span className="text-gray-500">สรุปก่อน FAQ:</span> {yesNo(s.conclusionBeforeFaq, "ใช่", "ไม่ใช่")}</li>
            <li>
              <span className="text-gray-500">อ้างอิง:</span>{" "}
              {s.references === undefined && !refCount ? NONE : (
                <>
                  {s.references === undefined ? "" : s.references ? "มีหัวข้ออ้างอิง" : "ไม่มีหัวข้ออ้างอิง"}
                  {refCount > 0 && <span> · {refCount} รายการ</span>}
                  {s.referencesTitle && <span> · หัวข้อ “{s.referencesTitle}”</span>}
                </>
              )}
            </li>
            <li><span className="text-gray-500">จำนวนบทความที่ดู:</span> {s.posts ?? NONE}</li>
          </ul>
        </div>
      )}
      {!s && !!refCount && (
        <p><span className="text-gray-500">อ้างอิง:</span> {refCount} รายการ</p>
      )}

      {source && (
        <p className="text-[11px] text-gray-500 break-all">
          วัดจาก: <a href={source} target="_blank" rel="noreferrer" className="text-brand-blue underline">{source}</a>
        </p>
      )}
    </div>
  );
}
