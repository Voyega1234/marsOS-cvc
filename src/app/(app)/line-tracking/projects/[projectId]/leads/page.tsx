import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ds";
import { listLeads, listLeadChannels, listLeadStatuses } from "@/lib/line-tracking/services/leadService";
import { LEAD_STATUS, LEAD_STATUS_LABEL, type LeadStatus } from "@/lib/line-tracking/enums";
import { StatusFilter } from "@/components/line-tracking/StatusFilter";
import { CC_NO_SHEET, ConvertCakeSheetStatusFilter } from "@/components/line-tracking/ConvertCakeSheetStatusFilter";
import { ChatFilter } from "@/components/line-tracking/ChatFilter";
import { CHAT_FILTERS, parseChatFilter } from "@/lib/line-tracking/services/leadFilters";
import { prisma } from "@/lib/prisma";
import { LeadStatusSelect } from "@/components/line-tracking/LeadStatusSelect";
import { ConvertCakeLeadStatusSelect } from "@/components/line-tracking/ConvertCakeLeadStatusSelect";
import { projectLeadStatuses } from "@/lib/line-tracking/services/autoPaidProjects";
import { LeadEdit } from "@/components/line-tracking/LeadEdit";
import { StatusBadge, EmptyRow } from "@/components/line-tracking/ui";
import { fmtDate, fmtMoney } from "@/lib/line-tracking/format";
import { resolveRange, rangeLabel } from "@/lib/line-tracking/date-range";
import { DateRangeFilter } from "@/components/line-tracking/DateRangeFilter";
import { ChannelFilter } from "@/components/line-tracking/ChannelFilter";
import { TopScrollbar } from "@/components/line-tracking/TopScrollbar";
import { ResizableTable } from "@/components/line-tracking/ResizableTable";
import StatusImportManager from "@/components/line-tracking/StatusImportManager";
import { getAuthSession } from "@/lib/session";
import { isStatusImportProject } from "@/lib/line-tracking/services/statusImportService";
import { ccStatusName, ccStatusOptions, isConvertCakeProject, sheetStatusByLead, type CcLeadStatus } from "@/lib/line-tracking/services/convertCakeSheetSync";
import { latestSurveyDates } from "@/lib/line-tracking/services/statusImportProjects";
import { ALL_CHANNELS, activeChannelKey, channelGroupLabel } from "@/lib/line-tracking/services/channelService";
import { compareParams, resolveCompare, windowLabel } from "@/lib/line-tracking/compare";
import { CompareFilter, CompareTile } from "@/components/line-tracking/CompareFilter";
import { listLeadSummaryRows, summarizeLeads } from "@/lib/line-tracking/services/compareService";
import { guardProjectPage } from "@/lib/line-tracking/pageGuard";

export const dynamic = "force-dynamic";
// The status-import server action runs under this route: one status change + enqueue per lead.
export const maxDuration = 60;

