/**
 * Quota slots a backlink request can use instead of a vendor-library site. Pure helpers only (no network, no DB),
 * so the request dialog, the request route and tests can share them.
 *
 * Two kinds of option:
 *
 * 1. Booked slots ("reserved" / "sheet"). A package is "bound" to a project in either of two ways:
 *     - a MarsOS reservation on one of its slots carries that project's id (Quota tab → จองช่อง);
 *     - the sheet's Clients column on one of its slots names the project (its name or its client name).
 *    Only slots whose sheet Status is "On Process" are offered: that status is how the team marks a slot as booked
 *    for a client (owner rule, 2026-11-16). Picking one writes nothing to the sheet.
 *
 * 2. Free room in a package ("free", only when asked for with `{ free: true }`). Submitting a request with one of
 *    these makes the server book the next free slot of that package for the request's project (owner request,
 *    2026-11-17: sending a request also reserves the quota). The server picks the slot, not the browser.
 *
 * A slot booked by a request carries a marker in its reservation note (`[คำขอ <request id>]`). Such a slot is
 * never offered again, so two requests cannot share it. Expired or stale packages are never offered.
 */
import type { QuotaPackageView, QuotaSlotView } from "./quota-types";

export interface QuotaRequestProject {
  id: string;
  name: string;
  clientName?: string | null;
}

export type QuotaOptionKind = "reserved" | "sheet" | "free";

export interface QuotaRequestOption {
  /** Stable key for a select: `${packageId}:${slotIndex}` for a booked slot, `${packageId}:new:${n}` for free room */
  key: string;
  kind: QuotaOptionKind;
  packageId: string;
  /** null = a new slot in the package (no row picked yet) */
  slotIndex: number | null;
  website: string;
  vendorName: string;
  pricePerLink: number | null;
  sourceTitle: string;
  tabTitle: string;
  expireDate: string | null;
  usable: number | null;
}

/** Lower-case, NFKC, and drop spaces and punctuation, so "Terra BKK" and "terrabkk" compare equal. */
export function normalizeClientName(name: string | null | undefined): string {
  return String(name ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-‐-―−_.,:;'"()[\]/\\&|]+/g, "");
}

const MIN_CONTAIN = 4;

/** Whether a sheet Clients cell names this project. Equal after normalizing, or one contains the other (min 4 chars). */
export function clientMatchesProject(client: string, project: QuotaRequestProject): boolean {
  const c = normalizeClientName(client);
  if (!c) return false;
  for (const raw of [project.name, project.clientName]) {
    const p = normalizeClientName(raw);
    if (!p) continue;
    if (c === p) return true;
    if (c.length >= MIN_CONTAIN && p.length >= MIN_CONTAIN && (c.includes(p) || p.includes(c))) return true;
  }
  return false;
}

function slotOpen(s: QuotaSlotView): boolean {
  return !s.linkUrl && !s.published;
}

/** Status "On Process" (any case/spacing; "In Process" too) = the slot is booked and waiting for its link. */
export function isOnProcessStatus(status: string | null | undefined): boolean {
  const k = normalizeClientName(status);
  return k === "onprocess" || k === "inprocess";
}

function packageWebsites(p: QuotaPackageView): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of p.websites ?? []) {
    const site = String(w ?? "").trim();
    if (!site || seen.has(site.toLowerCase())) continue;
    seen.add(site.toLowerCase());
    out.push(site);
  }
  return out;
}

function packageFallbackSite(p: QuotaPackageView): string {
  return String(p.vendorName ?? "").trim() || String(p.websiteText ?? "").trim();
}

function pickWebsite(p: QuotaPackageView, s: QuotaSlotView | null): string {
  const reserved = s?.reservation?.website?.trim();
  if (reserved) return reserved;
  return packageWebsites(p)[0] || packageFallbackSite(p);
}

function option(p: QuotaPackageView, s: QuotaSlotView | null, kind: QuotaOptionKind, free?: { n: number; website: string }): QuotaRequestOption {
  return {
    key: free ? `${p.id}:new:${free.n}` : `${p.id}:${s ? s.index : "new"}`,
    kind,
    packageId: p.id,
    slotIndex: s ? s.index : null,
    website: free ? free.website : pickWebsite(p, s),
    vendorName: String(p.vendorName ?? ""),
    pricePerLink: typeof p.pricePerLink === "number" && Number.isFinite(p.pricePerLink) ? p.pricePerLink : null,
    sourceTitle: String(p.sourceTitle ?? ""),
    tabTitle: String(p.tabTitle ?? ""),
    expireDate: p.expireDate ?? null,
    usable: p.usable ?? null,
  };
}

/**
 * Whether a package can take one more booking: an empty slot row, or room to add a row. Mirrors `mayGrow` on the
 * server: a package with a unit count grows up to that count; one without grows only when it is the last in its tab.
 */
function hasFreeRoom(p: QuotaPackageView, isLastInTab: boolean): boolean {
  const slots = Array.isArray(p.slots) ? p.slots : [];
  if (slots.some((s) => !s.used && !s.reservation)) return true;
  return p.units != null ? slots.length < p.units : isLastInTab;
}

export interface QuotaOptionsConfig {
  /** Also offer free room in every live package (one option per package and website). Off by default. */
  free?: boolean;
}

