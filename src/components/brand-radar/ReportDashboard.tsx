"use client";

/**
 * Brand Radar — Overview dashboard (card layout) fed by ONE request: GET /api/brand-radar/responses.
 * Dossier header + hero row + bottom row (ReportDossier), scan-by-scan progress, small cards and the competitor /
 * sources tables, sentiment, latest answers, brand switcher, and the "ควรดูต่อ" action list last.
 * Every new DTO field may be missing while the backend is updated, so all reads are defensive.
 * All API text is untrusted: rendered as React text nodes only.
 */
import { useState, type ReactNode } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, ChevronRight, EyeOff, Link2, Radar, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel } from "@/components/ds";
import type { AnswerFeedDTO } from "@/lib/brand-radar/types";
import { SENTIMENT_FACTOR_LABEL } from "@/lib/brand-radar/types";
import { fmtNum, NO_DATA_MESSAGE, providerLabelFor, radarQuery, type TabId, type TabProps } from "./shared";
import { LoadState, useApiData } from "./PromptDialogs";
import ResponseViewer, { type ViewerTarget } from "./ResponseViewer";
import { AnswerBreakdownCard, LatestAnswersTable, SourcesCard, TopCompetitorsCard, pct } from "./ReportCards";
import { QueryGroupsCard, SENTIMENT_SECTION_ID, SentimentSection } from "./InsightSections";
import { BottomRow, BrandPager, DossierHeader, HeroRow, type BrandOpt } from "./ReportDossier";
import { ScanProgressSection } from "./ScanProgressSection";
import ScorecardSection from "./ScorecardSection";

type Dto = AnswerFeedDTO;

interface ActionRow { key: string; icon: ReactNode; title: string; reason: string; go: () => void }

/** Up to 6 things that need a decision, computed in the browser from the DTO */
function buildActions(dto: Dto, onGoTab: TabProps["onGoTab"], clientView?: boolean): ActionRow[] {
  const rows: ActionRow[] = [];
  const counts = dto.counts;
  const icon = (n: ReactNode) => n;
  if ((counts?.competitor_only ?? 0) > 0) {
    rows.push({ key: "co", icon: icon(<Users className="h-4 w-4" />), title: `${fmtNum(counts.competitor_only)} ครั้ง (คำถาม × AI) ที่ AI ตอบถึงคู่แข่งแต่ไม่มีเรา`, reason: "โอกาสแย่งส่วนแบ่งการถูกพูดถึง", go: () => onGoTab("responses", { mention: "competitor_only" }) });
  }
  if ((counts?.none ?? 0) > 0) {
    rows.push({ key: "none", icon: icon(<EyeOff className="h-4 w-4" />), title: `${fmtNum(counts.none)} ครั้ง (คำถาม × AI) ที่ AI ไม่พูดถึงเราเลย`, reason: "ยังไม่มีแบรนด์เราในคำตอบกลุ่มนี้", go: () => onGoTab("responses", { mention: "none" }) });
  }
  if ((counts?.mention_only ?? 0) > 0) {
    rows.push({ key: "mo", icon: icon(<Link2 className="h-4 w-4" />), title: `${fmtNum(counts.mention_only)} ครั้ง (คำถาม × AI) ที่ถูกพูดถึงแต่ไม่อ้างอิงเว็บเรา`, reason: "มีชื่อแต่ไม่มีลิงก์กลับมาที่เว็บ", go: () => onGoTab("responses", { mention: "mention_only" }) });
  }
  const rated = (dto.byProvider ?? []).filter((p) => (p.asked ?? 0) >= 3 && p.mentionRate !== null && p.mentionRate !== undefined);
  const worst = rated.reduce<(typeof rated)[number] | null>((a, p) => (a === null || (p.mentionRate ?? 0) < (a.mentionRate ?? 0) ? p : a), null);
  if (worst) {
    rows.push({ key: "wp", icon: icon(<BarChart3 className="h-4 w-4" />), title: `${(!clientView && worst.label) || providerLabelFor(worst.provider, clientView)} พูดถึงเราน้อยที่สุด ${pct(worst.mentionRate)}`, reason: `จาก ${fmtNum(worst.asked)} คำตอบ`, go: () => onGoTab("responses", { provider: worst.provider, mention: "all" }) });
  }
  const brand = (dto.entities ?? []).find((e) => e.entityType === "brand");
  const ours = brand?.mentionRate ?? null;
  if (ours !== null) {
    const better = (dto.entities ?? []).filter((e) => e.entityType === "competitor" && e.mentionRate !== null && e.mentionRate > ours)
      .reduce<(typeof dto.entities)[number] | null>((a, e) => (a === null || (e.mentionRate ?? 0) > (a.mentionRate ?? 0) ? e : a), null);
    if (better) {
      rows.push({ key: "comp", icon: icon(<Users className="h-4 w-4" />), title: `${better.name} ถูกพูดถึงมากกว่าเรา (${pct(better.mentionRate)} vs ${pct(ours)})`, reason: "ดูว่าคู่แข่งชนะตรงไหน", go: () => onGoTab("competitors", { competitor: better.name }) });
    }
  }
  const insBrand = dto.insight?.entities?.find((e) => e.entityType === "brand");
  const neg = (insBrand?.factors ?? []).filter((f) => (f.negative ?? 0) > 0).reduce<NonNullable<typeof insBrand>["factors"][number] | null>((a, f) => (a === null || f.negative > a.negative ? f : a), null);
  if (neg) {
    rows.push({
      key: "neg", icon: icon(<AlertTriangle className="h-4 w-4" />),
      title: `AI พูดถึงจุดอ่อนเรื่อง ${neg.label || SENTIMENT_FACTOR_LABEL[neg.code] || neg.code} ${fmtNum(neg.negative)} คำตอบ`,
      reason: "ดูรายละเอียดใน Brand Sentiment",
      go: () => document.getElementById(SENTIMENT_SECTION_ID)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    });
  }
  return rows.slice(0, 6);
}

