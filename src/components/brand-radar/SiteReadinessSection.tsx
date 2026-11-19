"use client";

/**
 * Brand Radar — Citation Analysis: "ความพร้อมของเว็บต่อ AI". Reads GET /api/brand-radar/site-readiness (staff only).
 * Everything fetched from the website (title, description, canonical, sitemap URLs, schema types) is untrusted:
 * it is shown as React text nodes only, never as a link and never as HTML.
 */
import type { ReactNode } from "react";
import { Globe } from "lucide-react";
import { Chip, EmptyState, Panel, type ChipTone } from "@/components/ds";
import type { AiBotRow, BotPurpose, BotVerdict, SiteReadinessDTO } from "@/lib/brand-radar/site-readiness-types";
import { fmtDateTime, fmtNum } from "./shared";
import { LoadState, useApiData } from "./PromptDialogs";
import { ColumnHelp } from "./ColumnHelp";

const ISSUE_TEXT: Record<string, { tone: ChipTone; label: string; text: string }> = {
  robots_blocks_ai_search: { tone: "bad", label: "สำคัญมาก", text: "robots.txt บล็อกบอตค้นหาหรือบอตตอบคำถามของ AI (เช่น OAI-SearchBot, ChatGPT-User, Claude-SearchBot, PerplexityBot) AI จึงอาจไม่เห็นเว็บนี้ตอนตอบคำถามผู้ใช้" },
  robots_blocks_index: { tone: "bad", label: "สำคัญมาก", text: "robots.txt บล็อก Googlebot หรือ Bingbot เว็บอาจไม่ติดดัชนี ซึ่ง AI Overviews, AI Mode, Copilot และ ChatGPT search ใช้ดัชนีเหล่านี้" },
  homepage_noindex: { tone: "bad", label: "สำคัญมาก", text: "หน้าแรกมีคำสั่ง noindex เครื่องมือค้นหาจะไม่เก็บหน้านี้เข้าดัชนี" },
  robots_blocks_ai_training: { tone: "warn", label: "ควรดู", text: "robots.txt บล็อกบอตเก็บข้อมูลฝึกโมเดล (GPTBot, ClaudeBot หรือ Google-Extended) ถ้าเจ้าของเว็บตั้งใจไว้ก็ไม่ต้องแก้ แต่ความรู้เรื่องแบรนด์ในโมเดลรุ่นถัดไปอาจน้อยลง" },
  homepage_nosnippet: { tone: "warn", label: "ควรดู", text: "หน้าแรกมีคำสั่ง nosnippet หรือ max-snippet:0 ซึ่งห้ามแสดงข้อความตัวอย่างและอาจทำให้ AI ยกเนื้อหาไปตอบไม่ได้" },
  no_schema: { tone: "warn", label: "ควรดู", text: "หน้าแรกไม่มีข้อมูลโครงสร้าง (JSON-LD schema) ที่อ่านได้" },
  no_org_schema: { tone: "warn", label: "ควรดู", text: "หน้าแรกมี schema แต่ไม่มีชนิด Organization, LocalBusiness หรือ WebSite ที่บอกว่าแบรนด์คือใคร" },
  thin_without_js: { tone: "warn", label: "ควรดู", text: "หน้าแรกมีข้อความน้อยกว่า 500 ตัวอักษรเมื่อไม่รัน JavaScript บอตที่ไม่รัน JavaScript อาจเห็นหน้าเกือบว่าง" },
  no_meta_description: { tone: "warn", label: "ควรดู", text: "หน้าแรกไม่มี meta description" },
  no_canonical: { tone: "warn", label: "ควรดู", text: "หน้าแรกไม่ได้ระบุ canonical URL" },
  no_sitemap: { tone: "info", label: "ข้อมูล", text: "robots.txt ไม่ได้ระบุ Sitemap" },
  no_llms_txt: { tone: "info", label: "ข้อมูล", text: "ไม่พบไฟล์ llms.txt (ไฟล์นี้เป็นทางเลือก)" },
};

const PURPOSE_LABEL: Record<BotPurpose, string> = {
  training: "เก็บข้อมูลฝึกโมเดล",
  search: "ค้นหาเพื่อตอบ",
  user: "เปิดหน้าตามที่ผู้ใช้ขอ",
  index: "ดัชนีค้นหา",
};

