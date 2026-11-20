// Reads one file (a slip image or a sales-document PDF) with the MarsOS AI provider.
//
// Every call goes through `orChat` in `@/lib/openrouter`: the MarsOS OpenRouter key and the
// MarsOS trace name (mars_<client>_<action>). The module has no AI key of its own.
//
// The model is always Gemini (see ocrModel below), the same model family the source system
// reads slips with. It does not follow OPENROUTER_MODEL_DEFAULT.
//
// The cost of every call, failed ones included, is written to the AIJob table so it shows
// on the AI Cost page under "LINE Tracking".
//
// Never throws: the callers (LINE webhook, PDF backfill) treat a failed read as "no data"
// and carry on.
import { prisma } from "@/lib/prisma";
import { orChat, type ORContentPart, type ORUsage } from "@/lib/openrouter";
import { clientSlugFromProject } from "@/lib/orClient";
import { logAIJob } from "@/lib/logAIJob";

const TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 8192;

/** The Gemini model that reads slips and sales documents when nothing else is configured. */
export const OCR_MODEL_DEFAULT = "google/gemini-3.7-flash";

/**
 * The model for slip and sales-document reading. Always a Gemini model.
 *
 * OPENROUTER_MODEL_DEFAULT is not consulted: it serves the rest of MarsOS and may be
 * pointed at another model family, which would silently change how slips are read.
 * LINE_TRACKING_OCR_MODEL may name another Gemini model on OpenRouter (for example a
 * larger one); a value that is not a Gemini model is ignored.
 */
export function ocrModel(env: Record<string, string | undefined> = process.env): string {
  const override = env.LINE_TRACKING_OCR_MODEL?.trim();
  return override && /^google\/gemini-/.test(override) ? override : OCR_MODEL_DEFAULT;
}

export type AiReadKind = "slip" | "quotation";

const KIND: Record<AiReadKind, { trace: string; jobType: string }> = {
  slip: { trace: "ocr_slip", jobType: "LINE_TRACKING_SLIP_OCR" },
  quotation: { trace: "ocr_quotation", jobType: "LINE_TRACKING_QUOTATION_OCR" },
};

/** Which LINE Tracking project the file belongs to. Used for the trace name and the cost record. */
export interface AiReadContext {
  projectId?: string;
}

export type AiReadResult = { ok: true; text: string } | { ok: false; text: string; error: string };

interface Owner {
  client: string | undefined;
  projectLabel: string;
  organizationId: string | null;
  createdById: string | null;
}

// AIJob needs an organization and a user. A file that arrives through the LINE webhook has
// no logged-in user, so the cost is booked to the staff member who created the project.
// A project without an owner falls back to the first active ADMIN.
async function resolveOwner(projectId: string | undefined): Promise<Owner> {
  let client: string | undefined;
  let projectLabel = "";
  let organizationId: string | null = null;
  let createdById: string | null = null;

  if (projectId) {
    const project = await prisma.ltProject.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, clientName: true, organizationId: true, createdById: true },
    });
    if (project) {
      client = clientSlugFromProject(project);
      projectLabel = project.name;
      organizationId = project.organizationId;
      createdById = project.createdById;
    }
  }

  if (!organizationId || !createdById) {
    const admin = await prisma.user.findFirst({
      where: { status: "ACTIVE", role: "ADMIN", organizationId: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { id: true, organizationId: true },
    });
    organizationId = organizationId ?? admin?.organizationId ?? null;
    createdById = createdById ?? admin?.id ?? null;
  }
  return { client, projectLabel, organizationId, createdById };
}

function filePart(kind: AiReadKind, data: Buffer, filename: string): ORContentPart {
  const base64 = data.toString("base64");
  if (kind === "quotation") {
    return { type: "file", file: { filename, file_data: `data:application/pdf;base64,${base64}` } };
  }
  return { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } };
}

export async function readFileWithAI(opts: {
  kind: AiReadKind;
  data: Buffer;
  filename: string;
  prompt: string;
  ctx?: AiReadContext;
}): Promise<AiReadResult> {
  const { trace, jobType } = KIND[opts.kind];
  const model = ocrModel();

  let owner: Owner = { client: undefined, projectLabel: "", organizationId: null, createdById: null };
  try {
    owner = await resolveOwner(opts.ctx?.projectId);
  } catch (err) {
    console.error("[line-tracking ai] could not resolve the project owner:", err);
  }

  let result: AiReadResult;
  let usage: ORUsage | undefined;
  try {
    const r = await orChat({
      trace,
      client: owner.client,
      model,
      messages: [
        {
          role: "user",
          content: [filePart(opts.kind, opts.data, opts.filename), { type: "text", text: opts.prompt }],
        },
      ],
      jsonMode: true,
      temperature: 0,
      maxTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: TIMEOUT_MS,
    });
    usage = r.usage;
    result = { ok: true, text: r.text };
  } catch (err) {
    // orChat attaches the usage to an "empty answer" error: that call is still billed.
    usage = (err as { usage?: ORUsage } | null)?.usage;
    const message = err instanceof Error ? err.message : String(err);
    result = { ok: false, text: "", error: `AI: ${message}` };
  }

  if (owner.organizationId && owner.createdById) {
    // AIJob.projectId points at an SEO project, so the LINE Tracking project goes in the summary.
    await logAIJob({
      organizationId: owner.organizationId,
      jobType,
      status: result.ok ? "SUCCESS" : "FAILED",
      modelProvider: "openrouter",
      modelName: model,
      tokenUsed: usage?.totalTokens,
      estimatedCost: usage?.costUsd,
      errorMessage: result.ok ? undefined : result.error,
      createdById: owner.createdById,
      inputSummary: [
        `LINE Tracking project: ${owner.projectLabel || "-"} (${opts.ctx?.projectId ?? "-"})`,
        `file: ${opts.filename} (${opts.data.length} bytes)`,
      ].join("\n"),
    });
  } else {
    console.warn("[line-tracking ai] cost not recorded: no organization or user to book it to", { jobType });
  }
  return result;
}
