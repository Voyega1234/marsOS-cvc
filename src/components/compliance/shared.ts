import type { CheckStatus, Finding, RiskLevel } from "@/lib/compliance/types";
import type { ChipTone } from "@/components/ds";

export interface CheckRow {
  id: string;
  industry: string;
  articleSource: string;
  articleId: string | null;
  ownerLabel: string;
  title: string;
  riskLevel: RiskLevel;
  riskScore: number;
  summary: string;
  aiUsed: boolean;
  aiModel: string;
  aiError: string;
  status: CheckStatus;
  reviewedAt: string | null;
  reviewNote?: string;
  createdAt: string;
  createdByName: string;
  reviewedByName: string;
}

export interface CheckFull extends CheckRow {
  findings: Finding[];
  rulesSnapshot: unknown[];
}

export interface IndustryOpt {
  key: string;
  label: string;
  builtin: boolean;
  active: number;
  draft: number;
}

export function riskTone(level: RiskLevel): ChipTone {
  if (level === "CRITICAL" || level === "HIGH") return "bad";
  if (level === "MEDIUM") return "warn";
  if (level === "LOW") return "info";
  return "ok";
}

export function statusTone(s: CheckStatus): ChipTone {
  if (s === "APPROVED") return "ok";
  if (s === "REJECTED") return "bad";
  if (s === "CHANGES_REQUESTED") return "warn";
  return "muted";
}

export async function api<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; data: T & { error?: string; problems?: string[] } }> {
  try {
    const r = await fetch(url, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json", ...(init.headers ?? {}) } : init?.headers,
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, data };
  } catch (e) {
    return { ok: false, data: { error: e instanceof Error ? e.message : String(e) } as T & { error?: string } };
  }
}

export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
}