/**
 * Quota options for one project: booked ("On Process") slots with no link yet, tied to the project by a MarsOS
 * reservation or by the sheet's Clients column. MarsOS reservations first, then sheet-named slots, then (when
 * `free` is set) free room in any live package. A slot already taken by a request is skipped.
 */
export function quotaOptionsForProject(
  packages: QuotaPackageView[] | null | undefined,
  project: QuotaRequestProject | null | undefined,
  config?: QuotaOptionsConfig,
): QuotaRequestOption[] {
  if (!project || !project.id || !Array.isArray(packages)) return [];
  const reserved: QuotaRequestOption[] = [];
  const sheet: QuotaRequestOption[] = [];
  const free: QuotaRequestOption[] = [];
  const lastOrdinal = new Map<string, number>();
  if (config?.free) {
    for (const p of packages) {
      if (!p || p.stale) continue;
      const k = `${p.sourceId}\u0000${p.tabTitle}`;
      lastOrdinal.set(k, Math.max(lastOrdinal.get(k) ?? -1, p.ordinal));
    }
  }
  for (const p of packages) {
    if (!p || p.stale || p.expired) continue;
    const slots = Array.isArray(p.slots) ? p.slots : [];
    for (const s of slots) {
      if (!slotOpen(s) || !isOnProcessStatus(s.status)) continue;
      if (hasRequestMarker(s.reservation?.note)) continue;
      const byReservation = s.reservation?.projectId === project.id;
      if (byReservation) reserved.push(option(p, s, "reserved"));
      else if (clientMatchesProject(s.client, project)) sheet.push(option(p, s, "sheet"));
    }
    if (config?.free && hasFreeRoom(p, lastOrdinal.get(`${p.sourceId}\u0000${p.tabTitle}`) === p.ordinal)) {
      const sites = packageWebsites(p);
      if (sites.length === 0) {
        const site = packageFallbackSite(p);
        if (site) free.push(option(p, null, "free", { n: 0, website: site }));
      } else {
        sites.forEach((site, n) => free.push(option(p, null, "free", { n, website: site })));
      }
    }
  }
  return [...reserved, ...sheet, ...free];
}

/** A site name sent by the client for a quota request: one line, no control characters, at most 200 characters. */
export function cleanVendorDomain(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

export const QUOTA_NOTE_PREFIX = "[โควต้า]";

/** Replace the quota line in the notes (or drop it when `line` is null), leaving the user's own text alone. */
export function withQuotaNote(notes: string, line: string | null): string {
  const kept = String(notes ?? "").split("\n").filter((l) => !l.trimStart().startsWith(QUOTA_NOTE_PREFIX));
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop();
  if (line) kept.push(line);
  return kept.join("\n");
}

/** One line for the request notes, so the request records which quota slot it used. */
export function quotaNoteLine(o: Pick<QuotaRequestOption, "website" | "vendorName" | "sourceTitle" | "tabTitle" | "slotIndex">): string {
  const where = [o.sourceTitle, o.tabTitle].filter(Boolean).join(" / ");
  const slot = o.slotIndex === null ? "ช่องว่างใหม่" : `ช่องที่ ${o.slotIndex + 1}`;
  return `${QUOTA_NOTE_PREFIX} ${o.website || o.vendorName} · ${where || "-"} · ${slot}`;
}

// ───────────────────────── request marker on a reservation note ─────────────────────────

const REQUEST_MARK_RE = /^\s*\[คำขอ ([^\]\s]+)\]\s*/;

/** The marker a reservation note starts with when a request booked the slot. */
export function requestMarker(requestId: string): string {
  return `[คำขอ ${requestId}]`;
}

/** Reservation note for a slot booked by a request: the marker, then the page the link is for. */
export function requestReservationNote(requestId: string, targetUrl: string): string {
  return `${requestMarker(requestId)} ${String(targetUrl ?? "").trim()}`.trim().slice(0, 1000);
}

/** The request id in a reservation note's marker, or null when the note has none. */
export function requestIdFromNote(note: string | null | undefined): string | null {
  const m = REQUEST_MARK_RE.exec(String(note ?? ""));
  return m ? m[1] : null;
}

export function hasRequestMarker(note: string | null | undefined): boolean {
  return requestIdFromNote(note) !== null;
}

/** The note without its request marker (the rest of the text is kept). */
export function stripRequestMarker(note: string | null | undefined): string {
  return String(note ?? "").replace(REQUEST_MARK_RE, "");
}

/**
 * The text to write in the sheet's Clients column when a request books a slot for a project. An existing spelling
 * from the sheet is reused only when it equals the project's name or client name after normalizing (never by
 * containment, so one client's spelling is not written for another). Otherwise the client name, then the name.
 */
export function sheetClientForProject(project: QuotaRequestProject, existingClients: readonly string[]): string {
  const wanted = [project.clientName, project.name].map((v) => normalizeClientName(v)).filter(Boolean);
  for (const w of wanted) {
    const hit = existingClients.find((c) => normalizeClientName(c) === w);
    if (hit) return hit.trim();
  }
  return String(project.clientName ?? "").trim() || String(project.name ?? "").trim();
}