function ClickIdChips({ lead }: { lead: { gclid: string | null; fbclid: string | null; ttclid: string | null } }) {
  return (
    <div className="flex gap-1">
      {lead.gclid && <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700" title={lead.gclid}>g</span>}
      {lead.fbclid && <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700" title={lead.fbclid}>fb</span>}
      {lead.ttclid && <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-900 text-white" title={lead.ttclid}>tt</span>}
      {!lead.gclid && !lead.fbclid && !lead.ttclid && <span className="text-xs text-gray-500">—</span>}
    </div>
  );
}

function LineStage({ lineUser }: { lineUser: { friendStatus: string; lastMessageAt: Date | null; blockedAt: Date | null } | null }) {
  if (!lineUser) return <span className="text-xs text-gray-500">—</span>;
  if (lineUser.friendStatus === "BLOCKED")
    return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-100 text-red-700" title="บล็อก OA">🚫 บล็อก</span>;
  if (lineUser.lastMessageAt)
    return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-700" title="ทักเราแล้ว">💬 ทักแล้ว</span>;
  return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700" title="แอดเพื่อนแล้ว">✓ แอดแล้ว</span>;
}

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ q?: string; range?: string; from?: string; to?: string; channel?: string; status?: string; chat?: string; sheet?: string; cmp?: string; cfrom?: string; cto?: string }>;
}) {
  const { projectId } = await params;
  await guardProjectPage(projectId, { clientAllowed: true });
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const range = resolveRange(sp);
  // channel ที่เลือก — คีย์ที่ไม่มีในระบบถูกปัดเป็น "ทั้งหมด" ตั้งแต่ชั้นนี้
  const channel = activeChannelKey(sp);
  const channelOn = channel !== ALL_CHANNELS;
  // สถานะที่เลือก — ค่าที่ไม่มีในระบบถูกปัดเป็น "ทุกสถานะ"
  const status = (LEAD_STATUS as readonly string[]).includes(sp.status ?? "") ? (sp.status as LeadStatus) : undefined;
  // ตัวกรองการทัก — `recent` ย้ายช่วงวันที่ไปกรองที่วันทักล่าสุดแทนวันแอดครั้งแรก
  const chat = parseChatFilter(sp.chat);
  // สถานะตามชีท Convert Cake (ใช้เฉพาะโปรเจกต์ Convert Cake — โปรเจกต์อื่นไม่สนพารามิเตอร์นี้)
  const sheetParam = sp.sheet?.trim() || undefined;
  // "เทียบกับ": off until a comparison is picked. `recent` filters on the latest message time, and only
  // the latest one is stored per person, so an earlier period cannot be rebuilt for it.
  const compare = resolveCompare(sp, range, { fallback: "off" });
  const compareWindow = chat === "recent" ? null : compare.window;
  const cmpExtra = compareParams(sp);
  // project lookup + leads + ตัวเลือก channel วิ่งพร้อมกัน (ทุกอันอิง projectId เดียวกัน)
  const [project, allLeads, channels, statusCounts, compareLeads] = await Promise.all([
    prisma.ltProject.findUnique({ where: { id: projectId } }),
    listLeads(projectId, { q, range, channel, status, chat }),
    listLeadChannels(projectId, { q, range, status, chat }),
    listLeadStatuses(projectId, { q, range, channel, chat }),
    // The same filters over the comparison period (id, status and value only).
    compareWindow ? listLeadSummaryRows(projectId, { q, range: compareWindow, channel, status, chat }) : null,
  ]);
  if (!project) notFound();
  const statuses = projectLeadStatuses(project);
  // สถานะจากชีท Convert Cake (Convert Cake เท่านั้น) — ป้ายหลักในคอลัมน์ Status + ตัวกรองด้านบน
  const ccProject = isConvertCakeProject(project);
  const [sheetStatuses, ccOptions] = ccProject
    ? await Promise.all([sheetStatusByLead(project.id, allLeads.map((l) => l.id)), ccStatusOptions(project.id)])
    : [new Map<string, CcLeadStatus>(), [] as string[]];
  const sheet = ccProject ? sheetParam : undefined;
  const sheetOf = (id: string) => sheetStatuses.get(id)?.status || CC_NO_SHEET;
  const sheetCounts: Record<string, number> = {};
  for (const l of allLeads) sheetCounts[sheetOf(l.id)] = (sheetCounts[sheetOf(l.id)] ?? 0) + 1;
  const noSheet = sheetCounts[CC_NO_SHEET] ?? 0;
  delete sheetCounts[CC_NO_SHEET];
  const leads = sheet ? allLeads.filter((l) => sheetOf(l.id) === sheet) : allLeads;
  // Summary of what the table shows, and of the comparison period under the same filters.
  let comparedLeads = compareLeads;
  if (comparedLeads && sheet) {
    const prevSheet = await sheetStatusByLead(project.id, comparedLeads.map((l) => l.id));
    comparedLeads = comparedLeads.filter((l) => (prevSheet.get(l.id)?.status || CC_NO_SHEET) === sheet);
  }
  const summary = summarizeLeads(leads);
  const compared = comparedLeads ? summarizeLeads(comparedLeads) : null;
  const comparedLabel = compareWindow ? windowLabel(compareWindow) : "";
  const filtered = q !== "" || sp.range != null || channelOn || status != null || chat != null || sheet != null;
  // Customer-list file import (MFactors only).
  const importProject = isStatusImportProject(project);
  const canImport = importProject && Boolean((await getAuthSession())?.user?.id);
  // วันนัดสำรวจจากไฟล์ลูกค้า (MFactors) — แสดงใต้ Status
  const surveys = importProject ? await latestSurveyDates(project.id, leads.map((l) => l.id)) : new Map<string, string>();

  const base = `/line-tracking/projects/${project.id}/leads`;
  // ตัวกรองชุดเดียวกันนี้ส่งต่อให้ปุ่ม Export ด้วย — ไฟล์ที่ลูกค้าได้ต้องตรงกับที่เห็นบนจอ
  const filterQs = new URLSearchParams(
    Object.entries({ q, range: sp.range, from: sp.from, to: sp.to, channel: channelOn ? channel : undefined, status, chat })
      .filter(([, v]) => v != null && v !== "") as [string, string][],
  ).toString();
  /** ลิงก์กรอง channel จากในตาราง — กดที่ป้ายในคอลัมน์ Channel ได้เลย */
  const channelHref = (key: string) => {
    const qs = new URLSearchParams(
      Object.entries({ q, range: sp.range, from: sp.from, to: sp.to, status, chat, sheet, ...cmpExtra })
        .filter(([, v]) => v != null && v !== "") as [string, string][],
    );
    if (key !== channel) qs.set("channel", key);
    const out = qs.toString();
    return out ? `${base}?${out}` : base;
  };

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        eyebrow="LINE Tracking"
        title={<>Leads CRM · {project.name}</>}
        subtitle={<>
            เปลี่ยนสถานะ Lead แล้วระบบจะรัน conversion rule + ส่ง event อัตโนมัติ ({leads.length} leads
            {filtered
              ? ` · ${rangeLabel(sp)}${channelOn ? ` · ${channelGroupLabel(channel)}` : ""}${status ? ` · ${LEAD_STATUS_LABEL[status]}` : ""}${sheet ? ` · ${sheet === CC_NO_SHEET ? "ยังไม่มีสถานะ" : ccStatusName(sheet)}` : ""}${chat ? ` · ${CHAT_FILTERS[chat]}` : ""}${q ? ` · ค้นหา “${q}”` : ""}`
              : ""})
          </>}
        actions={<>
          {canImport && <StatusImportManager projectId={project.id} />}
          {/* The export route checks access itself. */}
          <a
            href={`${base}/export${filterQs ? `?${filterQs}` : ""}`}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            download
          >
            ⬇ Export CSV
          </a>
        </>}
      />

      {/* ค้นหาชื่อไลน์ + ช่วงวันที่ (ชุดเดียวกับหน้า Marketing Funnel) */}
      <div className="min-w-0 space-y-3">
        <form action={base} method="get" className="flex flex-wrap items-center gap-2">
          {sp.range && <input type="hidden" name="range" value={sp.range} />}
          {sp.from && <input type="hidden" name="from" value={sp.from} />}
          {sp.to && <input type="hidden" name="to" value={sp.to} />}
          {channelOn && <input type="hidden" name="channel" value={channel} />}
          {status && <input type="hidden" name="status" value={status} />}
          {chat && <input type="hidden" name="chat" value={chat} />}
          {sheet && <input type="hidden" name="sheet" value={sheet} />}
          {sp.cmp && <input type="hidden" name="cmp" value={sp.cmp} />}
          {sp.cfrom && <input type="hidden" name="cfrom" value={sp.cfrom} />}
          {sp.cto && <input type="hidden" name="cto" value={sp.cto} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="ค้นหาชื่อไลน์ / ชื่อจริง / เบอร์ / LINE user ID"
            className="w-full min-w-0 max-w-sm rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          <button type="submit" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">ค้นหา</button>
          {filtered && (
            <a href={base} className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              ล้างตัวกรอง
            </a>
          )}
        </form>
        <DateRangeFilter base={base} query={sp} extra={{ q, channel: channelOn ? channel : undefined, status, chat, sheet, ...cmpExtra }} />
        <ChannelFilter
          base={base}
          query={sp}
          options={channels.options}
          total={channels.total}
          extra={{ q, range: sp.range, from: sp.from, to: sp.to, status, chat, sheet, ...cmpExtra }}
        />
        {ccProject ? (
          <ConvertCakeSheetStatusFilter
            base={base}
            active={sheet}
            counts={sheetCounts}
            noSheet={noSheet}
            extra={{ q, range: sp.range, from: sp.from, to: sp.to, channel: channelOn ? channel : undefined, status, chat, ...cmpExtra }}
          />
        ) : (
          <StatusFilter
            base={base}
            active={status}
            counts={Object.fromEntries(statusCounts)}
            statuses={statuses}
            extra={{ q, range: sp.range, from: sp.from, to: sp.to, channel: channelOn ? channel : undefined, chat, ...cmpExtra }}
          />
        )}
        <ChatFilter
          base={base}
          active={chat}
          extra={{ q, range: sp.range, from: sp.from, to: sp.to, channel: channelOn ? channel : undefined, status, sheet, ...cmpExtra }}
        />
        {/* Compare with another period — the same filters, read for the other dates */}
        <CompareFilter
          base={base}
          query={sp}
          info={compareWindow ? compare : { ...compare, window: null }}
          extra={{ q, channel: channelOn ? channel : undefined, status, chat, sheet }}
        />
        {compare.window && chat === "recent" && (
          <p className="text-xs text-amber-700">
            ตัวกรอง “{CHAT_FILTERS.recent}” เทียบกับช่วงอื่นไม่ได้ — ระบบเก็บเฉพาะเวลาทักครั้งล่าสุดของแต่ละคน
          </p>
        )}
        {compared && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <CompareTile label="Leads" value={summary.leads.toLocaleString()} cur={summary.leads} prev={compared.leads} prevLabel={comparedLabel} />
            <CompareTile label="คุณภาพผ่าน (สะสม)" value={summary.qualified.toLocaleString()} cur={summary.qualified} prev={compared.qualified} prevLabel={comparedLabel} />
            <CompareTile label="ปิดการขาย" value={summary.purchases.toLocaleString()} cur={summary.purchases} prev={compared.purchases} prevLabel={comparedLabel} />
            <CompareTile
              label="ยอดขาย"
              value={fmtMoney(summary.revenue, project.currency)}
              cur={summary.revenue}
              prev={compared.revenue}
              prevLabel={comparedLabel}
              prevValue={fmtMoney(compared.revenue, project.currency)}
            />
          </div>
        )}
      </div>

      <TopScrollbar className="overflow-x-auto rounded-2xl border border-gray-200 bg-white p-0">
        <ResizableTable storageKey="lt-leads-col-widths" className="min-w-full">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-3 text-left font-semibold">Lead / LINE</th>
              <th className="px-3 py-3 text-left font-semibold">Channel</th>
              <th className="px-3 py-3 text-left font-semibold">LINE</th>
              <th className="px-3 py-3 text-left font-semibold">Campaign</th>
              <th className="px-3 py-3 text-left font-semibold">Click IDs</th>
              <th className="px-3 py-3 text-left font-semibold">Value</th>
              <th className="px-3 py-3 text-left font-semibold">ชื่อ/เบอร์ (เซลส์กรอก)</th>
              <th className="px-3 py-3 text-left font-semibold">Conversion</th>
              <th className="px-3 py-3 text-left font-semibold">Last event</th>
              <th className="px-3 py-3 text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {leads.length === 0 && (
              <EmptyRow
                colSpan={10}
                text={
                  filtered
                    ? "ไม่เจอ lead ที่ตรงกับตัวกรอง — ลองพิมพ์ชื่อไลน์สั้นลง ขยายช่วงวันที่เป็น “ทั้งหมด” หรือเลือก channel เป็น “ทุกช่องทาง”"
                    : "ยังไม่มี lead — ลองเปิด tracking link แล้ว simulate Add LINE"
                }
              />
            )}
            {leads.map((l) => {
              const lastEvent = l.conversionEvents[0];
              return (
                <tr key={l.id} className="align-middle hover:bg-gray-50">
                  <td className="px-3 py-3 text-sm text-gray-700">
                    <div className="font-medium">{l.fullName ?? l.displayName ?? l.lineUser?.displayName ?? "(no name)"}</div>
                    <div className="text-xs text-gray-500">
                      {l.displayName ? `LINE: ${l.displayName}` : ""}{l.phone ? ` · ${l.phone}` : ""}
                    </div>
                    <div className="text-xs text-gray-500">{fmtDate(l.createdAt)}</div>
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700">
                    {/* กดที่ป้ายเพื่อกรองเฉพาะ channel นี้ กดซ้ำเพื่อเอาตัวกรองออก */}
                    <a
                      href={channelHref(l.channelGroup ?? "Direct")}
                      title={
                        (l.channelGroup ?? "Direct") === channel
                          ? "เอาตัวกรอง channel ออก"
                          : `ดูเฉพาะ ${channelGroupLabel(l.channelGroup ?? "Direct")}`
                      }
                      className="inline-block rounded-full hover:opacity-80"
                    >
                      <StatusBadge status={l.channelGroup ?? "Direct"} label={l.channelGroup ?? "Direct"} />
                    </a>
                    <div className="text-xs text-gray-500">{l.channel ?? l.source ?? "-"}</div>
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700"><LineStage lineUser={l.lineUser} /></td>
                  <td className="px-3 py-3 text-sm text-gray-700 text-gray-500">{l.campaign ?? "-"}</td>
                  <td className="px-3 py-3 text-sm text-gray-700"><ClickIdChips lead={l} /></td>
                  <td className="px-3 py-3 text-sm text-gray-700">
                    {fmtMoney(l.value, l.currency)}
                    {l.slipAmount != null && (
                      <div className="mt-0.5 text-xs font-medium text-green-700" title="OCR อ่านจากสลิป — ยืนยันก่อนกด PAID">
                        📎 สลิป: {fmtMoney(l.slipAmount, l.currency)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700">
                    {/* key remounts the form when the saved values change (e.g. after a file import) */}
                    <LeadEdit key={`${l.id}:${l.fullName ?? ""}:${l.phone ?? ""}:${l.value}`} projectId={project.id} leadId={l.id} fullName={l.fullName} phone={l.phone} salesOwner={l.salesOwner} value={l.value} currency={l.currency} />
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700"><StatusBadge status={l.conversionState} /></td>
                  <td className="px-3 py-3 text-xs text-gray-500">
                    {lastEvent ? `${lastEvent.eventName} · ${lastEvent.platform}` : "—"}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700">
                    {/* Convert Cake: status names from the sheet; each maps to a MarsOS status that drives conversions. */}
                    {ccProject ? (
                      <ConvertCakeLeadStatusSelect
                        key={`${l.id}:${sheetStatuses.get(l.id)?.status ?? ""}`}
                        projectId={project.id}
                        leadId={l.id}
                        current={sheetStatuses.get(l.id)?.status ?? ""}
                        options={ccOptions}
                        statusLabel={LEAD_STATUS_LABEL[l.status as LeadStatus] ?? l.status}
                      />
                    ) : (
                      <LeadStatusSelect projectId={project.id} leadId={l.id} status={l.status} statuses={statuses} />
                    )}
                    {surveys.get(l.id) && (
                      <div className="mt-1 whitespace-nowrap text-xs text-gray-500">📅 นัดสำรวจ {surveys.get(l.id)}</div>
                    )}
                    {sheetStatuses.get(l.id)?.sheetLeadId && (
                      <div className="mt-1 whitespace-nowrap text-xs text-gray-500">📊 ชีท {sheetStatuses.get(l.id)!.sheetLeadId}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </ResizableTable>
      </TopScrollbar>
    </div>
  );
}
