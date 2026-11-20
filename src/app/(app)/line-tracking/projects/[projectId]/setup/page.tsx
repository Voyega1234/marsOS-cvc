import Link from "next/link";
import { PageHeader } from "@/components/ds";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { setupProgress } from "@/lib/line-tracking/services/projectService";
import { getProjectReadiness } from "@/lib/line-tracking/services/readinessService";
import { syncRulePlatforms } from "@/lib/line-tracking/services/conversionRuleService";
import { getAuthSession } from "@/lib/session";
import { isLineTrackingAdmin } from "@/lib/line-tracking/access";
import { ConnectionCard } from "@/components/line-tracking/ConnectionCard";
import { CollapsibleCard } from "@/components/line-tracking/CollapsibleCard";
import { CopyButton } from "@/components/line-tracking/CopyButton";
import { DeleteProjectCard } from "@/components/line-tracking/DeleteProjectCard";
import { Progress, StatusBadge } from "@/components/line-tracking/ui";
import { setProjectStatusAction, testEmbedAction } from "@/lib/line-tracking/actions";
import { LookerConnectCard } from "@/components/line-tracking/LookerConnectCard";
import { EmbedTestButton } from "@/components/line-tracking/EmbedTestButton";
import { LOOKER_ACCOUNT_COOKIE } from "@/components/line-tracking/LookerAccountField";
import { buildTrackingUrl, getTrackingBaseUrl } from "@/lib/line-tracking/services/trackingService";
import { fmtDate } from "@/lib/line-tracking/format";
import type { ConnectionType } from "@/lib/line-tracking/enums";
import { AD_CONNECTION_TYPES } from "@/lib/line-tracking/enums";
import { guardProjectPage } from "@/lib/line-tracking/pageGuard";

export const dynamic = "force-dynamic";

