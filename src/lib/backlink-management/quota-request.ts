/**
 * Quota slots a backlink request can use instead of a vendor-library site. Pure helpers only (no network, no DB),
 * so the request dialog and tests can share them.
 *
 * A package is "bound" to a project in either of two ways:
 *  - a MarsOS reservation on one of its slots carries that project's id (Quota tab → จองช่อง);
 *  - the sheet's Clients column on one of its slots names the project (its name or its client name).
 *
 * For a bound package we offer the slots already tied to the project that have no link yet, plus one free slot
 * when the package still has usable quota. Expired or stale packages are never offered.
 */
import type { QuotaPackageView, QuotaSlotView } from "./quota-types";

export interface QuotaRequestProject {
  id: string;
  name: string;
  clientName?: string | null;
}

export type QuotaOptionKind = "reserved" | "sheet" | "free";

export interface QuotaRequestOption {
  /** Stable key for a select: `${packageId}:${slotIndex ?? "new"}` */
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

function pickWebsite(p: QuotaPackageView, s: QuotaSlotView | null): string {
  const reserved = s?.reservation?.website?.trim();
  if (reserved) return reserved;
  const first = (p.websites ?? []).map((w) => String(w ?? "").trim()).find(Boolean);
  return first || String(p.vendorName ?? "").trim() || String(p.websiteText ?? "").trim();
}

function option(p: QuotaPackageView, s: QuotaSlotView | null, kind: QuotaOptionKind): QuotaRequestOption {
  return {
    key: `${p.id}:${s ? s.index : "new"}`,
    kind,
    packageId: p.id,
    slotIndex: s ? s.index : null,
    website: pickWebsite(p, s),
    vendorName: String(p.vendorName ?? ""),
    pricePerLink: typeof p.pricePerLink === "number" && Number.isFinite(p.pricePerLink) ? p.pricePerLink : null,
    sourceTitle: String(p.sourceTitle ?? ""),
    tabTitle: String(p.tabTitle ?? ""),
    expireDate: p.expireDate ?? null,
    usable: p.usable ?? null,
  };
}

/** Quota options for one project. Reserved slots first, then sheet-named slots, then one free slot per bound package. */
export function quotaOptionsForProject(packages: QuotaPackageView[] | null | undefined, project: QuotaRequestProject | null | undefined): QuotaRequestOption[] {
  if (!project || !project.id || !Array.isArray(packages)) return [];
  const reserved: QuotaRequestOption[] = [];
  const sheet: QuotaRequestOption[] = [];
  const free: QuotaRequestOption[] = [];
  for (const p of packages) {
    if (!p || p.stale || p.expired) continue;
    const slots = Array.isArray(p.slots) ? p.slots : [];
    let bound = false;
    for (const s of slots) {
      const byReservation = s.reservation?.projectId === project.id;
      const bySheet = !byReservation && clientMatchesProject(s.client, project);
      if (!byReservation && !bySheet) continue;
      bound = true;
      if (!slotOpen(s)) continue;
      (byReservation ? reserved : sheet).push(option(p, s, byReservation ? "reserved" : "sheet"));
    }
    if (bound && (p.usable ?? 0) > 0) {
      const empty = slots.find((s) => !s.used && !s.reservation) ?? null;
      free.push(option(p, empty, "free"));
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
export function quotaNoteLine(o: QuotaRequestOption): string {
  const where = [o.sourceTitle, o.tabTitle].filter(Boolean).join(" / ");
  const slot = o.slotIndex === null ? "ช่องว่างใหม่" : `ช่องที่ ${o.slotIndex + 1}`;
  return `${QUOTA_NOTE_PREFIX} ${o.website || o.vendorName} · ${where || "-"} · ${slot}`;
}
