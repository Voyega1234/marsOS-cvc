"use client";

/**
 * Brand Radar — Scorecard: a grade per headline number against tracked competitors, and a month-to-month table.
 * All values come from the server (ScorecardDTO). Names from data are rendered as React text nodes only.
 */
import { Chip, Panel } from "@/components/ds";
import {
  POSITION_FAIR_GAP, POSITION_GOOD_GAP, RATE_FAIR_RATIO, RATE_GOOD_RATIO,
} from "@/lib/brand-radar/scorecard";
import type { Grade, MonthStat, ScoreGrade, ScoreMetricKey, ScorecardDTO } from "@/lib/brand-radar/scorecard-types";
import { ColumnHelp } from "./ColumnHelp";
import { pct } from "./ReportCards";
import { fmtNum } from "./shared";

type HelpText = { what: string; how: string; when: string };

const GOOD_PCT = Math.round(RATE_GOOD_RATIO * 100);
const FAIR_PCT = Math.round(RATE_FAIR_RATIO * 100);

const GRADE_RULE_RATE =
  `เทียบค่าของเรากับคู่แข่งที่ทำได้ดีที่สุด (ค่าของเรา ÷ ค่าของคู่แข่ง) ถ้าได้ ${GOOD_PCT}% ขึ้นไปเป็น "ดี" ` +
  `${FAIR_PCT}% ขึ้นไปเป็น "พอใช้" ต่ำกว่านั้นเป็น "ต้องแก้" ถ้าค่าของเราเป็น 0 เป็น "ต้องแก้" ` +
  `ถ้าคู่แข่งที่ดีที่สุดได้ 0 แต่เราได้มากกว่า 0 เป็น "ดี" ถ้าไม่มีคู่แข่งให้เทียบจะไม่ให้เกรด`;

const TILE_HELP: Record<ScoreMetricKey, { label: string; help: HelpText }> = {
  mention: {
    label: "Brand Mention rate",
    help: {
      what: "สัดส่วนคำตอบ AI ที่พูดถึงแบรนด์ของเรา เทียบกับคู่แข่งที่ติดตามไว้",
      how: `คำตอบที่มีชื่อแบรนด์ ÷ คำตอบทั้งหมดในช่วงที่เลือก ${GRADE_RULE_RATE} อันดับ = 1 + จำนวนแบรนด์ที่ทำได้ดีกว่าเราอย่างชัดเจน (ค่าเท่ากันได้อันดับเดียวกัน)`,
      when: "คำนวณใหม่ทุกครั้งที่เปิดหน้า ตามตัวกรองด้านบน และเปลี่ยนเมื่อมีการสแกนรอบใหม่",
    },
  },
  citation: {
    label: "AI Citation rate",
    help: {
      what: "สัดส่วนคำตอบ AI ที่อ้างอิงลิงก์ไปยังเว็บไซต์ของเรา เทียบกับคู่แข่งที่ติดตามไว้",
      how: `คำตอบที่มีลิงก์ไปยังโดเมนของแบรนด์ ÷ คำตอบทั้งหมดในช่วงที่เลือก ${GRADE_RULE_RATE}`,
      when: "คำนวณใหม่ทุกครั้งที่เปิดหน้า ตามตัวกรองด้านบน และเปลี่ยนเมื่อมีการสแกนรอบใหม่",
    },
  },
  position: {
    label: "Avg. Position",
    help: {
      what: "ลำดับเฉลี่ยที่แบรนด์ของเราถูกเอ่ยถึงในคำตอบ เมื่อเทียบกับชื่อที่ติดตามทั้งหมด (1 = ถูกเอ่ยถึงก่อน ยิ่งน้อยยิ่งดี)",
      how: `เฉลี่ยลำดับการปรากฏครั้งแรกในคำตอบที่เอ่ยถึงแบรนด์ เกรดดูจากส่วนต่างระหว่างลำดับของเรากับคู่แข่งที่ได้ลำดับดีที่สุด ` +
        `ถ้าตามหลังไม่เกิน ${POSITION_GOOD_GAP} ลำดับ (หรือนำอยู่) เป็น "ดี" ไม่เกิน ${POSITION_FAIR_GAP} ลำดับเป็น "พอใช้" มากกว่านั้นเป็น "ต้องแก้" ` +
        `คู่แข่งที่ไม่เคยถูกเอ่ยถึงไม่นำมาเทียบ`,
      when: "คำนวณใหม่ทุกครั้งที่เปิดหน้า ตามตัวกรองด้านบน และเปลี่ยนเมื่อมีการสแกนรอบใหม่",
    },
  },
};