function ActionPanel({ dto, onGoTab, clientView }: { dto: Dto; onGoTab: TabProps["onGoTab"]; clientView?: boolean }) {
  const rows = buildActions(dto, onGoTab, clientView);
  return (
    <Panel title="ควรดูต่อ" subtitle="เรื่องที่ควรตัดสินใจ">
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-gray-500">
          <CheckCircle2 className="h-6 w-6 text-emerald-500" aria-hidden />
          ไม่มีเรื่องเร่งด่วน
        </div>
      ) : (
        <ul className="grid gap-1.5 md:grid-cols-2">
          {rows.map((r) => (
            <li key={r.key}>
              <button type="button" onClick={r.go} className="flex min-h-[44px] w-full items-center gap-3 rounded-2xl border border-gray-100 bg-white/70 p-3 text-left transition hover:bg-gray-50">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-mist text-brand-blue">{r.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium text-brand-navy">{r.title}</span>
                  <span className="block truncate text-xs text-gray-500">{r.reason}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-36 animate-pulse rounded-2xl bg-gray-100" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="h-80 animate-pulse rounded-3xl bg-gray-100 xl:col-span-2" />
        <div className="h-80 animate-pulse rounded-3xl bg-gray-100" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-56 animate-pulse rounded-3xl bg-gray-100" />)}
      </div>
    </div>
  );
}

export default function ReportDashboard({ projectId, filters, refreshKey, onGoTab, clientView, brands, onSwitchBrand }: Pick<TabProps, "projectId" | "filters" | "refreshKey" | "onGoTab" | "clientView"> & { brands?: BrandOpt[]; onSwitchBrand?: (id: string) => void }) {
  const [viewing, setViewing] = useState<ViewerTarget | null>(null);
  const url = `/api/brand-radar/responses?${radarQuery(projectId, filters, { pageSize: "8" })}`;
  const { data, loading, error, reload } = useApiData<Dto>(url, refreshKey, true);
  const brand = brands?.find((b) => b.id === projectId);

  if (!data) {
    if (loading) return <Skeleton />;
    return <Panel><LoadState loading={false} error={error} onRetry={reload} clientView={clientView} /></Panel>;
  }
  if (!data.configured) {
    return (
      <Panel>
        <EmptyState
          icon={<Radar className="h-6 w-6" />}
          title={clientView ? "ยังไม่มีข้อมูลรายงานสำหรับแบรนด์นี้" : "ยังไม่ได้ตั้งค่าแบรนด์"}
          description={clientView ? undefined : "ตั้งชื่อแบรนด์ โดเมน และ AI platform ที่จะติดตามที่ปุ่ม Settings มุมขวาบน ก่อน"}
          action={clientView ? undefined : <Button onClick={() => onGoTab("settings")}>ไปที่ Settings</Button>}
        />
      </Panel>
    );
  }
  if (!data.hasData) {
    return (
      <Panel>
        <EmptyState
          icon={<Radar className="h-6 w-6" />}
          title={clientView ? "ยังไม่มีข้อมูลในช่วงเวลานี้" : NO_DATA_MESSAGE}
          description={clientView ? "ลองเปลี่ยนช่วงเวลาหรือตัวกรอง หรือรอผลการสแกนรอบถัดไป" : "เพิ่มคำถามที่ต้องการติดตาม แล้วกด Run scan now เพื่อเริ่มเก็บคำตอบ"}
          action={clientView ? undefined : <Button onClick={() => onGoTab("prompts")}>ไปที่ AI Prompts</Button>}
        />
      </Panel>
    );
  }

  return (
    <div className={`space-y-4 ${loading ? "opacity-70" : ""}`}>
      <DossierHeader dto={data} filters={filters} onGoTab={onGoTab} brand={brand} />

      <HeroRow dto={data} filters={filters} clientView={clientView} />

      <BottomRow dto={data} clientView={clientView} />

      <ScorecardSection scorecard={data.scorecard} />

      <ScanProgressSection scans={data.scans ?? []} />

      <div className="grid gap-4 md:grid-cols-2">
        <AnswerBreakdownCard dto={data} clientView={clientView} />
        <QueryGroupsCard insight={data.insight} clientView={clientView} />
      </div>

      {/* the two tables get the wide half-and-half row from xl up; below that each takes the full width */}
      <div className="grid gap-4 xl:grid-cols-2">
        <TopCompetitorsCard dto={data} onGoTab={onGoTab} brand={brand} />
        <SourcesCard dto={data} onGoTab={onGoTab} />
      </div>

      <SentimentSection insight={data.insight} clientView={clientView} onOpenAnswer={setViewing} />

      <LatestAnswersTable dto={data} onOpen={setViewing} onGoTab={onGoTab} clientView={clientView} />

      <BrandPager brands={brands} currentId={projectId} onSwitch={onSwitchBrand} />

      {/* last on the page by the owner's request */}
      <ActionPanel dto={data} onGoTab={onGoTab} clientView={clientView} />

      <ResponseViewer clientView={clientView} projectId={projectId} filters={filters} target={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
