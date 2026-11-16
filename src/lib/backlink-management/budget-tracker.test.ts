/** Run: npx tsx src/lib/backlink-management/budget-tracker.test.ts */
import assert from "node:assert/strict";
import { linkTrackerProjects, planTrackerSync, similarNames, summarizeTracker, trackerKey, trackerRank } from "./budget-tracker";

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

const TODAY = new Date("2026-11-16T00:00:00Z");

t("General vs High Authority: sheet Type wins, otherwise price", () => {
  assert.equal(trackerRank("High", 2666), "HIGH_AUTHORITY");
  assert.equal(trackerRank("High Authority", null), "HIGH_AUTHORITY");
  assert.equal(trackerRank("General", 9000), "GENERAL");
  assert.equal(trackerRank("", 7999), "GENERAL");
  assert.equal(trackerRank("PR", 8000), "HIGH_AUTHORITY");
  assert.equal(trackerRank("", null), null);
  const s = summarizeTracker(budget, expense, TODAY);
  const ume = s.rows.find((r) => r.project === "Ume Dental Clinic")!;
  assert.deepEqual(ume.general, { links: 1, cost: 2666 });
  assert.deepEqual(ume.highAuthority, { links: 1, cost: 2666 });
  assert.deepEqual(s.totals.general, { links: 4, cost: 2666 * 2 + 6832 + 2800 });
  assert.deepEqual(s.totals.highAuthority, { links: 1, cost: 2666 });
  assert.equal(s.items.find((i) => i.key === trackerKey("Amway", "Amway"))!.rank, "HIGH_AUTHORITY");
});

t("active = budget left, planned links, or a link in the last 90 days", () => {
  const s = summarizeTracker(budget, expense, TODAY);
  const get = (p: string) => s.rows.find((r) => r.project === p)!;
  assert.equal(get("Ume Dental Clinic").active, true); // budget left
  assert.equal(get("Amway").active, true);
  assert.equal(get("Vaanaa").active, false); // no budget, last link April
  assert.equal(get("Suntory").active, false); // no budget, undated
  assert.equal(get("Vaanaa").lastDate, "2026-04-01");
  const later = summarizeTracker(budget, expense, new Date("2026-05-01T00:00:00Z"));
  assert.equal(later.rows.find((r) => r.project === "Vaanaa")!.active, true);
  assert.equal(s.totals.active, 3);
});

t("health: over / near / ok / nobudget", () => {
  const b = [budget[3], ["A", "A", 1000], ["B", "B", 1000], ["C", "C", 1000]];
  const e = [expense[3], ["1 May 2026", "A", "A", "x", "General", 1200, "", "Published"], ["1 May 2026", "B", "B", "x", "General", 900, "", "Published"]];
  const s = summarizeTracker(b, e, TODAY);
  assert.deepEqual(s.rows.map((r) => r.health), ["over", "near", "ok"]);
  assert.equal(s.totals.over, 1);
  assert.equal(summarizeTracker(budget, expense, TODAY).rows.find((r) => r.project === "Vaanaa")!.health, "nobudget");
});

t("similar names", () => {
  assert.equal(similarNames("dxtsolutions", "dxtsolution"), true);
  assert.equal(similarNames("mfactors", "mfactor"), true);
  assert.equal(similarNames("hrc", "amway"), false);
  assert.equal(similarNames("bl", "blclinic"), false);
});

t("linkTrackerProjects: map, alias, exact name, client name, suggestions", () => {
  const projects = [
    { id: "p1", name: "HRC", clientName: "" },
    { id: "p2", name: "DXT Solution", clientName: "" },
    { id: "p3", name: "Mfactors", clientName: "M Factors" },
    { id: "p4", name: "Ume Website", clientName: "" },
  ];
  const rows = ["HRC", "DXT Solutions", "M Factors", "Ume Dental Clinic", "Amway", "Vaanaa"].map((x) => ({ key: trackerKey(x, x) }));
  const map = { [trackerKey("Ume Dental Clinic", "")]: "p4", [trackerKey("Vaanaa", "")]: "=" + trackerKey("Ume Dental Clinic", ""), amway: "gone" };
  const out = linkTrackerProjects(rows, projects, map);
  assert.equal(out.hrc.projectId, "p1");
  assert.equal(out.mfactors.projectId, "p3");
  assert.equal(out[trackerKey("Ume Dental Clinic", "")].projectId, "p4");
  assert.equal(out.vaanaa.projectId, "p4");
  assert.equal(out.dxtsolutions.projectId, null);
  assert.deepEqual(out.dxtsolutions.suggestions, [{ id: "p2", name: "DXT Solution" }]);
  assert.equal(out.amway.projectId, null);
  assert.deepEqual(out.amway.suggestions, []);
});

t("planTrackerSync: linked skip, similar single link, duplicate exact first, rest created", () => {
  const projects = [
    { id: "p1", name: "HRC", clientName: "" },
    { id: "p2", name: "DXT Solution", clientName: "" },
    { id: "p5", name: "Clubmed", clientName: "" },
    { id: "p6", name: "ClubMed", clientName: "" },
    { id: "p7", name: "Truth", clientName: "" },
    { id: "p8", name: "Truth Dent", clientName: "" },
  ];
  const rows = [
    { key: trackerKey("HRC", "HRC"), project: "HRC", client: "HRC" },
    { key: trackerKey("DXT Solutions", "DXT Solutions"), project: "DXT Solutions", client: "DXT Solutions" },
    { key: trackerKey("Clubmed", "Clubmed"), project: "Clubmed", client: "Clubmed" },
    { key: trackerKey("Truth Dental", "Truth Dental"), project: "Truth Dental", client: "Truth Dental" },
    { key: trackerKey("Elephants", "Elephants"), project: "Elephants", client: "Elephants" },
    { key: trackerKey("Big Corp", "Clicx  Shop"), project: "Clicx  Shop", client: "Big Corp" },
    { key: trackerKey("Elephants", "Elephants"), project: "Elephants", client: "Elephants" },
  ];
  const plan = planTrackerSync(rows, projects, {});
  assert.deepEqual(plan.link, { dxtsolutions: "p2", clubmed: "p5" });
  assert.deepEqual(plan.create, [
    { key: "truthdental", name: "Truth Dental", clientName: "" },
    { key: "elephants", name: "Elephants", clientName: "" },
    { key: "clicxshop", name: "Clicx Shop", clientName: "Big Corp" },
  ]);
  assert.deepEqual(planTrackerSync(rows.slice(0, 1), projects, {}), { link: {}, create: [] });
});

console.log(`\n${n} passed`);
