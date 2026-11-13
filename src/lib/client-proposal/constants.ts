// No server-only imports: this file is imported by client components.

/** Article statuses a CLIENT can see in the Review tab and act on. */
export const CLIENT_REVIEW_VISIBLE = ["SEO_REVIEW", "REVIEWING", "REVIEW", "CLIENT_REVIEW", "CLIENT_REVISION", "APPROVED", "ARTICLE_DONE"] as const;
/** Statuses where the article is waiting on the client, i.e. the server accepts "approve". */
export const CLIENT_AWAITING = ["REVIEW", "CLIENT_REVIEW"] as const;
/** Block tags a client may edit (leaf blocks only). */
export const PROPOSAL_BLOCK_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "td", "th", "blockquote", "figcaption", "summary"] as const;
/** ArticleVersion.changeNote prefix that marks a row as a client proposal, not a real version. */
export const PROPOSAL_NOTE_PREFIX = "CLIENT_PROPOSAL";
export const PROPOSAL_LIMITS = { maxEdits: 300, maxTextChars: 20000, maxSectionChars: 300, maxCommentChars: 5000, maxPayloadChars: 400000 } as const;

export interface ProposalEdit { i: number; tag: string; section: string; before: string; after: string }
export type ProposalStatus = "pending" | "superseded" | "resolved" | "dismissed";
export interface ProposalView {
  id: string; status: ProposalStatus; createdAt: string;
  author: { name: string | null }; comment: string; baseUpdatedAt: string | null; edits: ProposalEdit[];
}
