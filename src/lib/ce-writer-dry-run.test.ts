/**
 * Run Test ต้องบอกตรงกับ prompt จริง และการแยก helper ต้องไม่เปลี่ยน prompt ของโปรเจกต์เดิม
 * Run: npx tsx src/lib/ce-writer-dry-run.test.ts
 */
import {
  buildClientCommentsBlock,
  clientCommentsValidatorNote,
  emptyClientComments,
  joinPromptBlocks,
  type ClientCommentsContext,
} from "./ce-client-comments";
import { commentsLayerStatus, restrictionsLayerStatus } from "./ce-layer-status";
import {
  buildRestrictionsBlock,
  emptyRestrictions,
  restrictionsValidatorNote,
  type RestrictionFile,
  type RestrictionFileKind,
  type RestrictionsContext,
  type RestrictionsData,
} from "./ce-restrictions";
import { buildWriterDryRun, sentPrefixLength, type WriterDryRunInput } from "./ce-writer-dry-run";
import { buildWriterSystemPrompt, buildWriterUserPrompt, composeWriterConstraints } from "./upload-article/writer";
import type { UploadKeyword } from "./upload-article/types";

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
}

const layer = (name: string, text: string) => ({ id: name, name, version: 1, text });
const ce: WriterDryRunInput["ce"] = {
  businessSkill: layer("Skill ลูกค้า", "MARKER_BUSINESS"),
  masterPrompt: layer("Master", "MARKER_MASTER"),
  articleBrief: layer("Brief", "MARKER_BRIEF"),
  validatorPack: layer("Validator", "MARKER_VALIDATOR"),
  imagePrompt: layer("Image", "MARKER_IMAGE"),
  missing: [],
};
const keyword: UploadKeyword = {
  id: "k1",
  keyword: "เก็บ NK cell",
  title: "เก็บ NK cell ที่ไหนดี",
  slug: "nk-cell",
  intent: "",
  articleType: "",
  note: "MARKER_NOTE",
  createdAt: "2026-11-05T00:00:00.000Z",
};
const file = (id: string, kind: RestrictionFileKind, text: string): RestrictionFile => ({
  id,
  name: `${id}.txt`,
  text,
  meta: { kind, chars: text.length, size: text.length },
});
const restrictionsCtx = (data: Partial<RestrictionsData>, files: RestrictionFile[] = []): RestrictionsContext => ({
  rowId: "r",
  data: { ...emptyRestrictions(), ...data },
  files,
});
const commentsCtx = (text: string, files: RestrictionFile[] = []): ClientCommentsContext => ({
  rowId: "c",
  data: { status: "Active", comments: text ? [{ id: "c1", text, date: "2026-11-05", enabled: true }] : [] },
  files,
});
const run = (over: Partial<WriterDryRunInput> = {}) =>
  buildWriterDryRun({ target: "upload", ce, restrictions: null, clientComments: null, keyword, ...over });
const stateOf = (r: ReturnType<typeof run>, key: string) => r.layers.find((l) => l.key === key)?.state;

// ทุก layer ที่ตั้งไว้ต้องถึง prompt จริง และสถานะต้องตรง
{
  const r = run({
    restrictions: restrictionsCtx({ bannedTerms: "MARKER_BANNED", rules: "MARKER_RULE" }),
    clientComments: commentsCtx("MARKER_COMMENT"),
    links: [{ keyword: "MARKER_ANCHOR", url: "https://example.com/a" }],
  });
  const all = `${r.systemPrompt}\n${r.userPrompt}`;
  for (const m of ["BUSINESS", "MASTER", "BRIEF", "VALIDATOR", "BANNED", "RULE", "COMMENT", "NOTE", "ANCHOR"]) {
    assert(all.includes(`MARKER_${m}`), `${m} ต้องอยู่ใน prompt`);
  }
  assert(!all.includes("MARKER_IMAGE"), "Image Prompt ไม่ได้ส่งตอนเขียนเนื้อหา");
  for (const k of ["master", "business", "brief", "restrictions", "comments", "validator", "note", "voice", "structure", "links"]) {
    assert(stateOf(r, k) === "sent", `${k} ต้องเป็น sent`);
  }
  assert(stateOf(r, "image") === "later", "Image Prompt = ใช้ขั้นอื่น");
  assert(r.canWrite && r.promptExact, "Upload ครบ = เขียนได้ และ prompt ตรงตัว");
  assert(r.userPrompt.split("\n")[1].includes("ข้อจำกัด / Comment จากลูกค้า / Validator Pack"), "user prompt ต้องสั่งให้ทำตามข้อจำกัดและ Comment");
  assert(r.steps.some((s) => s.inTest) && r.steps.some((s) => !s.inTest), "ต้องแยกขั้นที่ Run Test ทำกับขั้นตอนเขียนจริง");
}

