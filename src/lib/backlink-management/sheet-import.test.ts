/** Run: npx tsx src/lib/backlink-management/sheet-import.test.ts */
import assert from "node:assert/strict";
import {
  coerceUrl, expenseStatusKind, isTotalRow, normName, parseAmount, parseBudgetTab, parseExpenseTab, parseSheetDate, pickBudgetTab, pickExpenseTab,
  planImport, sanitizeProjectMap, shortHash, suggestBudgetPeriod, urlKey,
  type ExistingImportRow, type ExistingRequest, type Grid, type PlanInput,
} from "./sheet-import";

let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log("ok -", name); }

// โครงเดียวกับชีทจริง: หัวตารางอยู่แถว 4 ข้อมูลเริ่มแถว 5
const BUDGET: Grid = [
  ["Project Budget"], [], [],
  ["Client", "Project", "Initial Budget (THB)", "Used Budget (THB)", "Remaining Budget (THB)", "% Budget Used", "Budget Status", "Note"],
  ["Alpha", "Alpha", 210000, 0, 210000, 0, "OK", ""],
  ["Beta Clinic", "Beta Clinic", 50000, 30000, 20000, 0.6, "OK", "25 Backlink"],
  ["Gamma", "Gamma", "", 4500, -4500, 0, "", ""],
  ["Radiance Clinic", "Radiance Clinic", "45,000", 0, 45000, 0, "OK", ""],
  ["", "", "", "", "", "0.0%", "", ""],
];
const EXPENSE: Grid = [
  ["Expense Log"], [], [],
  ["Date", "Client", "Project", "Website / Media", "Type", "Cost (THB)", "Anchor Text", "Status", "Note"],
  [46058, "Beta Clinic", "Beta Clinic", "https://news.example.com/a/1/ ", "General", 2500, "จัดฟัน", "Published", ""],
  [46195, "Beta Clinic", "Beta Clinic", "https://www.blt.example/49268/", "General", 3000, "a | b → c", "Published", ""],
  [46196, "Beta Clinic", "Beta Clinic", "https://blt.example/49268", "General", 3000, "", "Published", "ซ้ำ"],
  ["", "Beta Clinic", "Beta Clinic", "", "Directory", 15000, "", "Published", ""],
  [46100, "Gamma", "Gamma", "https://x.example/ไทย", "High", 4500, "nk", "Published", ""],
  [46110, "Alpha", "Alpha", "https://plan.example/p", "General", 2000, "", "Planned", ""],
  [46111, "Alpha", "Alpha", "https://c.example/p", "General", 2000, "", "Cancelled", ""],
  [46120, "Radiance Skin Clinic", "Radiance Skin Clinic", "", "General", "", "", "", ""],
  [46121, "Radiance Skin Clinic", "Radiance Skin Clinic", "https://r.example/1", "General", 1500, "", "Published", ""],
];

function base(over: Partial<PlanInput> = {}): PlanInput {
  return {
    budgets: parseBudgetTab(BUDGET).rows, expenses: parseExpenseTab(EXPENSE).rows,
    projects: [], existingBudgets: [], requests: [], importRows: [], projectMap: {},
    budgetPeriod: "2026-02", update: true, cancelMissing: false, ...over,
  };
}

t("parseAmount: ตัวเลข, ข้อความมี comma / ฿, ค่าที่อ่านไม่ได้", () => {
  assert.equal(parseAmount(2500), 2500);
  assert.equal(parseAmount("2,666.00"), 2666);
  assert.equal(parseAmount("฿ 15,000"), 15000);
  assert.equal(parseAmount("15000 THB"), 15000);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("0.0%"), null);
  assert.equal(parseAmount(-5), null);
  assert.equal(parseAmount(null), null);
});

t("parseSheetDate: เลขลำดับวัน, ISO, วัน/เดือน/ปี, ชื่อเดือน, พ.ศ.", () => {
  assert.equal(parseSheetDate(46058), "2026-02-05");
  assert.equal(parseSheetDate(46058.75), "2026-02-05");
  assert.equal(parseSheetDate("2026-02-05"), "2026-02-05");
  assert.equal(parseSheetDate("5/2/2026"), "2026-02-05");
  assert.equal(parseSheetDate("5 February 2026"), "2026-02-05");
  assert.equal(parseSheetDate("Feb 5, 2026"), "2026-02-05");
  assert.equal(parseSheetDate("5 ก.พ. 2569"), "2026-02-05");
  assert.equal(parseSheetDate("31/2/2026"), null);
  assert.equal(parseSheetDate("soon"), null);
  assert.equal(parseSheetDate(""), null);
  assert.equal(parseSheetDate(12), null);
});

t("normName / urlKey / coerceUrl", () => {
  assert.equal(normName(" M  Factors "), "mfactors");
  assert.equal(normName("M-Factors"), "mfactors");
  assert.equal(normName("คลินิก ก."), "คลินิกก");
  assert.equal(urlKey("https://www.blt.example/49268/"), urlKey("http://blt.example/49268"));
  assert.notEqual(urlKey("https://blt.example/49268"), urlKey("https://blt.example/49269"));
  assert.equal(coerceUrl(" https://news.example.com/a/1/ "), "https://news.example.com/a/1/");
  assert.equal(coerceUrl("ดูที่ https://a.example/x ครับ"), "https://a.example/x");
  assert.equal(coerceUrl("news.example.com"), "https://news.example.com");
  assert.equal(coerceUrl("Facebook page"), "");
  assert.equal(coerceUrl("javascript:alert(1)"), "");
});

