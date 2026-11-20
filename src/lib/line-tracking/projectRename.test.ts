import assert from "node:assert/strict";
import { test } from "node:test";
import { PROJECT_NAME_MAX, planProjectRename, projectNameFeatures, renameNeedsConfirm } from "./projectRename";

test("a typo fix is a plain rename, trimmed", () => {
  const plan = planProjectRename("Projct Q3", "  Project Q3  ");
  assert.deepEqual(plan, { kind: "rename", name: "Project Q3", turnsOn: [], turnsOff: [] });
  assert.equal(renameNeedsConfirm(plan), false);
});

test("an empty or missing name is refused", () => {
  assert.deepEqual(planProjectRename("Project Q3", "   "), { kind: "error", code: "empty" });
  assert.deepEqual(planProjectRename("Project Q3", null), { kind: "error", code: "empty" });
  assert.deepEqual(planProjectRename("Project Q3", undefined), { kind: "error", code: "empty" });
});

test("the length limit counts characters, Thai included", () => {
  assert.equal(planProjectRename("x", "ก".repeat(PROJECT_NAME_MAX)).kind, "rename");
  assert.deepEqual(planProjectRename("x", "ก".repeat(PROJECT_NAME_MAX + 1)), { kind: "error", code: "too_long" });
});

test("the same name (after trimming) changes nothing", () => {
  assert.deepEqual(planProjectRename("Project Q3", "Project Q3"), { kind: "unchanged" });
  assert.deepEqual(planProjectRename("Project Q3", " Project Q3 "), { kind: "unchanged" });
});

test("a change of letter case only is still a rename", () => {
  assert.deepEqual(planProjectRename("project q3", "Project Q3"), { kind: "rename", name: "Project Q3", turnsOn: [], turnsOff: [] });
});

test("name-keyed features are read from the name", () => {
  assert.deepEqual(projectNameFeatures("KOWA  CCTV"), ["AUTO_PAID"]);
  assert.deepEqual(projectNameFeatures("Mfactors"), ["STATUS_IMPORT"]);
  assert.deepEqual(projectNameFeatures("Convert Cake"), ["CONVERT_CAKE_SHEET"]);
  assert.deepEqual(projectNameFeatures("Project Q3"), []);
});

test("fixing a typo into a special name turns the feature on and needs a confirmation", () => {
  const plan = planProjectRename("KOWA CTV", "KOWA CCTV");
  assert.deepEqual(plan, { kind: "rename", name: "KOWA CCTV", turnsOn: ["AUTO_PAID"], turnsOff: [] });
  assert.equal(renameNeedsConfirm(plan), true);
});

test("renaming away from a special name turns the feature off and needs a confirmation", () => {
  for (const [from, feature] of [["Kowa CCTV", "AUTO_PAID"], ["MFactors", "STATUS_IMPORT"], ["ConvertCake", "CONVERT_CAKE_SHEET"]] as const) {
    const plan = planProjectRename(from, `${from} (old)`);
    assert.deepEqual(plan, { kind: "rename", name: `${from} (old)`, turnsOn: [], turnsOff: [feature] });
    assert.equal(renameNeedsConfirm(plan), true);
  }
});

test("a rename that keeps the same special name needs no confirmation", () => {
  const plan = planProjectRename("kowa cctv", "KOWA CCTV");
  assert.deepEqual(plan, { kind: "rename", name: "KOWA CCTV", turnsOn: [], turnsOff: [] });
  assert.equal(renameNeedsConfirm(plan), false);
  assert.equal(renameNeedsConfirm(planProjectRename("Convert Cake", "Convert-Cake")), false);
});

test("one rename can switch one feature off and another on", () => {
  assert.deepEqual(planProjectRename("Mfactors", "Convert Cake"), {
    kind: "rename",
    name: "Convert Cake",
    turnsOn: ["CONVERT_CAKE_SHEET"],
    turnsOff: ["STATUS_IMPORT"],
  });
});