const VERDICT: Record<BotVerdict, { tone: ChipTone; label: string }> = {
  allowed: { tone: "ok", label: "เข้าได้" },
  partial: { tone: "warn", label: "ถูกกันบางส่วน" },
  blocked: { tone: "bad", label: "ถูกบล็อก" },
  unknown: { tone: "muted", label: "อ่าน robots.txt ไม่ได้" },
};

const HELP = {
  bot: { what: "ชื่อบอต (user-agent) ของระบบ AI หรือเครื่องมือค้นหาที่เข้ามาอ่านเว็บ", how: "เทียบกับกฎใน robots.txt ของเว็บ: ใช้กลุ่มที่ระบุชื่อบอตนั้นก่อน ถ้าไม่มีใช้กลุ่ม * ถ้าไม่มีเลยถือว่าเข้าได้", when: "ตรวจใหม่อัตโนมัติทุก 7 วัน" },
  owner: { what: "บริษัทเจ้าของบอต", how: "กำหนดไว้ในระบบตามที่ผู้พัฒนาบอตประกาศ", when: "ค่าคงที่ ไม่เปลี่ยนตามการตรวจ" },
  purpose: { what: "บอตนี้เข้ามาอ่านเว็บเพื่ออะไร", how: "จัดกลุ่มตามที่เจ้าของบอตประกาศ: เก็บข้อมูลฝึกโมเดล, ค้นหาเพื่อตอบ, เปิดหน้าตามที่ผู้ใช้ขอ, หรือดัชนีค้นหาที่ AI ใช้ต่อ (Google ใช้กับ AI Overviews และ AI Mode, Bing ใช้กับ Copilot และ ChatGPT search)", when: "ค่าคงที่ ไม่เปลี่ยนตามการตรวจ" },
  status: { what: "บอตนี้เข้าอ่านหน้าแรกของเว็บได้หรือไม่ตาม robots.txt", how: "บล็อก = กฎห้ามเข้าทั้งเว็บ (path /) · ถูกกันบางส่วน = เข้าหน้าแรกได้แต่มีบางส่วนที่ห้าม · อ่าน robots.txt ไม่ได้ = เซิร์ฟเวอร์ของเราเปิดไฟล์ไม่ได้ จึงบอกไม่ได้ว่าบอตจริงเข้าได้หรือไม่", when: "ตรวจใหม่อัตโนมัติทุก 7 วัน" },
};

function fmtStatus(code: number | null | undefined): string {
  return code === null || code === undefined ? "-" : String(code);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-gray-800">{children}</dd>
    </div>
  );
}