t("แท็บ: เลือกจากชื่อ ไม่หยิบแท็บของ MarsOS", () => {
  const titles = ["Dashboard", "Project Budget", "Expense Log", "MarsOS งบประมาณ"];
  assert.equal(pickBudgetTab(titles), "Project Budget");
  assert.equal(pickExpenseTab(titles), "Expense Log");
  assert.equal(pickBudgetTab(["Dashboard", "MarsOS งบประมาณ"]), null);
  assert.equal(pickExpenseTab(["PROJECT BUDGET", " expense log 2026 "]), " expense log 2026 ");
});

t("parseBudgetTab: หัวตารางแถว 4, ไม่จับคอลัมน์ Used/Remaining, แถวท้ายที่มีแต่ 0.0% ถูกทิ้ง", () => {
  const p = parseBudgetTab(BUDGET);
  assert.equal(p.ok, true);
  assert.equal(p.headerRow, 4);
  assert.equal(p.rows.length, 4);
  assert.deepEqual(p.rows[1], { row: 6, client: "Beta Clinic", project: "Beta Clinic", amount: 50000, note: "25 Backlink" });
  assert.equal(p.rows[2].amount, null);
  assert.equal(p.rows[3].amount, 45000);
  assert.equal(parseBudgetTab([["a", "b"], ["c", "d"]]).ok, false);
});

t("parseExpenseTab: วันที่, URL ตัดช่องว่าง, ราคา", () => {
  const p = parseExpenseTab(EXPENSE);
  assert.equal(p.ok, true);
  assert.equal(p.rows.length, 9);
  assert.equal(p.rows[0].row, 5);
  assert.equal(p.rows[0].date, "2026-02-05");
  assert.equal(p.rows[0].url, "https://news.example.com/a/1/");
  assert.equal(p.rows[3].date, null);
  assert.equal(p.rows[3].url, "");
  assert.equal(p.rows[7].cost, null);
  assert.equal(parseExpenseTab([["Date", "Project"], [1, "x"]]).ok, false);
});

t("expenseStatusKind", () => {
  assert.equal(expenseStatusKind(" Published "), "published");
  assert.equal(expenseStatusKind("Planned"), "planned");
  assert.equal(expenseStatusKind("Canceled"), "cancelled");
  assert.equal(expenseStatusKind(""), "blank");
  assert.equal(expenseStatusKind("???"), "other");
});

t("plan ครั้งแรก (ระบบว่าง): สร้างโปรเจกต์ + งบ + ค่าใช้จ่าย Published เท่านั้น", () => {
  const plan = planImport(base());
  assert.deepEqual(plan.blockers, []);
  // Alpha, Beta Clinic, Gamma, Radiance Clinic, Radiance Skin Clinic
  assert.equal(plan.projects.length, 5);
  assert.equal(plan.summary.projectsNew, 5);
  assert.equal(plan.summary.budgetsCreate, 3);
  assert.equal(plan.summary.budgetsBlank, 1);
  assert.equal(plan.summary.expensesCreate, 6);
  assert.deepEqual(plan.summary.skipped, { planned: 1, cancelled: 1, placeholder: 1 });
  assert.equal(plan.summary.publishedRows, 6);
  assert.equal(plan.summary.publishedTotal, 29500);
  assert.equal(plan.summary.importTotal, 29500);
  assert.equal(plan.summary.budgetTotal, 305000);
  assert.ok(plan.warnings.some((w) => w.includes("Radiance Skin Clinic")));
});

t("rowKey: URL เดียวกันสองแถวได้ key ต่างกัน, แถวไม่มี URL ใช้โปรเจกต์ + ประเภท", () => {
  const plan = planImport(base());
  const keys = plan.expenses.filter((e) => e.action === "create").map((e) => e.rowKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes("u|blt.example/49268#0"));
  assert.ok(keys.includes("u|blt.example/49268#1"));
  assert.ok(keys.includes("n|betaclinic|directory#0"));
});

t("เดือนตัดงบ: ตามวันที่ของแถว, ไม่มีวันที่ = เดือนของงบ", () => {
  const plan = planImport(base());
  const byKey = new Map(plan.expenses.map((e) => [e.rowKey, e]));
  assert.equal(byKey.get("u|news.example.com/a/1#0")!.data!.budgetPeriod, "2026-02");
  assert.equal(byKey.get("u|blt.example/49268#0")!.data!.budgetPeriod, "2026-06");
  const noDate = byKey.get("n|betaclinic|directory#0")!;
  assert.equal(noDate.data!.budgetPeriod, "2026-02");
  assert.equal(noDate.data!.publishedAt, null);
  assert.ok(noDate.warnings.some((w) => w.includes("ไม่มีวันที่")));
});