const STEPS = [
  { key: "info", label: "Project Info" },
  { key: "line", label: "Connect LINE OA" },
  { key: "sheet", label: "Connect Google Sheet" },
  { key: "ga4", label: "Connect GA4" },
  { key: "ads", label: "Connect Ads Platforms" },
  { key: "conversions", label: "Conversion Mapping" },
  { key: "links", label: "Tracking Links" },
  { key: "looker", label: "Looker Studio" },
  { key: "golive", label: "Test & Go Live" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

function conn(connections: { type: string }[], type: ConnectionType) {
  return connections.find((c) => c.type === type) as never;
}

export default async function SetupWizard({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ step?: string; embedTest?: string; lookerToken?: string }>;
}) {
  const { projectId } = await params;
  await guardProjectPage(projectId, { clientAllowed: false });
  const query = await searchParams;
  // หน้านี้คือที่ที่ทีมกดเชื่อมต่อแพลตฟอร์มโฆษณา — ไล่อัปเกรดค่าเริ่มต้นของรูลให้ตรงรุ่น
  // ปัจจุบันตรงนี้ด้วย ไม่งั้นเชื่อม Meta ผ่านแล้วแต่รูลเก่ายังปิด "คนทัก" อยู่ ก็จะไม่มี
  // event ไหลออกไปเลยจนกว่าจะมีคนบังเอิญเปิดหน้า Conversion Mapping (ครั้งเดียวต่อรูล)
  await syncRulePlatforms(projectId);
  // One round-trip wave instead of two. The project row used to be awaited on its own
  // before this batch could even start, but nothing in the batch needs it — every query
  // keys off `projectId` straight from the URL, and `project.id` is that same value.
  const [project, readiness, staffSession, embedClicks, leadCount, webhookLogs] = await Promise.all([
    prisma.ltProject.findUnique({
      where: { id: projectId },
      include: { connections: true },
    }),
    getProjectReadiness(projectId),
    getAuthSession(),
    prisma.adClick.count({ where: { projectId } }),
    prisma.lead.count({ where: { projectId } }),
    // 10 webhook ล่าสุดที่ LINE ยิงเข้ามา — ให้ผู้ใช้เช็คเองได้ว่า LINE ต่อถึงระบบไหม
    // โดยไม่ต้องพึ่ง dev เปิด Vercel logs. ระบบเขียน row นี้ทุกครั้งที่ webhook ถูกเรียก.
    prisma.webhookLog.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, source: true, status: true, errorMessage: true, createdAt: true, payload: true },
    }),
  ]);
  if (!project) notFound();

  const step = (STEPS.find((s) => s.key === query.step)?.key ?? "info") as StepKey;
  const progress = setupProgress(project.connections);
  const notReady = readiness.filter((r) => !r.ready);
  const canManage = isLineTrackingAdmin(staffSession?.user?.role);
  // Google account the Looker links open in: the user's own pick (cookie) beats their MarsOS login.
  const lookerAccountEmail =
    (await cookies()).get(LOOKER_ACCOUNT_COOKIE)?.value?.trim() || staffSession?.user?.email || "";
  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const base = `/line-tracking/projects/${project.id}/setup`;

  // ── Onboarding gate: embed code + LINE OA มาก่อน, media channel ทำทีหลังได้ ──
  // "embedInstalled" ตรวจจากทราฟฟิกจริง — มี AdClick เข้ามา = โค้ดวางบนเว็บและยิงถึง /api/track แล้ว
  // (ไม่ต้องเพิ่มคอลัมน์ใน DB / ไม่ต้อง migrate). แต่ละโปรเจกต์ใช้ snippet เดียวกัน ต่างแค่ data-project=slug
  const lineReady = project.connections.find((c) => c.type === "LINE")?.status === "CONNECTED";
  const embedInstalled = embedClicks > 0;
  const embedSnippet = `<script src="${getTrackingBaseUrl()}/embed.js?project=${project.slug}"></script>`;
  const mediaTypes: ConnectionType[] = [...AD_CONNECTION_TYPES, "GA4", "GOOGLE_SHEET"];
  const mediaConnected = project.connections.filter(
    (c) => mediaTypes.includes(c.type as ConnectionType) && c.status === "CONNECTED"
  ).length;
  const requiredDone = (embedInstalled ? 1 : 0) + (lineReady ? 1 : 0);

  // Verdict from the step-1 "Test" button (?embedTest=…). Checks the live site for
  // the snippet — separate from embedInstalled, which only flips on real traffic.
  const EMBED_TEST_RESULT: Record<string, { tone: string; text: string }> = {
    ok: {
      tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
      text: `✅ เจอโค้ด Tracking บนเว็บแล้ว และผูกกับโปรเจกต์นี้ถูกต้อง — เหลือแค่เปิดเว็บผ่านลิงก์ที่มี ?utm_source=… สักครั้ง เพื่อให้ระบบบันทึก click แรก`,
    },
    // Real clicks recorded but the tag is invisible in server-rendered HTML —
    // normal for GTM / JS-injected installs. Without this verdict the page showed
    // "✅ ตรวจพบ click จริง" and "❌ ไม่พบโค้ด" side by side about the same install.
    oktraffic: {
      tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
      text: "✅ โค้ด Tracking ทำงานอยู่จริง — ระบบได้รับ click จากเว็บนี้แล้ว (ดูตัวเลขด้านบน) แค่ตัวสแกนมองไม่เห็น tag ใน HTML เพราะเว็บติดตั้งผ่าน Google Tag Manager หรือ inject ด้วย JavaScript ซึ่งเป็นเรื่องปกติ ไม่ต้องแก้อะไร",
    },
    // Snippet found inside the site's published GTM container — the state right
    // after a correct GTM install, before any tracked click exists.
    okgtm: {
      tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
      text: "✅ เจอโค้ด Tracking ในตัว GTM ของเว็บแล้ว และผูกกับโปรเจกต์นี้ถูกต้อง — tag จะยิงเมื่อหน้าเว็บโหลด เหลือแค่เปิดเว็บผ่านลิงก์ที่มี ?utm_source=… สักครั้ง เพื่อให้ระบบบันทึก click แรก",
    },
    gtmnotag: {
      tone: "border-amber-200 bg-amber-50 text-amber-700",
      text: "⚠️ เว็บนี้ใช้ GTM แต่ยังไม่เจอโค้ด Tracking ใน container ที่เผยแพร่ — ถ้าเพิ่ม tag ใน GTM แล้ว อย่าลืมกด Submit → Publish (สาเหตุอันดับ 1) หรือยังไม่ได้เพิ่ม Custom HTML tag เลย",
    },
    wrongslug: {
      tone: "border-amber-200 bg-amber-50 text-amber-700",
      text: `⚠️ เจอโค้ดบนเว็บ แต่ project ไม่ตรงกับโปรเจกต์นี้ (ต้องเป็น "${project.slug}") — แก้ให้ตรงแล้วกด Test ใหม่`,
    },
    missing: {
      tone: "border-rose-200 bg-rose-50 text-rose-700",
      text: "❌ เปิดเว็บได้ แต่ไม่พบโค้ด Tracking — ยังไม่ได้วาง, วางผิดหน้า (ต้องอยู่ทุกหน้า/หน้าแรก), หรือยังไม่ได้ publish เว็บ (ถ้าติดตั้งผ่าน GTM: ตัวสแกนจะมองไม่เห็น — ให้เปิดเว็บผ่านลิงก์ที่มี ?utm_source=… หนึ่งครั้งแล้วกด Test ใหม่ ระบบจะเช็คจาก click จริงแทน)",
    },
    unreachable: {
      tone: "border-amber-200 bg-amber-50 text-amber-700",
      text: "⚠️ เข้าเว็บไม่ได้ (timeout / เว็บปิด / บล็อกการเข้าถึง) — เช็ค Website URL ให้ถูก แล้วลองใหม่",
    },
    nourl: {
      tone: "border-amber-200 bg-amber-50 text-amber-700",
      text: "⚠️ ยังไม่ได้ใส่ Website URL ของโปรเจกต์ — ใส่ในขั้น Project Info ก่อน แล้วกด Test ใหม่",
    },
  };
  const embedTestMessage = query.embedTest ? EMBED_TEST_RESULT[query.embedTest] : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>Setup Wizard · {project.name}</>}
        subtitle={<>ตั้งค่าการเชื่อมต่อทั้งหมดของโปรเจกต์นี้ทีละขั้น</>}
        actions={<>
        <div className="flex items-center gap-3">
          <Link href={`/line-tracking/projects/${project.id}/settings`} className="btn-secondary text-sm">⚙️ Settings</Link>
          <div className="w-40 sm:w-48">
            <Progress percent={progress.percent} />
            <div className="mt-1 text-right text-xs text-slate-400">{progress.percent}% connected</div>
          </div>
        </div>
        </>}
      />

      {/* ── Onboarding checklist: ทำ 2 ข้อนี้ก่อนเริ่ม (embed + LINE OA), media ทีหลัง ──
          พับได้ + จำสถานะ: พาเนลนี้ยาวมากและอ่านจบแล้วก็ไม่ต้องดูอีก ของเดิมกางค้างตลอด
          กินพื้นที่จนต้องเลื่อนผ่านทุกครั้งที่เข้าหน้านี้ ยังกางเป็นค่าเริ่มต้นเหมือนเดิม
          เพราะเป็นขั้นตอนที่ต้องทำก่อน — ปิดเองแล้วค่อยปิดยาว */}
      <CollapsibleCard
        className="card p-5 border-2 border-brand-blue/30 bg-brand-blue/5"
        storageKey={`setup.checklist.${project.id}`}
        defaultOpen
        header={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-800">🚀 เริ่มโปรเจกต์: ทำ 2 ข้อนี้ให้เสร็จก่อน</h2>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${requiredDone === 2 ? "bg-emerald-500 text-white" : "bg-amber-400 text-white"}`}>
              {requiredDone}/2 พร้อม
            </span>
          </div>
        }
      >
        <p className="mb-4 text-xs text-slate-500">
          ติดตั้งโค้ด Tracking บนเว็บ + เชื่อม LINE OA ให้เสร็จก่อน แล้ว media channel (Google/Meta/TikTok/GA4/Sheet) ค่อยทยอยทำทีหลังได้
        </p>

        <div className="space-y-3">
          {/* 1. Embed code (จำเป็น) */}
          <div className={`rounded-lg border p-3 ${embedInstalled ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-white"}`}>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-lg">{embedInstalled ? "✅" : "1️⃣"}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-800">วางโค้ด Tracking บนเว็บไซต์ลูกค้า</span>
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-rose-100 text-rose-600">จำเป็น</span>
                  {embedInstalled
                    ? <span className="text-xs text-emerald-700">· ตรวจพบ click จริงแล้ว {embedClicks.toLocaleString()} ครั้ง</span>
                    : <span className="text-xs text-amber-600">· ยังไม่พบ traffic — วางโค้ดแล้วเปิดเว็บผ่านลิงก์ที่มี ?utm_source=… เพื่อทดสอบ</span>}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  วางสคริปต์นี้ใน &lt;head&gt; ของเว็บ{project.websiteUrl ? ` (${project.websiteUrl})` : "ลูกค้า"} — ผูกกับโปรเจกต์นี้ผ่าน <code>data-project=&quot;{project.slug}&quot;</code> (snippet ตัวเดียวใช้ได้ทุกโปรเจกต์ ต่างแค่ slug)
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="block flex-1 break-all rounded-lg bg-slate-900 p-2.5 text-[11px] text-slate-100 dark:text-slate-800">{embedSnippet}</code>
                  <CopyButton text={embedSnippet} label="Copy" />
                </div>

                {/* Test button — checks the live site for the snippet, like the LINE card's Test. */}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <EmbedTestButton projectId={project.id} step={step} action={testEmbedAction} />
                  {project.websiteUrl && (
                    <span className="text-[11px] text-slate-400">ตรวจที่ {project.websiteUrl}</span>
                  )}
                  <Link href={`/line-tracking/projects/${project.id}/settings#project-website`} className="text-[11px] text-brand-blue hover:underline">
                    {project.websiteUrl ? "แก้ลิงก์เว็บ" : "ใส่ลิงก์เว็บ"}
                  </Link>
                </div>

                {embedTestMessage && (
                  <div className={`mt-2 rounded-lg border p-2 text-xs ${embedTestMessage.tone}`}>
                    {embedTestMessage.text}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  <Link href={`/line-tracking/projects/${project.id}/tracking-links`} className="text-brand-blue hover:underline">จัดการลิงก์ + ปุ่ม Add LINE →</Link>
                  <Link href="/line-tracking/guide" className="text-slate-500 hover:underline">📖 คู่มือติดตั้งแบบละเอียด →</Link>
                </div>
              </div>
            </div>
          </div>

          {/* 2. LINE OA (จำเป็น) */}
          <div className={`rounded-lg border p-3 ${lineReady ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-white"}`}>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-lg">{lineReady ? "✅" : "2️⃣"}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-800">เชื่อม LINE OA</span>
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-rose-100 text-rose-600">จำเป็น</span>
                  {lineReady
                    ? <span className="text-xs text-emerald-700">· เชื่อมแล้ว (Test ผ่าน)</span>
                    : <span className="text-xs text-amber-600">· ยังไม่เชื่อม — ใส่ Messaging Access Token แล้วกด Test</span>}
                </div>
                <p className="mt-1 text-xs text-slate-500">ต้องมี LINE OA ก่อน ระบบถึงจะรับ Lead และยิง conversion ได้</p>
                <div className="mt-2">
                  <Link href={`${base}?step=line#steps`} className="btn-primary text-xs">{lineReady ? "ดูการตั้งค่า LINE" : "ตั้งค่า LINE OA →"}</Link>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Media channels (ทำทีหลังได้) */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-lg">⏭️</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-700">เชื่อม Media Channels</span>
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-slate-200 text-slate-600">ทำทีหลังได้</span>
                  <span className="text-xs text-slate-500">· เชื่อมแล้ว {mediaConnected}/{mediaTypes.length}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">Google / Meta / TikTok Ads, GA4, Google Sheet — ค่อยทยอยเชื่อมได้หลังเริ่มโปรเจกต์</p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  <Link href={`${base}?step=ads#steps`} className="text-brand-blue hover:underline">ตั้งค่า Ads Platforms →</Link>
                  <Link href={`${base}?step=ga4#steps`} className="text-brand-blue hover:underline">GA4 →</Link>
                  <Link href={`${base}?step=sheet#steps`} className="text-brand-blue hover:underline">Google Sheet →</Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CollapsibleCard>

      {/* ── ข้อมูลที่ยังขาด (missing-data reporter) ─────────────────────────────
          พับได้เหมือนกัน และสรุปผลย่อขึ้นมาไว้บนหัวการ์ด จะได้รู้ว่ามีอะไรค้างอยู่ไหม
          โดยไม่ต้องกางดูรายตัว */}
      <CollapsibleCard
        storageKey={`setup.readiness.${project.id}`}
        defaultOpen
        header={
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-800">สถานะความพร้อมส่ง Conversion</h2>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${notReady.length === 0 ? "bg-emerald-500 text-white" : "bg-amber-400 text-white"}`}>
                {notReady.length === 0 ? "พร้อมทั้งหมด" : `ยังขาด ${notReady.length}`}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              ระบบเช็คให้ว่าแต่ละแพลตฟอร์มขาด credential อะไร และ Lead ล่าสุดมี click id ที่จำเป็นหรือยัง (90 วันล่าสุด)
            </p>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {readiness.map((r) => {
            const clickWarn =
              r.clickIdField &&
              r.ready &&
              r.recentLeads > 0 &&
              (r.leadsWithClickId ?? 0) === 0;
            return (
              <div
                key={r.type}
                className={`flex items-start gap-2 rounded-lg border p-2.5 text-sm ${
                  r.ready
                    ? clickWarn
                      ? "border-amber-200 bg-amber-50"
                      : "border-emerald-200 bg-emerald-50"
                    : "border-rose-200 bg-rose-50"
                }`}
              >
                <span className="mt-0.5">{r.ready ? (clickWarn ? "⚠️" : "✅") : "❌"}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-800">{r.label}</div>
                  {!r.ready && (
                    <div className="text-xs text-rose-700">
                      ขาด: {r.missingCredentials.join(", ")}
                    </div>
                  )}
                  {r.ready && r.clickIdField && (
                    <div className={`text-xs ${clickWarn ? "text-amber-700" : "text-slate-500"}`}>
                      {r.clickIdField}: {r.leadsWithClickId}/{r.recentLeads} leads
                      {r.clickIdRequired && (r.leadsWithClickId ?? 0) === 0 && r.recentLeads > 0
                        ? " · ต้องมี click id นี้ถึงจะส่ง conversion ได้"
                        : ""}
                    </div>
                  )}
                  {r.ready && !r.clickIdField && (
                    <div className="text-xs text-emerald-700">พร้อมส่ง</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {notReady.length === 0 && (
          <p className="mt-2 text-xs text-emerald-700">ทุกแพลตฟอร์มที่ตั้งค่าไว้พร้อมส่ง Conversion แล้ว ✓</p>
        )}
      </CollapsibleCard>

      {/* step nav. scroll={false}: switching steps must not throw the user back to the
          top of the page — the tabs sit right above the content that changes. */}
      <div id="steps" className="flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <Link
            key={s.key}
            scroll={false}
            href={`${base}?step=${s.key}`}
            className={`rounded-full px-3 py-1.5 text-sm ${
              s.key === step
                ? "bg-brand-blue text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {i + 1}. {s.label}
          </Link>
        ))}
      </div>

      {/* step content */}
      <div className="space-y-4">
        {step === "info" && (
          <div className="card p-5 space-y-2">
            <h2 className="text-base font-semibold">Project Info</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
              <Info label="Project" value={project.name} />
              <Info label="Client" value={project.clientName} />
              <Info label="Business type" value={project.businessType} />
              <Info label="Slug" value={project.slug} />
              <Info label="Currency" value={project.currency} />
              <Info label="Timezone" value={project.timezone} />
              <Info label="Default value" value={String(project.defaultConversionValue)} />
              <Info label="Main channel" value={project.mainSalesChannel} />
              <Info label="Status" value={project.status} />
            </dl>

            {/* ── โค้ดฝังเว็บเฉพาะโปรเจกต์นี้ ────────────────────────────────
                slug ถูกสร้างอัตโนมัติตอนสร้างโปรเจกต์ (unique ต่อโปรเจกต์)
                จึงไม่ต้องแก้อะไรด้วยมือ — copy ไปวางได้เลย */}
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-900">🌐 โค้ดฝังเว็บของโปรเจกต์นี้</h3>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${embedInstalled ? "bg-[#06C755] text-white" : "bg-amber-100 text-amber-700"}`}>
                  {embedInstalled ? "✓ ติดตั้งแล้ว" : "ยังไม่ได้ติดตั้ง"}
                </span>
                <CopyButton text={embedSnippet} label="Copy script" />
              </div>
              <p className="mb-2 text-xs text-slate-500">
                วางในส่วน <code>&lt;head&gt;</code> หรือก่อน <code>&lt;/body&gt;</code> ของเว็บไซต์ลูกค้า
                {project.websiteUrl ? ` (${project.websiteUrl})` : ""} — โค้ดนี้ผูกกับ slug{" "}
                <code>{project.slug}</code> ของโปรเจกต์นี้โดยเฉพาะ
              </p>
              <code className="block break-all rounded-lg bg-slate-900 p-3 text-xs text-slate-100 dark:text-slate-800">
                {embedSnippet}
              </code>
              <p className="mt-2 text-xs text-slate-400">
                ต้องมีปุ่มแอด LINE บนหน้าเว็บด้วย —{" "}
                <a className="text-brand-blue underline" href="/line-tracking/guide">
                  ดูคู่มือติดตั้งแบบเต็ม
                </a>
              </p>
            </div>

            {/* Danger zone — เฉพาะผู้ดูแล (apps/bob/varn@convertcake.com) เท่านั้น */}
            {canManage && (
              <DeleteProjectCard
                projectId={project.id}
                slug={project.slug}
                projectName={project.name}
                leadCount={leadCount}
              />
            )}
          </div>
        )}

        {step === "line" && (
          <div className="space-y-4">
            <ConnectionCard projectId={project.id} type="LINE" connection={conn(project.connections, "LINE")} />
            <WebhookLogPanel logs={webhookLogs} />
          </div>
        )}
        {step === "sheet" && (
          <ConnectionCard projectId={project.id} type="GOOGLE_SHEET" connection={conn(project.connections, "GOOGLE_SHEET")} />
        )}
        {step === "ga4" && (
          <ConnectionCard projectId={project.id} type="GA4" connection={conn(project.connections, "GA4")} />
        )}
        {/* กลับมา 3 คอลัมน์ตามเดิม — ปัญหา "ข้อความถูกตัด" แก้ที่ตัวการ์ดแล้ว
            (ผลทดสอบขึ้นบรรทัดใหม่เต็มความกว้างแทนการ truncate) ไม่ต้องแลกด้วยคอลัมน์ */}
        {step === "ads" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {AD_CONNECTION_TYPES.map((t) => (
              <ConnectionCard key={t} projectId={project.id} type={t} connection={conn(project.connections, t)} />
            ))}
          </div>
        )}

        {step === "conversions" && (
          <div className="card p-5 space-y-3">
            <h2 className="text-base font-semibold">⚡ Conversion Mapping</h2>
            <p className="text-sm text-slate-500">
              ส่วนนี้ย้ายไปหน้า Settings แล้ว — ตาราง event ทุกสถานะ (รวม 🚫 line_block ที่ส่งได้ทุกแพลตฟอร์ม),
              เปิด/ปิดกฎ, และแก้ชื่อ event ได้ทั้งแบบ Standard และ Custom
            </p>
            <Link
              href={`/line-tracking/projects/${project.id}/settings/conversion-mapping`}
              className="btn-primary inline-block text-sm"
            >
              เปิด Conversion Mapping →
            </Link>
          </div>
        )}

        {step === "links" && (
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Generate Tracking Links</h2>
              <Link href={`/line-tracking/projects/${project.id}/tracking-links`} className="btn-secondary text-sm">
                จัดการ Tracking Links →
              </Link>
            </div>
            {(["GOOGLE", "META", "TIKTOK"] as const).map((p) => {
              const url = buildTrackingUrl(p, project.slug);
              return (
                <div key={p} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2">
                  <StatusBadge status="CONNECTED" label={p} />
                  <code className="flex-1 truncate text-xs text-slate-500">{url}</code>
                  <CopyButton text={url} />
                </div>
              );
            })}
          </div>
        )}

        {step === "looker" && (
          <LookerConnectCard
            project={{
              id: project.id,
              name: project.name,
              connected: !!project.lookerTokenHash,
              tokenSetAt: project.lookerTokenSetAt,
              includePii: project.lookerIncludePii,
            }}
            freshToken={query.lookerToken}
            accountEmail={lookerAccountEmail}
          />
        )}

        {step === "golive" && (
          <div className="card p-5 space-y-4">
            <h2 className="text-base font-semibold">Test &amp; Go Live</h2>
            <p className="text-sm text-slate-500">
              เชื่อมต่อแล้ว {progress.done}/{progress.total} ตัว. ทดสอบ flow ได้จากลิงก์ tracking แล้วกด Go Live
            </p>
            <div className="flex flex-wrap gap-3">
              <a href={`/t/${project.slug}`} target="_blank" className="btn-secondary" rel="noreferrer">
                🔗 เปิดหน้า Tracking (ทดสอบ)
              </a>
              <Link href={`/line-tracking/projects/${project.id}/leads`} className="btn-secondary">🧑‍🤝‍🧑 ดู Leads</Link>
              <Link href={`/line-tracking/projects/${project.id}/conversions`} className="btn-secondary">⚡ ดู Conversion Queue</Link>
              <form action={setProjectStatusAction}>
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="status" value="LIVE" />
                <button className="btn-primary" type="submit">▶ Go Live</button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* step footer nav */}
      <div className="flex items-center justify-between">
        {stepIndex > 0 ? (
          <Link href={`${base}?step=${STEPS[stepIndex - 1].key}#steps`} className="btn-secondary">← ก่อนหน้า</Link>
        ) : <span />}
        {stepIndex < STEPS.length - 1 ? (
          <Link href={`${base}?step=${STEPS[stepIndex + 1].key}#steps`} className="btn-primary">ถัดไป →</Link>
        ) : (
          <Link href={`/line-tracking/projects/${project.id}`} className="btn-primary">เสร็จสิ้น → ไปหน้าโปรเจกต์</Link>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-700">{value}</dd>
    </div>
  );
}

// ── แผงดู Webhook ล่าสุดจาก LINE ────────────────────────────────────────────
// ให้ลูกค้า/แอดมินเช็คเองได้ว่า LINE ยิง event เข้ามาถึงระบบไหม โดยไม่ต้องเปิด Vercel logs.
type WebhookLogRow = {
  id: string;
  source: string;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  payload: string | null;
};

const WEBHOOK_STATUS: Record<string, { tone: string; label: string }> = {
  SUCCESS: { tone: "border-emerald-200 bg-emerald-50 text-emerald-700", label: "✅ รับแล้ว" },
  REJECTED: { tone: "border-rose-200 bg-rose-50 text-rose-700", label: "🚫 ปฏิเสธ" },
  FAILED: { tone: "border-amber-200 bg-amber-50 text-amber-700", label: "⚠️ ผิดพลาด" },
};

// สรุป payload เป็นข้อความสั้น ๆ — ไม่โชว์ raw payload (กัน PII เช่น LINE userId หลุด).
function webhookSummary(payload: string | null): string {
  if (!payload) return "";
  try {
    const p = JSON.parse(payload) as { note?: string; events?: { type?: string }[] };
    if (p.note) return p.note;
    const events = p.events ?? [];
    if (events.length === 0) return "ทดสอบการเชื่อมต่อ (Verify) — ไม่มี event จริง";
    const types = events.map((e) => e.type || "?");
    return `${events.length} event: ${types.join(", ")}`;
  } catch {
    return "";
  }
}

function WebhookLogPanel({ logs }: { logs: WebhookLogRow[] }) {
  return (
    <div className="card p-5">
      <h2 className="mb-1 text-base font-semibold text-slate-800">📡 Webhook ล่าสุดจาก LINE (10 รายการ)</h2>
      <p className="mb-3 text-xs text-slate-500">
        ทุกครั้งที่ LINE ยิง event เข้ามา (มีคนแอด / ทัก / บล็อก หรือกดปุ่ม Verify) จะโผล่ที่นี่ —
        ถ้าว่างเปล่า แปลว่า LINE ยังต่อไม่ถึงระบบ (เช็ค Webhook URL ให้ถูก + เปิด &quot;Use webhook&quot; อยู่ไหม)
      </p>
      {logs.length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          ยังไม่มี webhook เข้ามาเลย — LINE ยังไม่เคยยิงมาที่ระบบนี้.
          ลองกดปุ่ม <b>Verify</b> ใน LINE Developers → Messaging API → Webhook URL แล้วรีเฟรชหน้านี้
        </div>
      ) : (
        <ul className="space-y-2">
          {logs.map((log) => {
            const st = WEBHOOK_STATUS[log.status] ?? {
              tone: "border-slate-200 bg-slate-50 text-slate-600",
              label: log.status,
            };
            const summary = webhookSummary(log.payload);
            return (
              <li key={log.id} className={`rounded-lg border p-2.5 text-sm ${st.tone}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{st.label}</span>
                  <span className="text-xs opacity-70">{fmtDate(log.createdAt)}</span>
                </div>
                {summary && <div className="mt-0.5 text-xs opacity-80">{summary}</div>}
                {log.errorMessage && <div className="mt-0.5 text-xs font-medium">↳ {log.errorMessage}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