function BotTable({ bots }: { bots: AiBotRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-xs text-gray-500">
            <th className="py-2 pr-3 font-medium"><ColumnHelp help={HELP.bot} align="start">บอต</ColumnHelp></th>
            <th className="py-2 pr-3 font-medium"><ColumnHelp help={HELP.owner}>เจ้าของ</ColumnHelp></th>
            <th className="py-2 pr-3 font-medium"><ColumnHelp help={HELP.purpose}>ใช้ทำอะไร</ColumnHelp></th>
            <th className="py-2 font-medium"><ColumnHelp help={HELP.status} align="end">สถานะ</ColumnHelp></th>
          </tr>
        </thead>
        <tbody>
          {bots.map((b) => {
            const v = VERDICT[b.verdict] ?? VERDICT.unknown;
            return (
              <tr key={b.bot} className="border-b border-gray-50 last:border-0">
                <td className="py-2 pr-3 font-medium text-gray-800">{b.bot}</td>
                <td className="py-2 pr-3 text-gray-600">{b.owner}</td>
                <td className="py-2 pr-3 text-gray-600">{PURPOSE_LABEL[b.purpose] ?? b.purpose}</td>
                <td className="py-2"><Chip tone={v.tone}>{v.label}</Chip></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Report({ dto }: { dto: SiteReadinessDTO }) {
  const hp = dto.homepage;
  const robotsText = dto.robots.state === "found" ? "พบไฟล์" : dto.robots.state === "missing" ? "ไม่มีไฟล์ (บอตเข้าได้ทั้งหมด)" : "อ่านไม่ได้";
  const issues = dto.issues.filter((c) => ISSUE_TEXT[c]);
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-800">ปัญหาที่พบ</h3>
        {issues.length === 0 ? (
          <Chip tone="ok" dot>ไม่พบปัญหา</Chip>
        ) : (
          <ul className="space-y-2">
            {issues.map((c) => (
              <li key={c} className="flex flex-wrap items-start gap-2 text-sm text-gray-700">
                <Chip tone={ISSUE_TEXT[c].tone}>{ISSUE_TEXT[c].label}</Chip>
                <span className="min-w-0 flex-1 break-words">{ISSUE_TEXT[c].text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-gray-800">บอต AI และเครื่องมือค้นหา</h3>
        <p className="mb-2 text-xs text-gray-500">robots.txt: {robotsText}{dto.robots.httpStatus !== null ? ` (HTTP ${dto.robots.httpStatus})` : ""}</p>
        {dto.robots.bots.length > 0 ? <BotTable bots={dto.robots.bots} /> : null}
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-gray-800">llms.txt</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={dto.llmsTxt.state === "found" ? "ok" : "muted"}>{dto.llmsTxt.state === "found" ? "มี" : dto.llmsTxt.state === "missing" ? "ไม่มี" : "อ่านไม่ได้"}</Chip>
          <span className="text-xs text-gray-500">ไฟล์นี้เป็นทางเลือก ยังไม่มีแพลตฟอร์ม AI ใดยืนยันว่านำไปใช้</span>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-800">หน้าแรก</h3>
        {hp && hp.state === "ok" ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Field label="สถานะ HTTP">{fmtStatus(hp.httpStatus)}</Field>
            <Field label="ข้อความที่เห็นโดยไม่รัน JavaScript">{fmtNum(hp.textLength)} ตัวอักษร</Field>
            <Field label="noindex">{hp.noindex ? <Chip tone="bad">มี</Chip> : <Chip tone="ok">ไม่มี</Chip>}</Field>
            <Field label="nosnippet">{hp.nosnippet ? <Chip tone="warn">มี</Chip> : <Chip tone="ok">ไม่มี</Chip>}</Field>
            <Field label="ชนิด schema ที่พบ">{hp.schemaTypes.length > 0 ? hp.schemaTypes.join(", ") : hp.hasJsonLd ? "มี JSON-LD แต่อ่านชนิดไม่ได้" : "ไม่พบ"}</Field>
            <Field label="Title">{hp.title || "-"}</Field>
            <Field label="Description">{hp.description || "-"}</Field>
            <Field label="Canonical">{hp.canonical || "-"}</Field>
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs text-gray-500">Sitemap ใน robots.txt</dt>
              <dd className="mt-0.5 text-sm text-gray-800">
                {dto.robots.sitemaps.length > 0
                  ? <ul className="space-y-0.5">{dto.robots.sitemaps.map((s, i) => <li key={i} className="break-all">{s}</li>)}</ul>
                  : "ไม่พบ"}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-gray-600">เปิดหน้าแรกไม่ได้ (HTTP {fmtStatus(hp?.httpStatus)})</p>
        )}
      </div>
    </div>
  );
}

export default function SiteReadinessSection({ projectId }: { projectId: string }) {
  const url = projectId ? `/api/brand-radar/site-readiness?projectId=${encodeURIComponent(projectId)}` : "";
  const { data, loading, error, reload } = useApiData<SiteReadinessDTO>(url, 0);
  const subtitle = data && data.status !== "no_domain"
    ? `${data.domain} · ตรวจล่าสุด ${fmtDateTime(data.checkedAt)} · ระบบตรวจใหม่เองทุก 7 วัน`
    : "ตรวจว่าบอต AI เข้าอ่านเว็บของแบรนด์ได้และเข้าใจเนื้อหาหรือไม่";
  return (
    <Panel title="ความพร้อมของเว็บต่อ AI" subtitle={subtitle}>
      {loading || error ? <LoadState loading={loading} error={error} onRetry={reload} /> : null}
      {data && !loading && !error ? (
        data.status === "no_domain" ? (
          <EmptyState icon={<Globe className="h-5 w-5" />} title="ยังไม่ได้ตั้งเว็บหลักของแบรนด์" description="ตั้งเว็บหลักของแบรนด์ได้ที่หน้าตั้งค่า (Settings) แล้วระบบจะตรวจให้เอง" />
        ) : data.status === "unreachable" ? (
          <EmptyState icon={<Globe className="h-5 w-5" />} title="เซิร์ฟเวอร์ของเราเปิดเว็บนี้ไม่ได้" description="ระบบจะลองตรวจใหม่อีกครั้งภายใน 1 ชั่วโมง" />
        ) : (
          <Report dto={data} />
        )
      ) : null}
    </Panel>
  );
}