t("suggestBudgetPeriod: เดือนแรกสุดของแถว Published", () => {
  assert.equal(suggestBudgetPeriod(parseExpenseTab(EXPENSE).rows, "2026-11"), "2026-02");
  assert.equal(suggestBudgetPeriod([], "2026-11"), "2026-11");
});

t("จับคู่โปรเจกต์: ชื่อตรง, ชื่อลูกค้าตรง, หลายตัว = ต้องเลือก, map เอง, alias", () => {
  const projects = [
    { id: "p-alpha", name: "ALPHA", clientName: "", manual: false },
    { id: "p-beta", name: "Beta site", clientName: "Beta-Clinic", manual: false },
    { id: "p-g1", name: "Gamma", clientName: "", manual: false },
    { id: "p-g2", name: "gamma", clientName: "", manual: true },
  ];
  const plan = planImport(base({ projects }));
  const by = new Map(plan.projects.map((p) => [p.key, p]));
  assert.equal(by.get("alpha")!.projectId, "p-alpha");
  assert.equal(by.get("betaclinic")!.projectId, "p-beta");
  assert.equal(by.get("gamma")!.resolution, "ambiguous");
  assert.equal(by.get("gamma")!.candidates.length, 2);
  assert.equal(plan.blockers.length, 1);
  assert.equal(plan.summary.skipped.unresolved, 1);

  const fixed = planImport(base({ projects, projectMap: { gamma: "p-g2", radianceskinclinic: "=radianceclinic" } }));
  const by2 = new Map(fixed.projects.map((p) => [p.key, p]));
  assert.deepEqual(fixed.blockers, []);
  assert.equal(by2.get("gamma")!.projectId, "p-g2");
  assert.equal(by2.get("radianceskinclinic")!.resolution, "alias");
  assert.equal(by2.get("radianceskinclinic")!.targetKey, "radianceclinic");
  // เหลือสร้างใหม่แค่ Radiance Clinic ตัวเดียว
  assert.equal(fixed.summary.projectsNew, 1);
});

t("alias วนกลับ / ชี้ไม่เจอ = สร้างใหม่ของตัวเอง ไม่ค้าง", () => {
  const plan = planImport(base({ projectMap: { radianceskinclinic: "=radianceclinic", radianceclinic: "=radianceskinclinic", alpha: "=nothere" } }));
  const by = new Map(plan.projects.map((p) => [p.key, p]));
  assert.equal(by.get("alpha")!.resolution, "new");
  assert.equal(by.get("alpha")!.targetKey, "alpha");
  assert.ok(["new"].includes(by.get("radianceclinic")!.resolution) || by.get("radianceclinic")!.targetKey === "radianceskinclinic");
  assert.deepEqual(plan.blockers, []);
});

t("งบ: เท่าเดิม = same, ต่าง = update, มีงบเดือนอื่น = conflict ไม่ตั้งซ้ำ", () => {
  const projects = [
    { id: "p-alpha", name: "Alpha", clientName: "", manual: true },
    { id: "p-beta", name: "Beta Clinic", clientName: "", manual: true },
    { id: "p-rad", name: "Radiance Clinic", clientName: "", manual: true },
  ];
  const existingBudgets = [
    { id: "b1", projectId: "p-alpha", period: "2026-02", approvedAmount: 210000, note: "" },
    { id: "b2", projectId: "p-beta", period: "2026-02", approvedAmount: 40000, note: "" },
    { id: "b3", projectId: "p-rad", period: "2026-05", approvedAmount: 45000, note: "" },
  ];
  const plan = planImport(base({ projects, existingBudgets }));
  const by = new Map(plan.budgets.map((b) => [b.projectKey, b]));
  assert.equal(by.get("alpha")!.action, "same");
  assert.equal(by.get("betaclinic")!.action, "update");
  assert.equal(by.get("betaclinic")!.current, 40000);
  assert.equal(by.get("betaclinic")!.budgetId, "b2");
  assert.equal(by.get("radianceclinic")!.action, "conflict");
  assert.deepEqual(by.get("radianceclinic")!.otherPeriods, ["2026-05"]);
  assert.equal(by.get("gamma")!.action, "blank");
  const keep = planImport(base({ projects, existingBudgets, update: false }));
  assert.equal(keep.budgets.find((b) => b.projectKey === "betaclinic")!.action, "keep");
});

t("งบ: สองชื่อในชีทลงโปรเจกต์เดียวกัน = รวมยอด", () => {
  const plan = planImport(base({ projectMap: { radianceclinic: "=alpha" } }));
  const alpha = plan.budgets.find((b) => b.projectKey === "alpha")!;
  assert.equal(alpha.amount, 255000);
  assert.deepEqual(alpha.rows, [5, 8]);
  assert.equal(plan.budgets.length, 3);
});