// ไม่มีข้อจำกัดและ Comment = prompt ของโปรเจกต์เดิมเท่าเดิมทุกตัวอักษร
{
  const r = run();
  const legacySystem = buildWriterSystemPrompt({ masterPrompt: "MARKER_MASTER", businessSkill: "MARKER_BUSINESS", articleBrief: "MARKER_BRIEF", validatorPack: "MARKER_VALIDATOR" });
  assert(r.systemPrompt === legacySystem, "system prompt ต้องเท่าเดิม");
  assert(
    r.userPrompt.split("\n")[1] === "เขียนบทความ SEO เต็มบทความ 1 ชิ้น ตาม Business Skill / Master Prompt / Article Brief / Validator Pack ด้านบนอย่างเคร่งครัด",
    "บรรทัดแรก user prompt ต้องเท่าเดิม",
  );
  assert(buildWriterUserPrompt({ keyword, links: [] }) === buildWriterUserPrompt({ keyword, links: [], constraintLayers: [] }), "layer ว่างต้องไม่เปลี่ยน user prompt");
  assert(stateOf(r, "restrictions") === "off" && stateOf(r, "comments") === "off", "ไม่ได้ตั้ง = off");
}

// helper ใหม่ต้องได้ผลเท่านิพจน์เดิมใน write route
{
  const restrictions = restrictionsCtx({ bannedTerms: "หายขาด => ดีขึ้น", rules: "ห้ามรับประกันผล" });
  const clientComments = commentsCtx("ห้ามเปรียบเทียบคู่แข่ง");
  const topic = { keyword: keyword.keyword, title: keyword.title, outline: keyword.note, relatedProductIds: [] };
  const c = composeWriterConstraints({ restrictions, clientComments, topic });
  assert(c.restrictions === joinPromptBlocks(buildRestrictionsBlock(restrictions, topic), buildClientCommentsBlock(clientComments, topic)), "บล็อกต้องเท่านิพจน์เดิม");
  assert(c.restrictionsNote === joinPromptBlocks(restrictionsValidatorNote(restrictions), clientCommentsValidatorNote(clientComments)), "note ต้องเท่านิพจน์เดิม");
  assert(c.layerNames.join() === "ข้อจำกัด,Comment จากลูกค้า", "ชื่อ layer ตามที่มีเนื้อหา");
  assert(composeWriterConstraints({ restrictions: null, clientComments: null, topic }).layerNames.length === 0, "ไม่มีข้อมูล = ไม่มีชื่อ layer");
}

