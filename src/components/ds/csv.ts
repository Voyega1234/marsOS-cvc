"use client";

type CsvCell = string | number | null | undefined;

/** ใส่เครื่องหมายคำพูดเมื่อมี " , หรือขึ้นบรรทัดใหม่ */
function esc(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** ดาวน์โหลด CSV (มี BOM เพื่อให้ Excel อ่านภาษาไทยได้) */
export function downloadCsv(filename: string, rows: CsvCell[][]): void {
  const body = rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿", body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
