// Rules for renaming a project (fixing a typo in its name). Pure, so it can be tested
// (projectRename.test.ts); renameProjectAction in actions.ts does the I/O.
//
// Three features are switched on by the project NAME, so a rename can turn one on or off.
// The plan reports that, and the action asks for a confirmation before saving.
import { isAutoPaidProject } from "./services/autoPaidProjects";
import { isConvertCakeProject } from "./services/convertCakeSheetPlan";
import { isStatusImportProject } from "./services/statusImportProjects";

export const PROJECT_NAME_MAX = 100;

export const PROJECT_NAME_FEATURES = ["AUTO_PAID", "STATUS_IMPORT", "CONVERT_CAKE_SHEET"] as const;
export type ProjectNameFeature = (typeof PROJECT_NAME_FEATURES)[number];

export const PROJECT_NAME_FEATURE_LABEL: Record<ProjectNameFeature, string> = {
  AUTO_PAID: "ปิดการขายเป็น PAID อัตโนมัติจากสลิป/PDF และสถานะ BOOKED (KOWA CCTV)",
  STATUS_IMPORT: "นำเข้าสถานะ Lead จากไฟล์รายชื่อลูกค้า (Mfactors)",
  CONVERT_CAKE_SHEET: "ซิงก์สถานะ Lead จาก Google Sheet ของ Convert Cake",
};

/** The name-keyed features a project with this name gets. */
export function projectNameFeatures(name: string): ProjectNameFeature[] {
  const project = { name };
  const on: Record<ProjectNameFeature, boolean> = {
    AUTO_PAID: isAutoPaidProject(project),
    STATUS_IMPORT: isStatusImportProject(project),
    CONVERT_CAKE_SHEET: isConvertCakeProject(project),
  };
  return PROJECT_NAME_FEATURES.filter((f) => on[f]);
}

export type ProjectRenameError = "empty" | "too_long";

export const PROJECT_RENAME_ERROR_TEXT: Record<ProjectRenameError, string> = {
  empty: "กรุณาใส่ชื่อโปรเจกต์",
  too_long: `ชื่อโปรเจกต์ยาวได้ไม่เกิน ${PROJECT_NAME_MAX} ตัวอักษร`,
};

export type ProjectRenamePlan =
  | { kind: "error"; code: ProjectRenameError }
  | { kind: "unchanged" }
  | { kind: "rename"; name: string; turnsOn: ProjectNameFeature[]; turnsOff: ProjectNameFeature[] };

/**
 * What saving `rawName` over `currentName` would do. The new name is trimmed; a name that
 * is the same after trimming is "unchanged". turnsOn / turnsOff list the name-keyed features
 * the rename would switch.
 */
export function planProjectRename(currentName: string, rawName: unknown): ProjectRenamePlan {
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) return { kind: "error", code: "empty" };
  if (Array.from(name).length > PROJECT_NAME_MAX) return { kind: "error", code: "too_long" };
  if (name === currentName) return { kind: "unchanged" };
  const before = projectNameFeatures(currentName);
  const after = projectNameFeatures(name);
  return {
    kind: "rename",
    name,
    turnsOn: after.filter((f) => !before.includes(f)),
    turnsOff: before.filter((f) => !after.includes(f)),
  };
}

/** True when the rename switches a name-keyed feature and so needs a confirmation. */
export function renameNeedsConfirm(plan: ProjectRenamePlan): boolean {
  return plan.kind === "rename" && plan.turnsOn.length + plan.turnsOff.length > 0;
}