function seeded(): { projects: PlanInput["projects"]; requests: ExistingRequest[]; importRows: ExistingImportRow[] } {
  const projects = [
    { id: "p-alpha", name: "Alpha", clientName: "", manual: true },
    { id: "p-beta", name: "Beta Clinic", clientName: "", manual: true },
    { id: "p-gamma", name: "Gamma", clientName: "", manual: true },
    { id: "p-rad", name: "Radiance Clinic", clientName: "", manual: true },
    { id: "p-rads", name: "Radiance Skin Clinic", clientName: "", manual: true },
  ];
  const first = planImport(base({ projects }));
  const requests: ExistingRequest[] = [];
  const importRows: ExistingImportRow[] = [];
  let i = 0;
  for (const e of first.expenses) {
    if (e.action !== "create" || !e.data) continue;
    const id = `r${++i}`;
    const pid = first.projects.find((p) => p.key === e.projectKey)!.projectId!;
    requests.push({ id, projectId: pid, liveUrl: e.data.liveUrl, status: "PUBLISHED", quotedPrice: e.data.cost, actualPrice: e.data.cost,
      anchorText: e.data.anchorText, publishedAt: e.data.publishedAt, budgetPeriod: e.data.budgetPeriod });
    importRows.push({ rowKey: e.rowKey, requestId: id, lastStatus: "PUBLISHED" });
  }
  return { projects, requests, importRows };
}

t("นำเข้าซ้ำ: ทุกแถวเป็น same ไม่สร้างเพิ่ม", () => {
  const s = seeded();
  assert.equal(s.requests.length, 6);
  const plan = planImport(base(s));
  assert.equal(plan.summary.expensesCreate, 0);
  assert.equal(plan.summary.expensesUpdate, 0);
  assert.equal(plan.summary.expensesSame, 6);
  assert.equal(plan.summary.missing, 0);
  assert.equal(plan.summary.importTotal, 29500);
});

t("นำเข้าซ้ำหลังแก้ราคา/วันที่ในชีท: update เมื่อเปิด, keep เมื่อปิด", () => {
  const s = seeded();
  const grid = EXPENSE.map((r) => [...r]);
  grid[4][5] = 2800;      // ราคาแถว 5
  grid[4][0] = 46090;     // วันที่ → มีนาคม
  const expenses = parseExpenseTab(grid).rows;
  const plan = planImport(base({ ...s, expenses }));
  const row = plan.expenses.find((e) => e.row === 5)!;
  assert.equal(row.action, "update");
  assert.equal(row.requestId, s.requests[0].id);
  assert.ok(row.changes.some((c) => c.includes("ราคา 2500 → 2800")));
  assert.ok(row.changes.some((c) => c.includes("เดือนตัดงบ 2026-02 → 2026-03")));
  assert.equal(plan.summary.importTotal, 29800);
  const keep = planImport(base({ ...s, expenses, update: false }));
  assert.equal(keep.expenses.find((e) => e.row === 5)!.action, "keep");
  assert.equal(keep.summary.importTotal, 29500);
});

t("สถานะใน MarsOS ไม่ถูกแตะ: รายการที่ตรวจแล้ว (VERIFIED) ยังเป็น same", () => {
  const s = seeded();
  s.requests[0].status = "VERIFIED";
  const plan = planImport(base(s));
  assert.equal(plan.expenses.find((e) => e.row === 5)!.action, "same");
});

t("แถวหายจากชีท: รายงาน, ยกเลิกเฉพาะเมื่อเปิด cancelMissing", () => {
  const s = seeded();
  const grid = EXPENSE.filter((_, i) => i !== 4); // ตัดแถว news.example.com
  const expenses = parseExpenseTab(grid).rows;
  const plan = planImport(base({ ...s, expenses }));
  assert.equal(plan.summary.missing, 1);
  assert.equal(plan.missing[0].action, "report");
  assert.equal(plan.missing[0].requestId, s.requests[0].id);
  const cancel = planImport(base({ ...s, expenses, cancelMissing: true }));
  assert.equal(cancel.missing[0].action, "cancel");
  assert.equal(cancel.summary.missingCancel, 1);
});

t("ชีทไม่มีแถว Published เลย: ไม่ยกเลิกของเดิมแม้เปิด cancelMissing", () => {
  const s = seeded();
  const plan = planImport(base({ ...s, expenses: [], cancelMissing: true }));
  assert.equal(plan.summary.missing, 6);
  assert.equal(plan.summary.missingCancel, 0);
  assert.ok(plan.warnings.some((w) => w.includes("ไม่พบแถว Published")));
});

t("แถวกลับมาในชีทหลังถูกตัวนำเข้ายกเลิก = เปิดกลับ, คนยกเลิกเอง = ไม่แตะ", () => {
  const s = seeded();
  s.requests[0].status = "CANCELLED";
  s.importRows[0].lastStatus = "CANCELLED";
  s.requests[1].status = "CANCELLED"; // คนกดยกเลิกเอง (lastStatus ยังเป็น PUBLISHED)
  const plan = planImport(base(s));
  assert.equal(plan.expenses.find((e) => e.requestId === s.requests[0].id)!.action, "revive");
  const byHand = plan.expenses.find((e) => e.requestId === s.requests[1].id)!;
  assert.equal(byHand.action, "skip");
  assert.equal(byHand.skipReason, "cancelled_in_app");
  assert.equal(plan.summary.expensesRevive, 1);
});