const MONTH_WHEN = "คำนวณใหม่ทุกครั้งที่เปิดหน้า และเปลี่ยนเมื่อมีการสแกนรอบใหม่ ไม่ขึ้นกับตัวกรองด้านบน";

export type RowKind = "rate" | "position" | "count";
interface MonthRowDef {
  key: string;
  label: string;
  kind: RowKind;
  get: (m: MonthStat) => number | null;
  help: HelpText;
}

const MONTH_ROWS: MonthRowDef[] = [
  {
    key: "appear", label: "Visibility", kind: "rate", get: (m) => m.appearRate,
    help: {
      what: "สัดส่วนคำตอบที่แบรนด์ปรากฏ ไม่ว่าจะถูกเอ่ยชื่อหรือมีลิงก์ไปยังเว็บไซต์ของเรา",
      how: "คำตอบที่มีชื่อแบรนด์หรือมีลิงก์ไปยังเว็บไซต์ของเรา ÷ คำตอบทั้งหมดของเดือนนั้น (ทุกแพลตฟอร์ม ทุกคำถาม) ถ้าไม่มีคำตอบจะแสดง —",
      when: MONTH_WHEN,
    },
  },
  {
    key: "mention", label: "Brand Mention rate", kind: "rate", get: (m) => m.mentionRate,
    help: {
      what: "สัดส่วนคำตอบที่พูดถึงชื่อแบรนด์ของเรา",
      how: "คำตอบที่มีชื่อแบรนด์ ÷ คำตอบทั้งหมดของเดือนนั้น ส่วนต่างแสดงเป็นจุดเปอร์เซ็นต์ (ค่าเดือนนี้ − ค่าเดือนที่เทียบ)",
      when: MONTH_WHEN,
    },
  },
  {
    key: "citation", label: "AI Citation rate", kind: "rate", get: (m) => m.citationRate,
    help: {
      what: "สัดส่วนคำตอบที่อ้างอิงลิงก์ไปยังเว็บไซต์ของเรา",
      how: "คำตอบที่มีลิงก์ไปยังโดเมนของแบรนด์ ÷ คำตอบทั้งหมดของเดือนนั้น ส่วนต่างแสดงเป็นจุดเปอร์เซ็นต์",
      when: MONTH_WHEN,
    },
  },
  {
    key: "position", label: "Avg. Position", kind: "position", get: (m) => m.avgPosition,
    help: {
      what: "ลำดับเฉลี่ยที่แบรนด์ถูกเอ่ยถึงในคำตอบ (1 = ก่อนใคร ยิ่งน้อยยิ่งดี)",
      how: "เฉลี่ยลำดับการปรากฏครั้งแรกของแบรนด์ในคำตอบที่เอ่ยถึงแบรนด์ทั้งเดือน ส่วนต่างคือค่าเดือนนี้ − ค่าเดือนที่เทียบ ติดลบแปลว่าดีขึ้น",
      when: MONTH_WHEN,
    },
  },
  {
    key: "asked", label: "จำนวนคำตอบ", kind: "count", get: (m) => m.asked,
    help: {
      what: "จำนวนคำตอบจาก AI ที่เก็บได้สำเร็จในเดือนนั้น",
      how: "นับคำตอบที่เก็บสำเร็จของรอบสแกนที่เริ่มในเดือนนั้น (นับตามเดือนปฏิทินเวลาประเทศไทย) ส่วนต่างเป็นจำนวนที่เพิ่มหรือลด ไม่ตัดสินว่าดีหรือแย่",
      when: MONTH_WHEN,
    },
  },
  {
    key: "scans", label: "จำนวนรอบสแกน", kind: "count", get: (m) => m.scans,
    help: {
      what: "จำนวนรอบสแกนที่เริ่มในเดือนนั้นและมีคำตอบอย่างน้อยหนึ่งคำตอบ",
      how: "นับรอบสแกนที่มีคำตอบที่เก็บสำเร็จ จัดเข้าเดือนตามวันที่รอบนั้นเริ่ม ส่วนต่างเป็นจำนวนที่เพิ่มหรือลด ไม่ตัดสินว่าดีหรือแย่",
      when: MONTH_WHEN,
    },
  },
];