// รายงานไฟล์: ตรงหัวข้อ = ส่ง · ไม่ตรง = ไม่ส่ง พร้อมเหตุผล
{
  const relevant = file("nk", "reference", "ข้อมูล NK cell สำหรับการเก็บ ".repeat(5));
  const unrelated = file("car", "reference", "ราคารถยนต์ไฟฟ้ารุ่นใหม่ ".repeat(5));
  const r = run({ restrictions: restrictionsCtx({}, [relevant, unrelated]) });
  const nk = r.files.find((f) => f.id === "nk");
  const car = r.files.find((f) => f.id === "car");
  assert(nk?.status === "whole" && nk.sentChars > 0, "ไฟล์ตรงหัวข้อต้องถูกส่ง");
  assert(car?.status === "none" && car.sentChars === 0, "ไฟล์ไม่ตรงหัวข้อต้องไม่ถูกส่ง");
  assert(Boolean(car?.reason.includes("ไม่มีส่วนไหนตรง")), "ต้องบอกเหตุผล");
  assert(r.warnings.some((w) => w.text.includes("car.txt")), "ต้องเตือนไฟล์ที่ไม่ถูกส่ง");
}

// ไฟล์ Comment สั้นต้องส่งครบ แม้ไม่ตรงหัวข้อ
{
  const r = run({ clientComments: commentsCtx("", [file("note", "comment", "MARKER_COMMENT_FILE ปรับน้ำเสียงให้เป็นกลาง")]) });
  assert(r.files[0]?.status === "whole", "ไฟล์ Comment สั้นต้องส่งครบ");
  assert(r.systemPrompt.includes("MARKER_COMMENT_FILE"), "ข้อความไฟล์ต้องอยู่ใน prompt");
}

// คำต้องห้ามเกินงบ: นับตามจริง และบอกว่ายังตรวจหลังเขียน
{
  const bannedTerms = Array.from({ length: 2000 }, (_, i) => `คำต้องห้ามลำดับที่${i}`).join("\n");
  const r = run({ restrictions: restrictionsCtx({ bannedTerms }) });
  const detail = r.layers.find((l) => l.key === "restrictions")?.details.join() ?? "";
  assert(/ส่ง [\d,]+\/2,000 คำ/.test(detail) && !detail.includes("ส่ง 2,000/2,000"), "ต้องนับคำที่ถูกตัด");
  assert(detail.includes("ตรวจทุกคำหลังเขียน"), "ต้องบอกว่ายังตรวจหลังเขียน");
}

// คำเตือน: ขาด layer / แม่แบบ / ตัวแปรค้าง / keyword ติดคำห้าม / โหลดพัง / ไฟล์ค้างตอน layer ปิด
{
  const missing = run({ ce: { ...ce, validatorPack: null, missing: ["Validator Pack"] } });
  assert(!missing.canWrite && missing.missing.includes("Validator Pack") && stateOf(missing, "validator") === "missing", "ขาด layer ต้องเขียนไม่ได้");
  assert(run({ ce: { ...ce, businessSkill: layer("แม่แบบ Business Skill (โครงมาตรฐาน)", "x") } }).warnings.some((w) => w.text.includes("แม่แบบ")), "ต้องเตือนแม่แบบ");
  assert(run({ ce: { ...ce, masterPrompt: layer("M", "สวัสดี {{client_name}}") } }).warnings.some((w) => w.text.includes("{{client_name}}")), "ต้องเตือนตัวแปรค้าง");
  assert(run({ restrictions: restrictionsCtx({ bannedTerms: "NK cell" }) }).warnings.some((w) => w.level === "warn"), "keyword ติดคำห้ามต้องเตือน");
  assert(run({ loadErrors: { comments: "db down" } }).warnings.some((w) => w.level === "error" && w.text.includes("db down")), "โหลดพังต้องบอก");
  const blocked = run({ uploadedFiles: { restrictions: 3, comments: 1 } });
  assert(blocked.warnings.filter((w) => w.text.includes("ไม่ถูกส่ง")).length === 2, "ไฟล์ค้างตอน layer ปิดต้องเตือน");
}