const NEWS_URL = "https://news.example.com/a/1/";
function handRequest(over: Partial<ExistingRequest> = {}): ExistingRequest {
  return { id: "hand", projectId: "p-beta", liveUrl: NEWS_URL, status: "PUBLISHED", quotedPrice: 2500, actualPrice: null,
    anchorText: "จัดฟัน", publishedAt: "2026-02-05", budgetPeriod: "2026-02", ...over };
}

t("A: คำขอถูกลบใน MarsOS แต่แถวจำ (PUBLISHED) ยังอยู่ = ข้าม deleted_in_app ไม่สร้างใหม่", () => {
  const s = seeded();
  const gone = s.requests.shift()!;
  const plan = planImport(base(s));
  const row = plan.expenses.find((e) => e.row === 5)!;
  assert.equal(row.action, "skip");
  assert.equal(row.skipReason, "deleted_in_app");
  assert.equal(plan.summary.skipped.deleted_in_app, 1);
  assert.equal(plan.summary.expensesCreate, 0);
  assert.ok(!plan.missing.some((m) => m.requestId === gone.id));
});

t("A: แถวจำ lastStatus CANCELLED แต่คำขอถูกลบ = สร้างใหม่ และบอกว่ามีแถวจำเดิม", () => {
  const s = seeded();
  s.requests.shift();
  s.importRows[0].lastStatus = "CANCELLED";
  const plan = planImport(base(s));
  const row = plan.expenses.find((e) => e.row === 5)!;
  assert.equal(row.action, "create");
  assert.equal(row.hasImportRow, true);
  assert.equal(row.requestId, null);
  assert.equal(plan.summary.expensesCreate, 1);
});

t("A: แถวจำกำพร้า + มีคำขอที่สร้างมือ URL ตรง = จับคู่คำขอนั้น (link / update)", () => {
  for (const lastStatus of ["", "PUBLISHED"]) {
    const s = seeded();
    s.requests.shift();
    s.importRows[0].lastStatus = lastStatus;
    const linkPlan = planImport(base({ ...s, requests: [...s.requests, handRequest()] }));
    const row = linkPlan.expenses.find((e) => e.row === 5)!;
    assert.equal(row.requestId, "hand");
    assert.equal(row.linked, true);
    assert.equal(row.hasImportRow, true);
    assert.equal(row.action, "link");
    assert.equal(linkPlan.summary.expensesCreate, 0);

    const upd = planImport(base({ ...s, requests: [...s.requests, handRequest({ quotedPrice: 1000 })] }));
    const urow = upd.expenses.find((e) => e.row === 5)!;
    assert.equal(urow.requestId, "hand");
    assert.equal(urow.linked, true);
    assert.equal(urow.hasImportRow, true);
    assert.equal(urow.action, "update");
    assert.ok(urow.changes.some((c) => c.includes("ราคา 1000 → 2500")));
  }
});

t("B: แถวที่แก้ URL (โปรเจกต์ ราคา วันที่เดิม) = จับคู่กับรายการเดิม ไม่สร้างซ้ำ", () => {
  const s = seeded();
  const baseline = planImport(base(s));
  const grid = EXPENSE.map((r) => [...r]);
  grid[4][3] = "https://news.example.com/a/changed/";
  const expenses = parseExpenseTab(grid).rows;
  const plan = planImport(base({ ...s, expenses }));
  const row = plan.expenses.find((e) => e.row === 5)!;
  assert.notEqual(row.action, "create");
  assert.equal(row.rekeyFrom, s.importRows[0].rowKey);
  assert.equal(row.requestId, s.requests[0].id);
  assert.equal(row.action, "update");
  assert.ok(row.changes.includes("URL"));
  assert.equal(plan.summary.expensesCreate, 0);
  assert.equal(plan.summary.expensesRekey, 1);
  assert.equal(plan.summary.missing, 0);
  assert.equal(plan.summary.importTotal, baseline.summary.importTotal);

  const keep = planImport(base({ ...s, expenses, update: false }));
  const krow = keep.expenses.find((e) => e.row === 5)!;
  assert.equal(krow.action, "keep");
  assert.equal(krow.rekeyFrom, s.importRows[0].rowKey);
  assert.equal(keep.summary.expensesRekey, 1);
  assert.equal(keep.summary.missing, 0);
  assert.equal(keep.summary.importTotal, baseline.summary.importTotal);
});

t("B: แก้ทั้ง URL และราคา = ไม่จับคู่ เป็น create + หายจากชีท", () => {
  const s = seeded();
  const grid = EXPENSE.map((r) => [...r]);
  grid[4][3] = "https://news.example.com/a/changed/";
  grid[4][5] = 2800;
  const plan = planImport(base({ ...s, expenses: parseExpenseTab(grid).rows }));
  const row = plan.expenses.find((e) => e.row === 5)!;
  assert.equal(row.action, "create");
  assert.equal(row.rekeyFrom, null);
  assert.equal(plan.summary.expensesRekey, 0);
  assert.equal(plan.summary.missing, 1);
});