export const GRADE_CHIP: Record<Grade, { tone: "ok" | "warn" | "bad"; text: string }> = {
  good: { tone: "ok", text: "ดี" },
  fair: { tone: "warn", text: "พอใช้" },
  poor: { tone: "bad", text: "ต้องแก้" },
};

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** "2026-11" -> "พ.ย. 69" (Buddhist year, two digits) */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return month;
  return `${THAI_MONTHS[m - 1]} ${String((y + 543) % 100).padStart(2, "0")}`;
}

function fmtPos(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(1);
}

export function showValue(kind: RowKind, v: number | null): string {
  if (v === null) return "—";
  if (kind === "rate") return pct(v);
  if (kind === "position") return fmtPos(v);
  return fmtNum(v);
}

function tileValue(g: ScoreGrade): string {
  return g.metric === "position" ? fmtPos(g.value) : pct(g.value);
}

export interface Change { text: string; tone: "good" | "bad" | "flat" | "neutral" }

/** change of `cur` against `base`; either side null = nothing to compare */
export function change(kind: RowKind, cur: number | null, base: number | null): Change | null {
  if (cur === null || base === null) return null;
  const diff = kind === "rate" ? Math.round((cur - base) * 1000) / 10 : kind === "position" ? Math.round((cur - base) * 10) / 10 : Math.round(cur - base);
  const shown = kind === "count" ? fmtNum(Math.abs(diff)) : Math.abs(diff).toFixed(1);
  const unit = kind === "rate" ? " จุด" : "";
  if (diff === 0) return { text: `${kind === "count" ? "0" : "0.0"}${unit}`, tone: "flat" };
  const text = `${diff > 0 ? "+" : "-"}${shown}${unit}`;
  if (kind === "count") return { text, tone: "neutral" };
  const better = kind === "position" ? diff < 0 : diff > 0;
  return { text, tone: better ? "good" : "bad" };
}

const CHANGE_CLASS: Record<Change["tone"], string> = {
  good: "font-medium text-emerald-600 dark:text-emerald-400",
  bad: "font-medium text-red-600 dark:text-red-400",
  flat: "text-gray-500",
  neutral: "text-gray-700 dark:text-gray-300",
};

export function ChangeCell({ c }: { c: Change | null }) {
  if (!c) return <span className="text-gray-400">—</span>;
  return <span className={`tabular-nums ${CHANGE_CLASS[c.tone]}`}>{c.text}</span>;
}

function GradeTile({ g }: { g: ScoreGrade }) {
  const meta = TILE_HELP[g.metric];
  const chip = g.grade
    ? GRADE_CHIP[g.grade]
    : g.value === null
      ? { tone: "muted" as const, text: "ยังไม่มีข้อมูล" }
      : { tone: "muted" as const, text: "ยังไม่มีคู่แข่งให้เทียบ" };
  return (
    <div className="min-w-0 rounded-xl border border-gray-100 bg-white/60 px-3 py-3 dark:border-white/10 dark:bg-white/5">
      <div className="text-xs text-gray-500"><ColumnHelp help={meta.help} align="start">{meta.label}</ColumnHelp></div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-2xl font-semibold tabular-nums text-gray-900">{tileValue(g)}</span>
        <Chip tone={chip.tone}>{chip.text}</Chip>
      </div>
      {g.grade && g.rank !== null && (
        <div className="mt-1 text-sm text-gray-700">อันดับ {g.rank} จาก {g.outOf} แบรนด์</div>
      )}
      {g.bestCompetitor && (
        <div className="mt-1 break-words text-xs text-gray-500">
          ดีที่สุดในกลุ่มคู่แข่ง: {g.bestCompetitor.name}{" "}
          <span className="tabular-nums">{g.metric === "position" ? fmtPos(g.bestCompetitor.value) : pct(g.bestCompetitor.value)}</span>
        </div>
      )}
    </div>
  );
}

