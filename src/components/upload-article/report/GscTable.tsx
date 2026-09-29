"use client";

/**
 * ตารางกลางของแท็บ Report — ค้นหา + เรียงคอลัมน์ + แบ่งหน้า 50/แถว + export CSV (UTF-8 BOM)
 * ใช้ร่วมกันทุกตาราง (คำค้นหา/หน้าเว็บ/บทความ/โอกาส/Cannibalization/อุปกรณ์-ประเทศ)
 */
import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 50;

export interface GscTableColumn<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  render?: (row: T) => React.ReactNode;
  /** ค่าที่ใช้เรียง — ไม่ระบุ = เรียงไม่ได้ */
  sortValue?: (row: T) => number | string;
  /** ค่าที่ใช้ export CSV — ไม่ระบุ = ใช้ sortValue หรือข้ามคอลัมน์นี้ */
  csvValue?: (row: T) => string | number;
}

function escapeCsv(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const lines = [headers.map(escapeCsv).join(","), ...rows.map((r) => r.map(escapeCsv).join(","))];
  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function GscTable<T>({
  rows, columns, searchText, rowKey, csvFilename, renderExpanded, emptyText = "ไม่มีข้อมูล",
}: {
  rows: T[];
  columns: GscTableColumn<T>[];
  /** ข้อความที่ใช้ค้นหา (lowercase แล้ว) ต่อแถว — ไม่ระบุ = ไม่มีช่องค้นหา */
  searchText?: (row: T) => string;
  rowKey: (row: T) => string;
  csvFilename?: string;
  renderExpanded?: (row: T) => React.ReactNode;
  emptyText?: string;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!search.trim() || !searchText) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => searchText(r).toLowerCase().includes(q));
  }, [rows, search, searchText]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return filtered;
    const arr = [...filtered];
    arr.sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(col: GscTableColumn<T>) {
    if (!col.sortValue) return;
    if (sortKey === col.key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(col.key); setSortDir("desc"); }
    setPage(1);
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function doExportCsv() {
    if (!csvFilename) return;
    const csvCols = columns.filter((c) => c.csvValue || c.sortValue);
    const headers = csvCols.map((c) => c.label);
    const csvRows = sorted.map((r) => csvCols.map((c) => (c.csvValue ? c.csvValue(r) : (c.sortValue ? c.sortValue(r) : ""))));
    exportCsv(csvFilename, headers, csvRows);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {searchText && (
          <div className="relative w-full sm:w-56">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="ค้นหา"
              className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg"
            />
          </div>
        )}
        <span className="text-[11px] text-gray-400">{sorted.length.toLocaleString()} แถว</span>
        <div className="flex-1" />
        {csvFilename && (
          <Button size="sm" variant="outline" onClick={doExportCsv}>
            <Download size={12} className="mr-1.5" /> Export CSV
          </Button>
        )}
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-xl">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {renderExpanded && <th className="w-8" />}
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c)}
                  className={`px-3 py-2 font-semibold text-gray-500 whitespace-nowrap ${c.align === "right" ? "text-right" : "text-left"} ${c.sortValue ? "cursor-pointer select-none hover:text-gray-700" : ""}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sortKey === c.key && (sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr><td colSpan={columns.length + (renderExpanded ? 1 : 0)} className="text-center text-gray-400 py-8">{emptyText}</td></tr>
            )}
            {pageRows.map((row) => {
              const key = rowKey(row);
              const isOpen = expanded.has(key);
              return (
                <Fragment key={key}>
                  <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    {renderExpanded && (
                      <td className="text-center">
                        <button onClick={() => toggleExpand(key)} className="text-gray-400 hover:text-gray-700">
                          {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={`px-3 py-2 ${c.align === "right" ? "text-right" : "text-left"}`}>
                        {c.render ? c.render(row) : String(c.sortValue?.(row) ?? "")}
                      </td>
                    ))}
                  </tr>
                  {renderExpanded && isOpen && (
                    <tr className="bg-gray-50/60">
                      <td colSpan={columns.length + 1} className="px-3 py-2">{renderExpanded(row)}</td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-xs">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
            className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40">ก่อนหน้า</button>
          <span className="text-gray-500">หน้า {page} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40">ถัดไป</button>
        </div>
      )}
    </div>
  );
}