// SEO: ต้องมี Image Prompt และต้องบอกว่า prompt เป็นแค่โครง
{
  const noImage = buildWriterDryRun({ target: "seo", ce: { ...ce, imagePrompt: null }, restrictions: null, clientComments: null, keyword });
  assert(!noImage.canWrite && noImage.missing.includes("Image Prompt"), "SEO ไม่มี Image Prompt = เขียนไม่ได้");
  const seo = buildWriterDryRun({ target: "seo", ce, restrictions: restrictionsCtx({ rules: "MARKER_RULE" }), clientComments: commentsCtx("MARKER_COMMENT"), keyword });
  assert(seo.canWrite && !seo.promptExact, "SEO = โครง");
  assert(seo.systemPrompt.includes("MARKER_RULE") && seo.systemPrompt.includes("MARKER_COMMENT"), "SEO ต้องมีข้อจำกัดและ Comment");
  assert(seo.systemPrompt.indexOf("LAYER 1") < seo.systemPrompt.indexOf("LAYER 4"), "SEO เรียงตามลำดับ layer");
}

// sentPrefixLength วัดข้อความที่ถูก clip จากท้าย
assert(sentPrefixLength("กขคงจ", "x กขคงจ y") === 5, "ครบ");
{
  const long = "กฎข้อที่หนึ่งของลูกค้า ".repeat(10);
  assert(sentPrefixLength(long, `x ${long.slice(0, 60)}\n…(ตัด)`) === 60, "ถูกตัดท้าย");
  assert(sentPrefixLength(long, "กฎข้อ") === 0, "ต้นข้อความบังเอิญซ้ำ ไม่นับ");
  assert(sentPrefixLength("กขคงจ", "ไม่เกี่ยว") === 0, "ไม่มีเลย");
}

// ชิปสถานะใช้กติกาเดียวกับตัวโหลด
{
  const row = (type: string, promptText: string, description: string | null = null, id = type) => ({ id, name: id, type, isActive: true, promptText, description });
  const fileRow = (id: string, kind: string, group?: string) => row("CE_RESTRICTION_FILE", "", JSON.stringify({ kind, chars: 1, size: 1, group }), id);
  assert(restrictionsLayerStatus([]).state === "off" && commentsLayerStatus([]).state === "off", "ไม่มีแถว = off");
  const on = restrictionsLayerStatus([row("CE_RESTRICTIONS", JSON.stringify({ status: "Active", bannedTerms: "หายขาด\nรักษาได้" })), fileRow("a", "reference", "g"), fileRow("b", "reference", "g")]);
  assert(on.state === "on" && on.detail.includes("คำห้าม 2") && on.detail.includes("ไฟล์ 1"), "แถว Active: นับคำ และนับไฟล์ที่แบ่งส่วนเป็นไฟล์เดียว");
  const draft = restrictionsLayerStatus([row("CE_RESTRICTIONS", JSON.stringify({ status: "Draft", bannedTerms: "ก" })), fileRow("a", "rules")]);
  assert(draft.state === "blocked" && draft.detail.includes("ไม่ถูกส่ง"), "Draft + ไฟล์ = เตือนว่าไฟล์ไม่ถูกส่ง");
  assert(restrictionsLayerStatus([fileRow("a", "rules")]).state === "blocked", "ยังไม่บันทึก + ไฟล์ = เตือน");
  assert(restrictionsLayerStatus([fileRow("a", "comment")]).state === "off", "ไฟล์ Comment ไม่นับเป็นข้อจำกัด");
  assert(commentsLayerStatus([fileRow("a", "rules")]).state === "off", "ไฟล์ข้อจำกัดไม่นับเป็น Comment");
  const comments = commentsLayerStatus([row("CE_CLIENT_COMMENTS", JSON.stringify({ status: "Active", comments: [{ id: "1", text: "ก", enabled: true }, { id: "2", text: "ข", enabled: false }] })), fileRow("a", "comment")]);
  assert(comments.state === "on" && comments.detail.includes("1 ข้อ") && comments.detail.includes("ไฟล์ 1"), "Comment นับเฉพาะที่เปิด");
  assert(emptyClientComments().comments.length === 0, "ค่าเริ่มต้นว่าง");
}

console.log(`ce-writer-dry-run: ${passed} assertions passed`);
