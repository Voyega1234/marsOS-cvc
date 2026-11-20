// The Leads CRM export file: columns, cells and file name. Pure, so it can be tested
// (leadExportCsv.test.ts); leadExport.ts reads the leads.

export const LEAD_EXPORT_HEADERS = [
  "created_at",
  "full_name",
  "line_name",
  "phone",
  "channel",
  "source",
  "campaign",
  "keyword",
  "status",
  "value",
  "currency",
  "slip_amount",
  "sales_owner",
  "conversion_state",
  "line_stage",
] as const;

export type LeadExportRow = {
  createdAt: Date;
  fullName: string | null;
  displayName: string | null;
  phone: string | null;
  channelGroup: string | null;
  source: string | null;
  campaign: string | null;
  keyword: string | null;
  status: string;
  value: unknown;
  currency: string;
  slipAmount: unknown;
  salesOwner: string | null;
  conversionState: string;
  lineUser: { displayName: string | null; friendStatus: string | null; lastMessageAt: Date | null } | null;
};

/** A leading + or - is left alone when the whole value is a number or a phone number. */
const NUMBER_LIKE = /^[+-][\d\s().,-]*$/;

/**
 * One CSV cell. A value a spreadsheet would run as a formula (it starts with = or @, or with
 * + or - and is not a number) gets a leading apostrophe: LINE display names are typed by
 * anyone who adds the account, and this file is opened in Excel.
 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !NUMBER_LIKE.test(s))) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function lineStage(lineUser: LeadExportRow["lineUser"]): string {
  if (!lineUser) return "";
  if (lineUser.friendStatus === "BLOCKED") return "blocked";
  return lineUser.lastMessageAt ? "messaged" : "added";
}

/** The whole file: UTF-8 with BOM so Thai opens correctly in Excel. */
export function leadsCsv(leads: LeadExportRow[]): string {
  const rows = leads.map((l) =>
    [
      l.createdAt.toISOString(),
      l.fullName ?? "",
      l.displayName ?? l.lineUser?.displayName ?? "",
      l.phone ?? "",
      l.channelGroup ?? "",
      l.source ?? "",
      l.campaign ?? "",
      l.keyword ?? "",
      l.status,
      l.value,
      l.currency,
      l.slipAmount ?? "",
      l.salesOwner ?? "",
      l.conversionState,
      lineStage(l.lineUser),
    ]
      .map(csvCell)
      .join(","),
  );
  return "\uFEFF" + [LEAD_EXPORT_HEADERS.join(","), ...rows].join("\n");
}

/** File name; the channel is in it so several files sent to a client do not overwrite each other. */
export function leadExportFilename(projectSlug: string, channel: string | null, date: Date): string {
  const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const suffix = channel ? `-${slug(channel)}` : "";
  return `${projectSlug}-leads${suffix}-${date.toISOString().slice(0, 10)}.csv`;
}

/**
 * The content-disposition value for a download. A project slug can hold Thai letters and
 * a header value cannot: the plain filename is ASCII only (other characters become _), and
 * filename* carries the real name for browsers that read it.
 */
export function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
