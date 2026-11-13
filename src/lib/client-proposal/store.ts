import {
  PROPOSAL_BLOCK_TAGS,
  PROPOSAL_LIMITS,
  PROPOSAL_NOTE_PREFIX,
  type ProposalEdit,
  type ProposalStatus,
} from "./constants";

/** Version readers must exclude proposal rows. changeNote is nullable, so NOT LIKE alone would drop NULL rows. */
export const NOT_PROPOSAL_WHERE = {
  OR: [{ changeNote: null }, { NOT: { changeNote: { startsWith: PROPOSAL_NOTE_PREFIX } } }],
};

const STATUSES: ProposalStatus[] = ["pending", "superseded", "resolved", "dismissed"];

export function proposalNote(status: ProposalStatus): string {
  return `${PROPOSAL_NOTE_PREFIX}:${status}`;
}

export function parseProposalStatus(changeNote: string | null | undefined): ProposalStatus | null {
  if (!changeNote || !changeNote.startsWith(`${PROPOSAL_NOTE_PREFIX}:`)) return null;
  const s = changeNote.slice(PROPOSAL_NOTE_PREFIX.length + 1) as ProposalStatus;
  return STATUSES.includes(s) ? s : null;
}

export interface ProposalPayload { v: 1; baseUpdatedAt: string | null; comment: string; edits: ProposalEdit[] }

export function parseProposalPayload(outline: string | null | undefined): ProposalPayload | null {
  if (!outline) return null;
  try {
    const o = JSON.parse(outline);
    if (!o || typeof o !== "object" || !Array.isArray(o.edits)) return null;
    const edits: ProposalEdit[] = [];
    for (const e of o.edits) {
      if (!e || typeof e !== "object") return null;
      if (!Number.isInteger(e.i) || typeof e.tag !== "string" || typeof e.section !== "string"
        || typeof e.before !== "string" || typeof e.after !== "string") return null;
      edits.push({ i: e.i, tag: e.tag, section: e.section, before: e.before, after: e.after });
    }
    return {
      v: 1,
      baseUpdatedAt: typeof o.baseUpdatedAt === "string" ? o.baseUpdatedAt : null,
      comment: typeof o.comment === "string" ? o.comment : "",
      edits,
    };
  } catch {
    return null;
  }
}

const strip = (s: string) => s.replace(/\0/g, "");

export type ProposalInput =
  | { ok: true; edits: ProposalEdit[]; comment: string; baseUpdatedAt: string | null }
  | { ok: false; status: 400 | 413; error: string };

export function validateProposalInput(body: unknown): ProposalInput {
  const bad = (error: string): ProposalInput => ({ ok: false, status: 400, error });
  if (!body || typeof body !== "object") return bad("ข้อมูลไม่ถูกต้อง");
  const b = body as Record<string, unknown>;
  const L = PROPOSAL_LIMITS;

  if (!Array.isArray(b.edits) || b.edits.length < 1 || b.edits.length > L.maxEdits) {
    return bad(`จำนวนจุดที่แก้ต้องอยู่ระหว่าง 1 ถึง ${L.maxEdits} จุด`);
  }
  const seen = new Set<number>();
  const edits: ProposalEdit[] = [];
  for (const raw of b.edits) {
    if (!raw || typeof raw !== "object") return bad("ข้อมูลการแก้ไขไม่ถูกต้อง");
    const e = raw as Record<string, unknown>;
    if (typeof e.i !== "number" || !Number.isInteger(e.i) || e.i < 0 || e.i > 5000 || seen.has(e.i)) {
      return bad("ข้อมูลการแก้ไขไม่ถูกต้อง");
    }
    if (typeof e.tag !== "string" || !(PROPOSAL_BLOCK_TAGS as readonly string[]).includes(e.tag)) {
      return bad("ข้อมูลการแก้ไขไม่ถูกต้อง");
    }
    if (typeof e.section !== "string" || typeof e.before !== "string" || typeof e.after !== "string") {
      return bad("ข้อมูลการแก้ไขไม่ถูกต้อง");
    }
    const section = strip(e.section), before = strip(e.before), after = strip(e.after);
    if (section.length > L.maxSectionChars) return bad("ข้อมูลการแก้ไขไม่ถูกต้อง");
    if (before.length > L.maxTextChars || after.length > L.maxTextChars) {
      return bad(`ข้อความแต่ละจุดยาวเกิน ${L.maxTextChars} ตัวอักษร`);
    }
    if (before === after) return bad("ข้อมูลการแก้ไขไม่ถูกต้อง");
    seen.add(e.i);
    edits.push({ i: e.i, tag: e.tag, section, before, after });
  }

  let comment = "";
  if (b.comment !== undefined && b.comment !== null) {
    if (typeof b.comment !== "string") return bad("ข้อความถึงทีมไม่ถูกต้อง");
    comment = strip(b.comment).trim();
    if (comment.length > L.maxCommentChars) return bad(`ข้อความถึงทีมยาวเกิน ${L.maxCommentChars} ตัวอักษร`);
  }
  let baseUpdatedAt: string | null = null;
  if (b.baseUpdatedAt !== undefined && b.baseUpdatedAt !== null) {
    if (typeof b.baseUpdatedAt !== "string") return bad("ข้อมูลไม่ถูกต้อง");
    baseUpdatedAt = strip(b.baseUpdatedAt);
  }

  if (JSON.stringify({ v: 1, baseUpdatedAt, comment, edits }).length > L.maxPayloadChars) {
    return { ok: false, status: 413, error: "ข้อเสนอแก้ไขมีขนาดใหญ่เกินไป กรุณาส่งเป็นหลายรอบ" };
  }
  return { ok: true, edits, comment, baseUpdatedAt };
}