t("C: แถวจำของชีทอื่นที่ไม่อยู่ในชีทนี้ = ไม่หายจากชีท, นับเป็น otherSheetRows", () => {
  const s = seeded();
  const extra: ExistingRequest = handRequest({ id: "x1", liveUrl: "https://gone.example/z" });
  const other: ExistingImportRow = { rowKey: "u|gone.example/z#0", requestId: "x1", lastStatus: "PUBLISHED", spreadsheetId: "other" };
  const plan = planImport(base({ ...s, requests: [...s.requests, extra], importRows: [...s.importRows, other], spreadsheetId: "this" }));
  assert.ok(!plan.missing.some((m) => m.requestId === "x1"));
  assert.equal(plan.summary.otherSheetRows, 1);
  assert.equal(plan.summary.missing, 0);

  const blank = planImport(base({ ...s, requests: [...s.requests, extra], importRows: [...s.importRows, { ...other, spreadsheetId: "" }], spreadsheetId: "this" }));
  assert.ok(blank.missing.some((m) => m.requestId === "x1"));
  assert.equal(blank.summary.otherSheetRows, 0);
});

t("C: แถวจำที่ไม่ใช่ชีทนี้ = retag และนับใน rowFixes, ชีทตรงกัน = ไม่ต้อง", () => {
  const s = seeded();
  for (const sid of ["", "other"]) {
    const importRows = s.importRows.map((r) => ({ ...r, spreadsheetId: sid }));
    const plan = planImport(base({ ...s, importRows, spreadsheetId: "this" }));
    const matched = plan.expenses.filter((e) => e.hasImportRow);
    assert.equal(matched.length, 6);
    assert.ok(matched.every((e) => e.retag));
    assert.equal(plan.summary.rowFixes, 6);
  }
  const importRows = s.importRows.map((r) => ({ ...r, spreadsheetId: "this" }));
  const plan = planImport(base({ ...s, importRows, spreadsheetId: "this" }));
  assert.ok(plan.expenses.every((e) => !e.retag));
  assert.equal(plan.summary.rowFixes, 0);
});

t("D: noCancelReason = ไม่ยกเลิก รายงานแทน พร้อมแสดงเหตุผล", () => {
  const s = seeded();
  const expenses = parseExpenseTab(EXPENSE.filter((_, i) => i !== 4)).rows;
  const reason = "อ่านชีทไม่ครบ";
  const plan = planImport(base({ ...s, expenses, cancelMissing: true, noCancelReason: reason }));
  assert.equal(plan.missing.length, 1);
  assert.equal(plan.missing[0].action, "report");
  assert.equal(plan.summary.missingCancel, 0);
  assert.ok(plan.warnings.includes(reason));
  const without = planImport(base({ ...s, expenses, cancelMissing: true }));
  assert.equal(without.missing[0].action, "cancel");
  assert.equal(without.summary.missingCancel, 1);
});

t("E: คำขอที่สร้างเอง (lastStatus ว่าง) ไม่ถูกยกเลิกแม้เปิด cancelMissing", () => {
  const s = seeded();
  s.importRows[0].lastStatus = "";
  const expenses = parseExpenseTab(EXPENSE.filter((_, i) => i !== 4)).rows;
  const plan = planImport(base({ ...s, expenses, cancelMissing: true }));
  assert.equal(plan.missing.length, 1);
  assert.equal(plan.missing[0].manual, true);
  assert.equal(plan.missing[0].action, "report");
  assert.equal(plan.summary.missingCancel, 0);
  assert.ok(plan.warnings.some((w) => w.includes("สร้างเองใน MarsOS")));
});

t("F: แถวจำบอก CANCELLED แต่คำขอเปิดอยู่แล้ว = resetMark ล้างเครื่องหมาย", () => {
  const s = seeded();
  s.importRows[0].lastStatus = "CANCELLED";
  const plan = planImport(base(s));
  const row = plan.expenses.find((e) => e.row === 5)!;
  assert.equal(row.resetMark, true);
  assert.equal(row.action, "same");
  assert.ok(plan.summary.rowFixes >= 1);
});

t("G: URL ยาวเกิน 500 ที่ต่างกันตอนท้าย = rowKey ไม่ชนกัน, สั้นกว่า 420 และมี ~", () => {
  const long = "https://long.example/" + "a".repeat(600);
  const u1 = `${long}X1`;
  const u2 = `${long}X2`;
  const grid: Grid = [EXPENSE[3],
    [46058, "A", "A", u1, "General", 100, "", "Published", ""],
    [46058, "A", "A", u2, "General", 100, "", "Published", ""]];
  const plan = planImport(base({ budgets: [], expenses: parseExpenseTab(grid).rows }));
  const keys = plan.expenses.map((e) => e.rowKey);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  for (const k of keys) {
    assert.ok(k.length <= 420);
    assert.ok(k.includes("~"));
  }
  assert.equal(shortHash(u1), shortHash(u1));
  assert.notEqual(shortHash(u1), shortHash(u2));
});

