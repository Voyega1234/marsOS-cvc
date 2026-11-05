// ข้อมูลล้วนสำหรับภาพ Run Test (เส้นขั้นตอน / กราฟแท่ง / funnel) — คำนวณจากผล WriterDryRun จริงเท่านั้น ไม่มี mock
import type { DryRunFileReport, DryRunLayer, DryRunStep } from "@/lib/ce-writer-dry-run";

/** สีกราฟ: ตระกูลฟ้าเดียว (#2a78d6) */
export const RUN_FLOW_BAR_COLOR = "#2a78d6";
/** ปลายเข้ม → ปลายอ่อน ของ funnel (ปลายอ่อน 2.56:1 กับพื้นขาว) */
export const FUNNEL_DARK = "#1b4f94";
export const FUNNEL_LIGHT = "#6aa3e6";

export interface FlowStep extends DryRunStep {
  index: number;
  /** ขั้นสุดท้ายที่ Run Test ทำจริง — ขีดแบ่งแสดงต่อจากขั้นนี้ */
  isLastInTest: boolean;
}

/** ใส่ลำดับ และหาขั้นสุดท้ายที่ Run Test ทำจริง (-1 = ไม่มีขั้นไหนทำเลย) */
export function flowSteps(steps: DryRunStep[]): FlowStep[] {
  const last = steps.reduce((acc, s, i) => (s.inTest ? i : acc), -1);
  return steps.map((s, i) => ({ ...s, index: i, isLastInTest: i === last }));
}

export interface LayerBar {
  key: string;
  label: string;
  chars: number;
  /** 0-100 เทียบกับแท่งที่ยาวที่สุด */
  pct: number;
}

export interface ExcludedLayer {
  key: string;
  label: string;
  state: Exclude<DryRunLayer["state"], "sent">;
}

/** แท่ง = layer ที่ส่งเข้า prompt จริง เรียงตามลำดับ prompt · ที่ไม่ส่งแยกไปรายการข้างล่าง ไม่วาดแท่งศูนย์ */
export function layerBars(layers: DryRunLayer[]): { bars: LayerBar[]; excluded: ExcludedLayer[]; total: number } {
  const sent = layers.filter((l) => l.state === "sent");
  const max = sent.reduce((m, l) => Math.max(m, l.chars), 0);
  const bars = sent.map((l) => ({
    key: l.key,
    label: l.label,
    chars: l.chars,
    pct: max > 0 ? Math.max(1, Math.round((l.chars / max) * 100)) : 0,
  }));
  const excluded = layers
    .filter((l) => l.state !== "sent")
    .map((l) => ({ key: l.key, label: l.label, state: l.state as ExcludedLayer["state"] }));
  return { bars, excluded, total: sent.reduce((s, l) => s + l.chars, 0) };
}

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** สีลำดับที่ i จาก n: ความสว่างเพิ่มทีละขั้นแบบเดียวทิศ (เข้ม → อ่อน) */
export function rampColor(i: number, n: number): string {
  const t = n <= 1 ? 0 : Math.min(1, Math.max(0, i / (n - 1)));
  const a = hexToRgb(FUNNEL_DARK);
  const b = hexToRgb(FUNNEL_LIGHT);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export interface FunnelStage {
  key: string;
  label: string;
  /** ข้อความที่แสดงที่ปลายแท่ง */
  value: number;
  /** ความกว้าง 0-100 เทียบข้อความไฟล์ทั้งหมด */
  pct: number;
  color: string;
  note?: string;
}

/** funnel: ข้อความไฟล์ทั้งหมด → ที่ส่งจริงรวม → แยกตามไฟล์ (เรียงจากส่งมากไปน้อย) · ไม่มีไฟล์ = null */
export function fileFunnel(files: DryRunFileReport[]): { stages: FunnelStage[]; totalChars: number; sentChars: number } | null {
  if (files.length === 0) return null;
  const totalChars = files.reduce((s, f) => s + f.totalChars, 0);
  const sentChars = files.reduce((s, f) => s + f.sentChars, 0);
  if (totalChars <= 0) return null;
  const pct = (v: number) => (v > 0 ? Math.max(1, Math.round((v / totalChars) * 100)) : 0);
  const sentFiles = files.filter((f) => f.sentChars > 0).sort((a, b) => b.sentChars - a.sentChars);
  const n = 2 + sentFiles.length;
  const stages: FunnelStage[] = [
    { key: "total", label: `ข้อความในไฟล์ทั้งหมด (${files.length} ไฟล์)`, value: totalChars, pct: 100, color: rampColor(0, n) },
    { key: "sent", label: "ส่งเข้า prompt รวม", value: sentChars, pct: pct(sentChars), color: rampColor(1, n) },
    ...sentFiles.map((f, i) => ({
      key: `${f.layer}-${f.id}`,
      label: f.name,
      value: f.sentChars,
      pct: pct(f.sentChars),
      color: rampColor(2 + i, n),
      note: `${f.layer} · จากทั้งไฟล์ ${f.totalChars.toLocaleString("en-US")}`,
    })),
  ];
  return { stages, totalChars, sentChars };
}

/** ไฟล์ที่ไม่ถูกส่งเลย — แสดงเป็นรายการ ไม่วาดแท่งศูนย์ */
export function unsentFiles(files: DryRunFileReport[]): DryRunFileReport[] {
  return files.filter((f) => f.sentChars <= 0);
}

// ── Configuration Flow (หน้า Overview) ──────────────────────────────────────────
export interface SetupFlowChip {
  label: string;
  tab: string;
  optional?: boolean;
  hint?: string;
}

export const SETUP_FLOW: SetupFlowChip[] = [
  { label: "Business Skill", tab: "business-skills" },
  { label: "Master Prompt", tab: "master-prompts", hint: "มี Content Type ในตัว" },
  { label: "Article Brief", tab: "article-briefs" },
  { label: "ข้อจำกัด", tab: "restrictions", optional: true },
  { label: "Comment ลูกค้า", tab: "client-comments", optional: true },
  { label: "Validator Pack", tab: "validator-packs" },
  { label: "Image Prompt", tab: "image-prompts" },
];

export interface WritingFlowChip {
  label: string;
  hint?: string;
  /** อยู่ในส่วนที่ Run Test ทำให้ดูได้ */
  inTest: boolean;
}

export const WRITING_FLOW: WritingFlowChip[] = [
  { label: "Run Test", hint: "ไม่เสียเงิน", inTest: true },
  { label: "ประกอบ prompt", inTest: true },
  { label: "AI เขียน", inTest: false },
  { label: "ล้าง HTML / เติม FAQ", inTest: false },
  { label: "ตรวจคำต้องห้าม", inTest: false },
  { label: "บันทึก + รูป", inTest: false },
  { label: "Review", inTest: false },
  { label: "Push", inTest: false },
];
