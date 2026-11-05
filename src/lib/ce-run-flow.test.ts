/**
 * ข้อมูลภาพ Run Test ต้องมาจากผลจริงและไม่วาดค่าศูนย์
 * Run: npx tsx src/lib/ce-run-flow.test.ts
 */
import type { DryRunFileReport, DryRunLayer, DryRunStep } from "./ce-writer-dry-run";
import { fileFunnel, flowSteps, layerBars, rampColor, unsentFiles, FUNNEL_LIGHT } from "./ce-run-flow";

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
}

const L = (key: string, state: DryRunLayer["state"], chars: number): DryRunLayer => ({
  key, label: key, state, required: false, source: null, chars, details: [], text: "",
});
const { bars, excluded, total } = layerBars([L("a", "sent", 200), L("b", "off", 0), L("c", "sent", 50), L("d", "missing", 0), L("e", "later", 0)]);
assert(bars.length === 2 && bars[0].key === "a" && bars[1].key === "c", "bars keep prompt order, sent only");
assert(bars[0].pct === 100 && bars[1].pct === 25, "bar pct relative to max");
assert(excluded.map((e) => e.key).join() === "b,d,e", "non-sent listed separately");
assert(total === 250, "total chars");
assert(layerBars([]).bars.length === 0, "empty layers");

const S = (inTest: boolean): DryRunStep => ({ title: "t", detail: "d", ai: "no", inTest });
const fs = flowSteps([S(true), S(true), S(false), S(false)]);
assert(fs[1].isLastInTest && !fs[0].isLastInTest && !fs[2].isLastInTest, "last in test marker");
assert(flowSteps([S(false)]).every((s) => !s.isLastInTest), "no test step = no marker");

const F = (id: string, total: number, sent: number): DryRunFileReport => ({
  id, name: id, kind: "x", layer: "ข้อจำกัด", totalChars: total, sentChars: sent, status: sent ? "partial" : "none", reason: "",
});
assert(fileFunnel([]) === null, "no files = null");
const fn = fileFunnel([F("f1", 600, 100), F("f2", 400, 300), F("f3", 100, 0)])!;
assert(fn.totalChars === 1100 && fn.sentChars === 400, "funnel totals");
assert(fn.stages.length === 4 && fn.stages[2].label === "f2" && fn.stages[3].label === "f1", "unsent file has no stage, sorted by sent desc");
assert(fn.stages[0].pct === 100 && fn.stages.every((s) => s.pct <= 100), "pct bounded");
assert(unsentFiles([F("f1", 5, 0), F("f2", 5, 5)]).length === 1, "unsent files");
assert(fileFunnel([F("e", 0, 0)]) === null, "empty-text files = null");
assert(rampColor(0, 1) === "#1b4f94" && rampColor(4, 5) === FUNNEL_LIGHT, "ramp ends");
const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
assert(lum(rampColor(0, 4)) < lum(rampColor(1, 4)) && lum(rampColor(1, 4)) < lum(rampColor(3, 4)), "ramp monotone lighter");

console.log(`ce-run-flow: ${passed} passed`);
