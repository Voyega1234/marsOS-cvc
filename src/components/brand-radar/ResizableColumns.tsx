"use client";

// Brand Radar — table columns the viewer can drag wider or narrower.
//
// Widths are a per-viewer convenience kept in localStorage: nothing is sent to the server, and the table renders
// with its defaults when storage is empty or blocked.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface ColumnSpec {
  key: string;
  /** default width in px */
  width: number;
  /** narrowest the viewer can drag it (px) */
  min?: number;
  /** a column that keeps its default width (checkbox, action buttons) */
  fixed?: boolean;
}

const MIN_WIDTH = 64;
const MAX_WIDTH = 900;
const KEY_STEP = 16;

function clampWidth(c: ColumnSpec, w: number): number {
  return Math.round(Math.min(MAX_WIDTH, Math.max(c.min ?? MIN_WIDTH, w)));
}

function readStored(storageKey: string): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStored(storageKey: string, value: Record<string, number>): void {
  try {
    if (Object.keys(value).length === 0) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // storage blocked: the widths simply last until the page is left
  }
}

export interface ColumnWidths {
  /** current width of every column (px) */
  widths: Record<string, number>;
  /** sum of all columns (px): the table's own width */
  total: number;
  /** set while dragging; `commit` also remembers it for the next visit */
  setWidth: (key: string, width: number, commit?: boolean) => void;
  /** back to the default width */
  resetWidth: (key: string) => void;
  specOf: (key: string) => ColumnSpec | undefined;
}

export function useColumnWidths(storageKey: string, columns: readonly ColumnSpec[]): ColumnWidths {
  const [custom, setCustom] = useState<Record<string, number>>({});
  const latest = useRef(custom);
  latest.current = custom;

  // Read after mount so the server render and the first client render agree.
  useEffect(() => {
    setCustom(readStored(storageKey));
  }, [storageKey]);

  const byKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);

  const widths = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of columns) {
      const v = custom[c.key];
      out[c.key] = !c.fixed && typeof v === "number" ? clampWidth(c, v) : c.width;
    }
    return out;
  }, [columns, custom]);

  const total = useMemo(() => columns.reduce((sum, c) => sum + widths[c.key], 0), [columns, widths]);

  const setWidth = useCallback((key: string, width: number, commit = false) => {
    const spec = byKey.get(key);
    if (!spec || spec.fixed) return;
    const next = { ...latest.current, [key]: clampWidth(spec, width) };
    latest.current = next;
    setCustom(next);
    if (commit) writeStored(storageKey, next);
  }, [byKey, storageKey]);

  const resetWidth = useCallback((key: string) => {
    const next = { ...latest.current };
    delete next[key];
    latest.current = next;
    setCustom(next);
    writeStored(storageKey, next);
  }, [storageKey]);

  const specOf = useCallback((key: string) => byKey.get(key), [byKey]);

  return { widths, total, setWidth, resetWidth, specOf };
}

/** The `<colgroup>` that carries the widths; goes first inside the table. */
export function ColumnGroup({ columns, widths }: { columns: readonly ColumnSpec[]; widths: Record<string, number> }) {
  return (
    <colgroup>
      {columns.map((c) => <col key={c.key} style={{ width: widths[c.key] }} />)}
    </colgroup>
  );
}

/** A header cell with a drag handle on its right edge. */
export function ResizableHead({ col, label, cols, className, children }: {
  /** key of the column in the spec list */
  col: string;
  /** plain name of the column, for the handle's accessible name */
  label: string;
  cols: ColumnWidths;
  className?: string;
  children?: ReactNode;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const spec = cols.specOf(col);
  const width = cols.widths[col];
  const resizable = Boolean(spec) && !spec?.fixed;

  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
    if (!drag.current) return;
    cols.setWidth(col, drag.current.width + (e.clientX - drag.current.x));
  };
  const endDrag = (e: PointerEvent<HTMLSpanElement>) => {
    if (!drag.current) return;
    cols.setWidth(col, drag.current.width + (e.clientX - drag.current.x), true);
    drag.current = null;
    setDragging(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      cols.setWidth(col, width + (e.key === "ArrowRight" ? KEY_STEP : -KEY_STEP), true);
    } else if (e.key === "Home") {
      e.preventDefault();
      cols.resetWidth(col);
    }
  };

  return (
    <TableHead className={cn("relative overflow-hidden", className)}>
      {children}
      {resizable ? (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label={`ปรับความกว้างคอลัมน์ ${label}`}
          aria-valuenow={width}
          aria-valuemin={spec?.min ?? MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          tabIndex={0}
          title="ลากเพื่อปรับความกว้าง · ดับเบิลคลิกเพื่อคืนค่าเดิม"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => cols.resetWidth(col)}
          onKeyDown={onKeyDown}
          className={cn(
            "group/resize absolute inset-y-0 right-0 z-10 flex w-3 cursor-col-resize touch-none select-none items-center justify-center outline-none",
            "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "h-5 w-px rounded-full bg-gray-300 transition-all group-hover/resize:h-full group-hover/resize:w-0.5 group-hover/resize:bg-brand-blue",
              dragging && "h-full w-0.5 bg-brand-blue",
            )}
          />
        </span>
      ) : null}
    </TableHead>
  );
}
