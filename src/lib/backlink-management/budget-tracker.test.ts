/** Run: npx tsx src/lib/backlink-management/budget-tracker.test.ts */
import assert from "node:assert/strict";
import { summarizeTracker } from "./budget-tracker";

let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log("ok -", name); }

const budget = [
  ["PROJECT BUDGET"],
  ["กรอกเงินต้นของแต่ละโปรเจกต์ในคอลัมน์ C"],
  [],
  ["Client", "Project", "Initial Budget (THB)", "Used Budget (THB)", "Remaining Budget (THB)", "% Budget Used", "Budget Status", "Note"],
  ["Ume Dental Clinic", "Ume Dental Clinic", 50000, 5332, 44668, 0.1, "ปกติ", "25 Backlink"],
  ["HRC", "HRC", "140,000.00", "", "", "", "ปกติ"],
  ["Vaanaa", "Vaanaa", "", "", "", "", ""],
  ["Amway", "Amway", 240000, 0, 240000, 0, "ปกติ", "30 Backlinks/3 High"],
];
const expense = [
  ["BACKLINK EXPENSE LOG"],
  ["บันทึก 1 แถวต่อ 1 รายการ"],
  [],
  ["Date", "Client", "Project", "Website / Media", "Type", "Cost (THB)", "Anchor Text", "Status", "Note"],
  ["5 February 2026", "HRC", "HRC", "https://www.bltbangkok.com/special-content/48508/", "General", "2,666.00", "ร้าน ประกอบ คอม", "Published"],
  ["26 March 2026", "Ume Dental Clinic", "Ume Dental Clinic", "https://www.businesstoday.co/x/", "General", 2666, "รากฟันเทียม ที่ไหนดี", "Published"],
  ["26 March 2026", "Ume Dental Clinic", "Ume Dental Clinic", "https://www.bltbangkok.com/y/", "High", 2666, "รากฟันเทียม", "published"],
  ["1 April 2026", "Vaanaa", "Vaanaa", "https://example.com/a", "General", 6832, "", "Published"],
  ["2 April 2026", "Amway", "Amway", "https://example.com/b", "High", 9000, "", "Planned"],
  ["3 April 2026", "Amway", "Amway", "https://example.com/c", "High", 9000, "", "Cancelled"],
  ["", "Suntory", "Suntory", "https://example.com/d", "", 2800, "", "Published"],
];

t("matches the sheet Dashboard math", () => {
  const s = summarizeTracker(budget, expense);
  const ume = s.rows.find((r) => r.project === "Ume Dental Clinic")!;
  assert.equal(ume.initial, 50000);
  assert.equal(ume.used, 5332);
  assert.equal(ume.remaining, 44668);
  assert.equal(ume.links, 2);
  assert.equal(ume.note, "25 Backlink");
  assert.deepEqual(ume.byType, [{ type: "General", links: 1, cost: 2666 }, { type: "High", links: 1, cost: 2666 }]);
  const hrc = s.rows.find((r) => r.project === "HRC")!;
  assert.equal(hrc.initial, 140000);
  assert.equal(hrc.used, 2666);
  assert.equal(hrc.remaining, 137334);
});

t("project without initial budget: used counts, no remaining", () => {
  const s = summarizeTracker(budget, expense);
  const v = s.rows.find((r) => r.project === "Vaanaa")!;
  assert.equal(v.initial, null);
  assert.equal(v.used, 6832);
  assert.equal(v.remaining, null);
  assert.equal(v.usedPct, null);
});

t("expense-only project is added; planned is separate; cancelled ignored", () => {
  const s = summarizeTracker(budget, expense);
  const su = s.rows.find((r) => r.project === "Suntory")!;
  assert.equal(su.initial, null);
  assert.equal(su.used, 2800);
  assert.deepEqual(su.byType, [{ type: "ไม่ระบุประเภท", links: 1, cost: 2800 }]);
  const am = s.rows.find((r) => r.project === "Amway")!;
  assert.equal(am.used, 0);
  assert.equal(am.plannedLinks, 1);
  assert.equal(am.plannedCost, 9000);
  assert.equal(s.items.filter((i) => i.key === am.key).length, 1);
});

t("totals: remaining = initial − all used (like the sheet)", () => {
  const s = summarizeTracker(budget, expense);
  assert.equal(s.totals.initial, 430000);
  assert.equal(s.totals.used, 2666 + 5332 + 6832 + 2800);
  assert.equal(s.totals.remaining, 430000 - 17630);
  assert.equal(s.totals.links, 5);
  assert.equal(s.totals.plannedLinks, 1);
  assert.equal(s.totals.byType[0].type, "General");
  assert.equal(s.totals.byType[0].links, 3);
});

t("items newest first, undated last", () => {
  const s = summarizeTracker(budget, expense);
  assert.equal(s.items[0].date, "2026-04-02");
  assert.equal(s.items[s.items.length - 1].date, null);
  assert.equal(s.items.length, 6);
});

t("missing tabs give warnings, not a crash", () => {
  const s = summarizeTracker([["nothing"]], []);
  assert.equal(s.rows.length, 0);
  assert.equal(s.warnings.length, 1);
});

console.log(`\n${n} passed`);