t("H: คำเตือนงบ — จะถูกแก้ตามชีท / มีงบเดือนอื่นอยู่ด้วย (ทุกเดือน)", () => {
  const projects = [{ id: "p-beta", name: "Beta Clinic", clientName: "", manual: true }];
  const upd = planImport(base({ projects, existingBudgets: [{ id: "b2", projectId: "p-beta", period: "2026-02", approvedAmount: 40000, note: "" }] }));
  assert.ok(upd.warnings.some((w) => w.includes("จะถูกแก้ตามชีท")));
  const multi = planImport(base({ projects, existingBudgets: [
    { id: "b2", projectId: "p-beta", period: "2026-02", approvedAmount: 40000, note: "" },
    { id: "b3", projectId: "p-beta", period: "2026-05", approvedAmount: 10000, note: "" },
  ] }));
  assert.ok(multi.warnings.some((w) => w.includes("ทุกเดือน")));
});

t("I: URL ซ้ำสองแถว แล้วแถวบนถูกลบจากชีท = แถวล่างยังเป็นคำขอเดิมของตัวเอง ไม่เลื่อนไปทับคำขอของแถวบน", () => {
  const s = seeded();
  assert.equal(s.importRows[1].rowKey.slice(0, -2), s.importRows[2].rowKey.slice(0, -2));
  const grid = EXPENSE.filter((_, i) => i !== 5);
  const plan = planImport(base({ ...s, expenses: parseExpenseTab(grid).rows, cancelMissing: true }));
  const kept = plan.expenses.find((e) => e.requestId === s.requests[2].id)!;
  assert.equal(kept.action, "same");
  assert.equal(kept.rowKey, s.importRows[2].rowKey);
  assert.equal(plan.summary.expensesUpdate, 0);
  assert.equal(plan.summary.expensesCreate, 0);
  assert.equal(plan.missing.length, 1);
  assert.equal(plan.missing[0].requestId, s.requests[1].id);
  assert.equal(plan.missing[0].action, "cancel");
});

t("I: URL ซ้ำสองแถว แล้วแถวบนถูกแก้ URL = แถวบนจับคู่คำขอเดิม (rekey) แถวล่างไม่ถูกแตะ", () => {
  const s = seeded();
  const grid = EXPENSE.map((r) => [...r]);
  grid[5][3] = "https://www.blt.example/moved/";
  const plan = planImport(base({ ...s, expenses: parseExpenseTab(grid).rows }));
  const top = plan.expenses.find((e) => e.row === 6)!;
  const bottom = plan.expenses.find((e) => e.row === 7)!;
  assert.equal(top.requestId, s.requests[1].id);
  assert.equal(top.rekeyFrom, s.importRows[1].rowKey);
  assert.equal(top.action, "update");
  assert.deepEqual(top.changes, ["URL"]);
  assert.equal(bottom.requestId, s.requests[2].id);
  assert.equal(bottom.action, "same");
  assert.equal(bottom.rowKey, s.importRows[2].rowKey);
  assert.equal(plan.summary.expensesCreate, 0);
  assert.equal(plan.summary.missing, 0);
});

t("I: URL เดียวกันในสองโปรเจกต์ แถวแรกถูกแก้ URL = แถวที่สองไม่ถูกย้ายโปรเจกต์/ราคา", () => {
  const head = EXPENSE.slice(0, 4);
  const rowA = [46058, "Alpha", "Alpha", "https://dup.example/post", "General", 3000, "a", "Published", ""];
  const rowB = [46060, "Beta Clinic", "Beta Clinic", "https://dup.example/post", "General", 2000, "b", "Published", ""];
  const projects = [
    { id: "p-alpha", name: "Alpha", clientName: "", manual: true },
    { id: "p-beta", name: "Beta Clinic", clientName: "", manual: true },
  ];
  const first = planImport(base({ projects, expenses: parseExpenseTab([...head, rowA, rowB]).rows }));
  assert.deepEqual(first.expenses.map((e) => e.rowKey), ["u|dup.example/post#0", "u|dup.example/post#1"]);
  const requests: ExistingRequest[] = first.expenses.map((e, i) => ({
    id: `d${i}`, projectId: i === 0 ? "p-alpha" : "p-beta", liveUrl: e.data!.liveUrl, status: "PUBLISHED",
    quotedPrice: e.data!.cost, actualPrice: e.data!.cost, anchorText: e.data!.anchorText,
    publishedAt: e.data!.publishedAt, budgetPeriod: e.data!.budgetPeriod,
  }));
  const importRows: ExistingImportRow[] = first.expenses.map((e, i) => ({ rowKey: e.rowKey, requestId: `d${i}`, lastStatus: "PUBLISHED" }));

  const moved = [...rowA];
  moved[3] = "https://dup.example/post-renamed";
  const plan = planImport(base({ projects, requests, importRows, expenses: parseExpenseTab([...head, moved, rowB]).rows }));
  const a = plan.expenses[0];
  const b = plan.expenses[1];
  assert.equal(b.requestId, "d1");
  assert.equal(b.action, "same");
  assert.equal(b.rowKey, "u|dup.example/post#1");
  assert.equal(a.requestId, "d0");
  assert.equal(a.rekeyFrom, "u|dup.example/post#0");
  assert.equal(a.rowKey, "u|dup.example/post-renamed#0");
  assert.equal(plan.summary.expensesCreate, 0);
  assert.equal(plan.summary.missing, 0);

  // แถวใหม่ที่ URL ซ้ำกับแถวจำที่ยังค้าง: ได้เลขที่ไม่ชนกับแถวจำเดิม
  const extra = [46070, "Alpha", "Alpha", "https://dup.example/post", "General", 999, "c", "Published", ""];
  const plan2 = planImport(base({ projects, requests, importRows, expenses: parseExpenseTab([...head, rowA, rowB, extra]).rows }));
  assert.deepEqual(plan2.expenses.map((e) => [e.action, e.rowKey]), [
    ["same", "u|dup.example/post#0"], ["same", "u|dup.example/post#1"], ["create", "u|dup.example/post#2"],
  ]);
});

