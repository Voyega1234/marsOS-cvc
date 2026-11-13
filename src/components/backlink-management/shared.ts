"use client";

import { useEffect, useRef } from "react";

export interface MetaProject { id: string; name: string; clientName: string }
export interface MetaUser { id: string; name: string; email: string; role: string }
export interface Meta {
  projects: MetaProject[];
  users: MetaUser[];
  me: { id: string; role: string; canApprove: boolean };
  period: string;
}

export interface BlmRow {
  id: string;
  projectId: string;
  projectName: string;
  vendorSiteId: string | null;
  vendorDomain: string;
  targetUrl: string;
  anchorText: string;
  keyword: string;
  linkType: string;
  quotedPrice: number;
  actualPrice: number | null;
  budgetPeriod: string;
  status: string;
  requestedById: string;
  requestedByName: string;
  assigneeId: string | null;
  assigneeName: string;
  approvedAt: string | null;
  rejectReason: string;
  dueDate: string | null;
  notes: string;
  liveUrl: string;
  publishedAt: string | null;
  lastCheckedAt: string | null;
  checkStatus: string;
  checkDetail: string;
  foundRel: string;
  asanaTaskGid: string | null;
  asanaTaskUrl: string;
  asanaCompleted: boolean;
  asanaSyncError: string;
  createdAt: string;
}

export interface Vendor {
  id: string; domain: string; siteUrl: string; category: string; price: number; domainRating: number | null;
  traffic: number | null; linkType: string; contactName: string; contactChannel: string; notes: string; status: string;
}

export const selectCls =
  "h-10 w-full rounded-xl border border-input bg-white/90 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

export const money = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString("th-TH", { style: "currency", currency: "THB" });

export const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) : "—";

export const fmtDateTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export const dateInput = (s: string | null | undefined) => (s ? s.slice(0, 10) : "");

/** เรียก API แล้วคืน JSON; โยน Error พร้อมข้อความไทยเมื่อไม่สำเร็จ (แนบ payload ไว้ใน .data) */
export async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error ?? `เกิดข้อผิดพลาด (${res.status})`) as Error & { data?: any; status?: number };
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

/** เรียก fn ทุก intervalMs ตอนแท็บเปิดอยู่ และเมื่อกลับมาโฟกัสหน้าต่าง — ดึงการเปลี่ยนแปลงจาก Asana โดยไม่ต้องมีปุ่ม */
export function useAutoRefresh(fn: () => void, intervalMs = 45_000) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") ref.current(); };
    const id = window.setInterval(tick, intervalMs);
    window.addEventListener("focus", tick);
    return () => { window.clearInterval(id); window.removeEventListener("focus", tick); };
  }, [intervalMs]);
}
