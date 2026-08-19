"use client";

import { Plus, Trash2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { CardConfig, FieldConfig, FieldValues } from "./types";
import { SectionCard } from "./shared";

function Field({
  field,
  value,
  disabled,
  onChange,
  idPrefix,
}: {
  field: FieldConfig;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  idPrefix: string;
}) {
  const id = `${idPrefix}-${field.key}`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-gray-600">
        {field.label}
      </Label>
      {field.type === "textarea" ? (
        <Textarea
          id={id}
          value={value}
          disabled={disabled}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[72px] text-sm"
        />
      ) : field.type === "select" ? (
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm disabled:opacity-60"
        >
          <option value="">— เลือก —</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <Input
          id={id}
          type={field.type === "date" ? "date" : "text"}
          value={value}
          disabled={disabled}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 text-sm"
        />
      )}
    </div>
  );
}

/** การ์ดฟอร์มแบบ object เดี่ยว (ไม่ repeatable) */
export function ObjectCardForm({
  card,
  value,
  disabled,
  onChange,
}: {
  card: CardConfig;
  value: FieldValues;
  disabled?: boolean;
  onChange: (value: FieldValues) => void;
}) {
  return (
    <SectionCard title={card.title}>
      <div className="grid gap-3 sm:grid-cols-2">
        {card.fields.map((f) => (
          <Field
            key={f.key}
            field={f}
            value={value[f.key] ?? ""}
            disabled={disabled}
            idPrefix={card.key}
            onChange={(v) => onChange({ ...value, [f.key]: v })}
          />
        ))}
      </div>
    </SectionCard>
  );
}

/** การ์ดฟอร์มแบบ repeatable rows (add/remove) เช่น Products, Claims, Sources */
export function RepeatableCardForm({
  card,
  rows,
  disabled,
  onChange,
}: {
  card: CardConfig;
  rows: FieldValues[];
  disabled?: boolean;
  onChange: (rows: FieldValues[]) => void;
}) {
  function updateRow(idx: number, next: FieldValues) {
    const copy = rows.slice();
    copy[idx] = next;
    onChange(copy);
  }
  function removeRow(idx: number) {
    onChange(rows.filter((_, i) => i !== idx));
  }
  function addRow() {
    onChange([...rows, {}]);
  }

  return (
    <SectionCard
      title={card.title}
      action={
        !disabled && (
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={addRow}>
            <Plus className="size-3.5" /> เพิ่มแถว
          </Button>
        )
      }
    >
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400">
          ยังไม่มีข้อมูลใน {card.title}
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, idx) => (
            <div key={idx} className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500">
                  {card.title} #{idx + 1}
                </span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    className="rounded p-1 text-red-500 hover:bg-red-50"
                    aria-label="ลบแถว"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {card.fields.map((f) => (
                  <Field
                    key={f.key}
                    field={f}
                    value={row[f.key] ?? ""}
                    disabled={disabled}
                    idPrefix={`${card.key}-${idx}`}
                    onChange={(v) => updateRow(idx, { ...row, [f.key]: v })}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/** นับ % ความครบถ้วนของชุดข้อมูล ตาม card config ที่ให้มา */
export function computeCompleteness(
  cards: CardConfig[],
  data: Record<string, FieldValues | FieldValues[]>
): number {
  let filled = 0;
  const total = cards.length;
  for (const card of cards) {
    const v = data[card.key];
    if (card.repeatable) {
      if (Array.isArray(v) && v.length > 0) filled += 1;
    } else if (v && typeof v === "object" && Object.values(v).some((x) => String(x ?? "").trim() !== "")) {
      filled += 1;
    }
  }
  return total === 0 ? 0 : Math.round((filled / total) * 100);
}