t("จับคู่กับคำขอที่สร้างมือไว้ก่อน (URL + โปรเจกต์ตรง) ไม่สร้างซ้ำ", () => {
  const s = seeded();
  const manual: ExistingRequest = { id: "hand", projectId: "p-rads", liveUrl: "http://www.r.example/1/", status: "VERIFIED",
    quotedPrice: 1500, actualPrice: null, anchorText: "", publishedAt: "2026-06-08", budgetPeriod: "2026-06" };
  const requests = [...s.requests.filter((r) => r.projectId !== "p-rads"), manual];
  const importRows = s.importRows.filter((r) => !r.rowKey.startsWith("u|r.example"));
  const plan = planImport(base({ projects: s.projects, requests, importRows, update: false }));
  const row = plan.expenses.find((e) => e.rowKey.startsWith("u|r.example"))!;
  assert.equal(row.action, "link");
  assert.equal(row.requestId, "hand");
  assert.equal(plan.summary.expensesCreate, 0);
  // คำขอของโปรเจกต์อื่นที่ URL ตรงกัน = ไม่จับคู่
  const other = planImport(base({ projects: s.projects, requests: [...requests.filter((r) => r.id !== "hand"), { ...manual, projectId: "p-alpha" }], importRows }));
  assert.equal(other.expenses.find((e) => e.rowKey.startsWith("u|r.example"))!.action, "create");
});

t("Published ไม่มีราคา = นำเข้าเป็น 0 พร้อมคำเตือน, Status แปลก = ข้าม", () => {
  const grid: Grid = [EXPENSE[3], [46058, "A", "A", "https://a.example/1", "General", "", "", "Published", ""], [46058, "A", "A", "https://a.example/2", "General", 900, "", "Waiting", ""]];
  const plan = planImport(base({ budgets: [], expenses: parseExpenseTab(grid).rows }));
  const first = plan.expenses[0];
  assert.equal(first.action, "create");
  assert.equal(first.data!.cost, 0);
  assert.ok(first.warnings.some((w) => w.includes("ไม่มีราคา")));
  assert.equal(plan.expenses[1].skipReason, "other_status");
});

t("ช่อง Website ไม่ใช่ URL: เก็บข้อความไว้ และ key ใช้ข้อความนั้น", () => {
  const grid: Grid = [EXPENSE[3], [46058, "A", "A", "Facebook page โพสต์", "Other", 500, "", "Published", ""]];
  const plan = planImport(base({ budgets: [], expenses: parseExpenseTab(grid).rows }));
  const e = plan.expenses[0];
  assert.equal(e.data!.liveUrl, "");
  assert.equal(e.data!.site, "Facebook page โพสต์");
  assert.ok(e.rowKey.startsWith("s|a|facebookpage"));
});

t("แถวสรุปยอด (Total / รวม) ไม่ถูกนับเป็นโปรเจกต์", () => {
  const head = ["Client", "Project", "Initial Budget (THB)"];
  const b = parseBudgetTab([head, ["Alpha", "Alpha", 1000], ["", "TOTAL", 1000], ["Grand Total", "", 1000], ["รวม", "รวม", 1000], ["Total Fitness", "Total Fitness", 500]]);
  assert.deepEqual(b.rows.map((r) => r.project), ["Alpha", "Total Fitness"]);
  const ehead = ["Date", "Client", "Project", "Website / Media", "Type", "Cost (THB)", "Anchor Text", "Status", "Note"];
  const e = parseExpenseTab([ehead, [46058, "Alpha", "Alpha", "https://a.example/1", "General", 100, "", "Published", ""], ["", "", "รวมทั้งหมด", "", "", 100, "", "", ""]]);
  assert.equal(e.rows.length, 1);
  assert.equal(isTotalRow("", ""), false);
  assert.equal(isTotalRow("Alpha", "Total"), false);
});

t("sanitizeProjectMap: ทิ้งค่าที่ไม่ใช่ข้อความ", () => {
  assert.deepEqual(sanitizeProjectMap({ a: "x", b: 1, c: "", d: null, e: "new" }), { a: "x", e: "new" });
  assert.deepEqual(sanitizeProjectMap(["a"]), {});
  assert.deepEqual(sanitizeProjectMap(null), {});
});

console.log(`\n${n} tests passed`);