const CHANGE_HELP = (base: string): HelpText => ({
  what: `การเปลี่ยนแปลงของเดือนล่าสุดเมื่อเทียบกับ${base}`,
  how: "อัตราส่วนแสดงเป็นจุดเปอร์เซ็นต์ (เดือนล่าสุด − เดือนที่เทียบ) Avg. Position แสดงส่วนต่างตรง ๆ สีเขียว = ดีขึ้น สีแดง = แย่ลง (Avg. Position ยิ่งน้อยยิ่งดี) แถวจำนวนไม่ใช้สี",
  when: MONTH_WHEN,
});

export default function ScorecardSection({ scorecard }: { scorecard?: ScorecardDTO }) {
  if (!scorecard) return null;
  const { current, previous, first } = scorecard.months ?? { current: null, previous: null, first: null };
  const showFirst = !!first && first.month !== previous?.month;
  const onlyCurrent = !!current && !previous && !first;

  return (
    <Panel title="Scorecard" subtitle="เกรดของตัวเลขหลักเทียบกับคู่แข่ง (เกรดคิดตามตัวกรองของหน้านี้) และเทียบรายเดือน">
      <div className="space-y-6">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">เกรดเทียบคู่แข่ง</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {(scorecard.grades ?? []).map((g) => <GradeTile key={g.metric} g={g} />)}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">เทียบรายเดือน</h3>
          <p className="text-xs text-gray-500">ทุกแพลตฟอร์ม ทุกคำถาม ไม่ขึ้นกับตัวกรองด้านบน</p>
          {!current ? (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-white/5">ยังไม่มีข้อมูลรายเดือน</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500">
                      <th className="py-1.5 pr-3 text-left font-medium">ตัวชี้วัด</th>
                      <th className="py-1.5 pr-3 text-right font-medium">{monthLabel(current.month)}</th>
                      {!onlyCurrent && (
                        <>
                          <th className="py-1.5 pr-3 text-right font-medium">{previous ? monthLabel(previous.month) : "เดือนก่อน"}</th>
                          <th className="py-1.5 pr-3 text-right font-medium">
                            <ColumnHelp help={CHANGE_HELP("เดือนก่อนหน้า")}>เทียบเดือนก่อน</ColumnHelp>
                          </th>
                        </>
                      )}
                      {showFirst && first && (
                        <>
                          <th className="py-1.5 pr-3 text-right font-medium">{monthLabel(first.month)}</th>
                          <th className="py-1.5 text-right font-medium">
                            <ColumnHelp help={CHANGE_HELP("เดือนแรกที่มีข้อมูล")} align="end">เทียบเดือนแรก</ColumnHelp>
                          </th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {MONTH_ROWS.map((r) => {
                      const cur = r.get(current);
                      return (
                        <tr key={r.key} className="border-t border-gray-100">
                          <td className="py-2 pr-3 text-gray-800"><ColumnHelp help={r.help} align="start">{r.label}</ColumnHelp></td>
                          <td className="py-2 pr-3 text-right font-medium tabular-nums">{showValue(r.kind, cur)}</td>
                          {!onlyCurrent && (
                            <>
                              <td className="py-2 pr-3 text-right tabular-nums">{previous ? showValue(r.kind, r.get(previous)) : "—"}</td>
                              <td className="py-2 pr-3 text-right"><ChangeCell c={previous ? change(r.kind, cur, r.get(previous)) : null} /></td>
                            </>
                          )}
                          {showFirst && first && (
                            <>
                              <td className="py-2 pr-3 text-right tabular-nums">{showValue(r.kind, r.get(first))}</td>
                              <td className="py-2 text-right"><ChangeCell c={change(r.kind, cur, r.get(first))} /></td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {onlyCurrent && <p className="text-sm text-gray-600">ยังไม่มีเดือนก่อนให้เทียบ</p>}
            </>
          )}
        </section>
      </div>
    </Panel>
  );
}
