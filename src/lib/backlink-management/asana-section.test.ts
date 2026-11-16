/** Run: npx tsx src/lib/backlink-management/asana-section.test.ts */
import assert from "node:assert/strict";
import { normalizeSectionName, pickOffPageSection } from "./asana-section";

let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log("ok -", name); }

const clicx = [
  { gid: "1", name: "Foundation & Audit" },
  { gid: "2", name: "On-Page SEO" },
  { gid: "3", name: "Off-Page SEO" },
  { gid: "4", name: "Content" },
];

t("normalize ignores case, spaces, hyphens and dashes", () => {
  for (const v of ["Off-Page SEO", "off page seo", "OFFPAGE SEO", "Off–Page  SEO", "Off_Page.SEO", " off-page-seo "]) {
    assert.equal(normalizeSectionName(v), "offpageseo", v);
  }
});
t("picks Off-Page SEO, not the first section", () => { assert.equal(pickOffPageSection(clicx), "3"); });
t("On-Page SEO is not mistaken for Off-Page", () => {
  assert.equal(pickOffPageSection([{ gid: "2", name: "On-Page SEO" }, { gid: "1", name: "Foundation & Audit" }]), null);
});
t("exact match beats a looser one listed earlier", () => {
  assert.equal(pickOffPageSection([{ gid: "9", name: "Off-Page backlog" }, { gid: "3", name: "off page seo" }]), "3");
});
t("loose match when no exact name", () => {
  assert.equal(pickOffPageSection([{ gid: "1", name: "Foundation & Audit" }, { gid: "7", name: "Off-Page SEO / Backlinks" }]), "7");
});
t("no sections or junk -> null", () => {
  assert.equal(pickOffPageSection([]), null);
  assert.equal(pickOffPageSection(undefined as never), null);
  assert.equal(pickOffPageSection([{ gid: "", name: "Off-Page SEO" }, { gid: "5", name: null }]), null);
});

console.log(`\n${n} passed`);
