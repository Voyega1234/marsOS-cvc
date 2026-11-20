import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { stringifyJson } from "@/lib/line-tracking/json";
import { upsertLineUser, verifyLineSignature, fetchLineProfile, downloadLineContent } from "@/lib/line-tracking/services/lineService";
import { upsertLeadFromClick, changeLeadStatus } from "@/lib/line-tracking/services/leadService";
import { processQueue, enqueueBlockConversion } from "@/lib/line-tracking/services/conversionQueueService";
import { ocrSlip } from "@/lib/line-tracking/services/ocrService";
import { readQuotationPdf, MAX_QUOTATION_PDF_BYTES } from "@/lib/line-tracking/services/quotationService";
import { applySalesDocument, isAutoPaidProject, kowaSlipTargetStatus } from "@/lib/line-tracking/services/salesDocumentService";
import { LEAD_STATUS_LABEL, type LeadStatus } from "@/lib/line-tracking/enums";
import { getConnectionConfig } from "@/lib/line-tracking/services/connectionStore";
import { claimOnce, pruneClaims, CLAIM_RETENTION_SECONDS } from "@/lib/line-tracking/services/claim";
import type { LineConfig } from "@/lib/line-tracking/connectors";
import type { LtProject as Project } from "@prisma/client";

// The answer to LINE goes out at once; the work that follows (profile, AI reading of slips
// and PDFs, conversions) keeps running under waitUntil and needs the time.
export const maxDuration = 300;

/**
 * LINE Messaging webhook endpoint (per project).
 * Stores the raw event, links/creates a LINE user + Lead when a userId is present.
 *
 * TIMING: LINE drops the connection if the webhook does not answer within ~1s
 * ("A timeout occurred when sending a webhook event object" on Verify, and
 * silently dropped events in production). So this handler does the bare minimum
 * on the critical path — verify the signature, then ACK 200 immediately — and
 * hands every slow step (profile lookup, lead upsert, OCR, conversion dispatch)
 * to waitUntil(), which keeps the serverless function alive after the response.
 */
/**
 * Version probe. LINE only ever POSTs here, so GET was previously a 405 and there
 * was no way — short of Vercel dashboard access — to tell whether a deployment
 * actually carries the ACK-first handler or the old one that ran everything before
 * responding. Opening this URL in a browser answers that in one second.
 *
 * Deliberately touches nothing: no DB, no config, no projectId lookup — so it
 * leaks nothing and stays fast even if the database is down.
 */
export function GET() {
  return NextResponse.json({
    handler: "line-webhook",
    ack: "immediate + waitUntil",
    version: 2,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  // Read the RAW body first — required for signature verification.
  const rawBody = await req.text();

  // Both lookups are keyed by projectId, so they run in parallel — one DB
  // round-trip of latency instead of two before we can answer LINE.
  const [project, lineConfig] = await Promise.all([
    prisma.ltProject.findUnique({ where: { id: projectId } }),
    getConnectionConfig<LineConfig>(projectId, "LINE"),
  ]);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  // ── นโยบายปัจจุบัน: "ไม่ปฏิเสธเพราะลายเซ็น" (เจ้าของระบบสั่งไว้ 3 ส.ค. 2026) ──────
  // เดิมที่นี่ตอบ 401 เมื่อไม่มี Channel Secret หรือลายเซ็นไม่ตรง ผลคือ event จริงจาก
  // LINE ถูกตีตกด้วย (เคสจริง 3 ส.ค. 07:21 "signature rejected" ทั้งที่ใช้งานได้มาก่อน)
  // ตอนนี้จึง **ไม่ตีกลับ** อีกต่อไป — ยังคำนวณลายเซ็นและบันทึกผลไว้ทุกครั้ง เพื่อให้
  // ยังเห็นได้ว่า event ไหนยืนยันตัวตนได้จริง event ไหนแค่ "รับไว้โดยไม่ยืนยัน"
  const validSignature = lineConfig.messagingChannelSecret
    ? verifyLineSignature(
        lineConfig.messagingChannelSecret,
        rawBody,
        req.headers.get("x-line-signature")
      )
    : false;

  // ── Option 2 shape #5/#6: relay ที่ส่งลายเซ็นต่อไม่ได้ ─────────────────────
  // ตัวกลางบางตัวของลูกค้า (LINE ตั้ง webhook ชี้ไปที่ตัวกลาง แล้วตัวกลาง forward
  // ต่อมาที่เรา) ตัด header x-line-signature ทิ้ง หรือ re-serialize body ใหม่ —
  // ทั้งสองกรณีลายเซ็นของ LINE ใช้ยืนยันไม่ได้อีกต่อไป ไม่ว่าจะทำอะไรฝั่งเรา
  // ถ้าไม่มีทางเลือกอื่น ระบบก็รับ event ของลูกค้ากลุ่มนี้ไม่ได้เลย
  //
  // ทางออกที่ยังปลอดภัย: ความลับที่ "เรา" เป็นคนออกให้ ไม่ใช่ของ LINE —
  // relayToken สุ่มต่อโปรเจกต์ ลูกค้าเอาไปแปะท้าย URL ที่ตั้งในตัวกลาง
  //   https://<โดเมน>/api/webhooks/line/<projectId>?k=<relayToken>
  // (ส่งมาทาง header x-marsos-webhook-token ก็ได้ ถ้าตัวกลางตัด query string)
  //
  // ความปลอดภัยไม่ได้ลดลงจากเดิม: โปรเจกต์ที่ไม่ได้ตั้ง relayToken จะไม่มีทางเข้า
  // เส้นทางนี้เลย (พฤติกรรมเข้มเหมือนเดิมเป๊ะ) และ token เทียบแบบ constant-time
  // ป้องกันการเดาทีละไบต์ ผู้ที่ไม่รู้ token ยังยิงปลอมไม่ได้เหมือนเดิม
  // อ่านแบบ cast ตั้งใจ — เพื่อให้ไฟล์นี้ "วางทับไฟล์เดียวก็บิลด์ผ่าน" โดยไม่ต้องรอ
  // ให้ type `LineConfig` มีฟิลด์ relayToken ก่อน (ค่าถูกเก็บใน connection config JSON
  // อยู่แล้ว) ถ้าลงแพ็กเกจเต็มซึ่งมีฟิลด์นี้ในหน้าตั้งค่า โค้ดตรงนี้ก็ทำงานเหมือนเดิม
  const relayToken = ((lineConfig as { relayToken?: string }).relayToken ?? "").trim();
  const presentedToken =
    (new URL(req.url).searchParams.get("k") ?? req.headers.get("x-marsos-webhook-token") ?? "").trim();
  // เทียบเป็น "ไบต์" ไม่ใช่ "ตัวอักษร" — timingSafeEqual จะ throw ถ้าความยาวบัฟเฟอร์
  // ไม่เท่ากัน และ token ที่มีอักขระ non-ASCII จะยาวเป็นไบต์ไม่เท่ากับความยาว string
  // (ถ้าเช็คด้วย .length จะกลายเป็น 500 บน endpoint สาธารณะ = ช่องให้ยิงให้พังได้)
  const presentedBuf = Buffer.from(presentedToken, "utf8");
  const relayBuf = Buffer.from(relayToken, "utf8");
  const validRelayToken =
    !validSignature &&
    relayToken.length >= 16 &&
    presentedBuf.length === relayBuf.length &&
    timingSafeEqual(presentedBuf, relayBuf);

  if (!validSignature && !validRelayToken) {
    // ยืนยันไม่ได้ แต่ "รับไว้" — บันทึกให้ครบว่าทำไมยืนยันไม่ได้ จะได้ตามต้นทางเจอ
    // และถ้าวันหนึ่งอยากกลับมาเปิดการปฏิเสธอีกครั้งก็มีข้อมูลพอ (มี header มั้ย,
    // fingerprint ของลายเซ็นที่ส่งมาเทียบกับของ secret ที่ตั้งไว้, ใครยิงมา, body ต้น ๆ)
    // เก็บ body แบบจำกัดความยาว และเก็บลายเซ็นเป็น fingerprint ไม่ใช่ค่าเต็ม
    const sig = req.headers.get("x-line-signature");
    // Same as Mercy (owner 2026-11-20, so both apps are set up the same way): unverified
    // events are accepted and logged, except in a project that has turned on
    // "reject events that cannot be verified" itself (requireVerified = "on").
    // Risk accepted by the owner: whoever knows a projectId can post fake events.
    // บันทึกเป็น REJECTED (ไม่เก็บ body) เพื่อไม่ให้ event ปลอมไปโผล่ในงานที่อ่าน log ย้อนหลัง
    if (lineConfig.requireVerified === "on") {
      waitUntil(
        logWebhook(
          project.id,
          {
            note: "rejected: requireVerified is on",
            hasSignatureHeader: !!sig,
            relayTokenPresented: presentedToken.length > 0,
            userAgent: req.headers.get("user-agent"),
            forwardedFor: req.headers.get("x-forwarded-for"),
          },
          "REJECTED",
          "ปฏิเสธ event — ยืนยันไม่ได้ว่ามาจาก LINE (โปรเจกต์นี้เปิดโหมดปฏิเสธ event ที่ยืนยันไม่ได้)"
        )
      );
      return NextResponse.json({ error: "signature not verified" }, { status: 401 });
    }
    waitUntil(
      logWebhook(
        project.id,
        {
          note: "signature not verified (accepted anyway)",
          hasSignatureHeader: !!sig,
          signatureFingerprint: sig ? sig.slice(0, 8) : null,
          expectedFingerprint: lineConfig.messagingChannelSecret
            ? createHash("sha256").update(lineConfig.messagingChannelSecret).digest("hex").slice(0, 8)
            : null,
          userAgent: req.headers.get("user-agent"),
          forwardedFor: req.headers.get("x-forwarded-for"),
          contentType: req.headers.get("content-type"),
          bodyBytes: Buffer.byteLength(rawBody, "utf8"),
          rawBodyPreview: rawBody.slice(0, 2000),
          relayTokenConfigured: relayToken.length >= 16,
          relayTokenPresented: presentedToken.length > 0,
        },
        "SUCCESS",
        sig
          ? "รับ event ไว้แล้วแต่ยืนยันลายเซ็นไม่ได้ — มีลายเซ็นมาแต่ไม่ตรงกับ Channel Secret ของโปรเจกต์นี้ (คนละ channel หรือมีตัวกลางแก้ body)"
          : "รับ event ไว้แล้วแต่ยืนยันลายเซ็นไม่ได้ — ไม่มี header x-line-signature ส่งมาเลย (ตัวกลาง/เครื่องมือที่ forward ไม่ได้ส่ง header ต่อ)"
      )
    );
    // เดิม return 401 ตรงนี้ — ถอดออกตามที่เจ้าของระบบสั่ง event จะถูกประมวลผลต่อ
  }

  if (validRelayToken) {
    // ยืนยันด้วย relay token ไม่ใช่ลายเซ็นของ LINE — บันทึกไว้ให้เห็นชัดว่า
    // event ชุดนี้เชื่อถือได้ในระดับ "ใครถือ token" ไม่ใช่ "LINE เซ็นมาเอง"
    waitUntil(
      logWebhook(project.id, { note: "verified via relay token (ไม่มีลายเซ็น LINE)" }, "SUCCESS")
    );
  }

  let body: unknown;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    body = {};
  }

  // ACK now, work later. Everything below this line used to run before the
  // response and is what pushed the handler past LINE's timeout.
  waitUntil(
    processAfterAck(project, lineConfig, rawBody, body, {
      signature: req.headers.get("x-line-signature"),
      retryKey: req.headers.get("x-line-retry-key"),
    })
  );
  return NextResponse.json({ ok: true });
}

/**
 * Post-ACK work, gated by a loop/duplicate guard.
 *
 * Why the guard: several LINE tools in the wild (lineutm.com is the one hit
 * here) are themselves relays — they receive the event and forward it on to
 * another webhook URL. If that URL is us AND we are in relay mode pointing back
 * at them, the same event ping-pongs between the two systems: confirmed live on
 * Convert Cake, where one event produced three inbound requests ~0.8s apart
 * until lineutm answered HTTP 508 Loop Detected. Each lap re-ran handleEvents,
 * so conversions would have been fired three times.
 *
 * The guard claims each event exactly once by hashing the raw body — a real
 * LINE payload carries a unique webhookEventId + timestamp, so identical bytes
 * inside the window always mean the same event coming back around (or a LINE
 * retry, which we also do not want to process twice). Both the forward and the
 * event handling sit behind it, so a loop dies after the first lap no matter how
 * the other system is configured.
 */
async function processAfterAck(
  project: Project,
  lineConfig: LineConfig,
  rawBody: string,
  body: unknown,
  headers: { signature: string | null; retryKey: string | null }
) {
  const fresh = await claimEvent(project.id, rawBody);
  if (!fresh) {
    await logWebhook(project.id, { note: "duplicate/loop — ข้ามรอบนี้" }, "SUCCESS");
    return;
  }

  // Option 2 (relay): the customer already ran a bot on this channel before we
  // took over the (single) webhook slot — pass every verified event through to
  // the bot's original URL so it keeps working. Off the critical path: LINE has
  // its ~1s timeout, the customer's bot can be arbitrarily slow.
  // cast ด้วยเหตุผลเดียวกับ relayToken ด้านบน — ให้ไฟล์นี้วางทับไฟล์เดียวแล้วบิลด์ผ่าน
  // ไม่ว่า type `LineConfig` ในโปรเจกต์จะมีสองฟิลด์นี้แล้วหรือยัง
  const relayCfg = lineConfig as { webhookMode?: string; forwardUrl?: string };
  if (relayCfg.webhookMode === "relay" && relayCfg.forwardUrl) {
    await forwardToClientBot(project.id, relayCfg.forwardUrl, rawBody, headers);
  }

  await handleEvents(project, lineConfig, body);
}

/** How long the same raw payload is treated as already-seen. */
const DEDUPE_WINDOW_SECONDS = 300;

/**
 * Largest image handed to the AI model. A photo sent in a LINE chat is far below this; a
 * larger one would be refused by the model after the upload was already paid for.
 */
const MAX_SLIP_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Returns true when this call is the first to claim the payload, false when it
 * has already been claimed inside the window.
 *
 * Race-free by construction: the decision IS the INSERT, so two concurrent laps
 * of a loop landing on two serverless instances cannot both win. If the table
 * cannot be reached at all we fail OPEN — dropping real leads would be worse than the loop we are guarding
 * against, and the loop still terminates on the far side's own protection.
 */
async function claimEvent(projectId: string, rawBody: string): Promise<boolean> {
  const key = `${projectId}:${createHash("sha256").update(rawBody).digest("hex")}`;
  const fresh = await claimOnce(key, DEDUPE_WINDOW_SECONDS);
  // Keep the table small without a cron: prune on ~2% of webhooks.
  if (Math.random() < 0.02) await pruneClaims();
  return fresh;
}

/**
 * True the first time a LINE message is about to be read by AI, false when it was read
 * before. LINE can deliver the same event again with `deliveryContext.isRedelivery` set:
 * the bytes differ, so the payload guard above lets it through, and without this check the
 * slip or the PDF would be sent to the AI model, and billed, a second time.
 */
function claimMessageRead(projectId: string, messageId: string): Promise<boolean> {
  return claimOnce(`${projectId}:msg:${messageId}`, CLAIM_RETENTION_SECONDS);
}

/**
 * Relay the raw event to the customer's original bot (webhookMode "relay").
 * MUST send rawBody byte-for-byte — X-Line-Signature is HMAC-SHA256 over the raw
 * bytes with the channel secret, and the destination bot verifies with that same
 * secret (same channel). Re-serializing the JSON would change the bytes and break
 * verification. We have already ACKed LINE with 200, so LINE will NOT retry on a
 * forward failure — retry here, then surface the failure in WebhookLog so it
 * shows up in the setup page's webhook panel instead of only in Vercel logs.
 */
async function forwardToClientBot(
  projectId: string,
  forwardUrl: string,
  rawBody: string,
  headers: { signature: string | null; retryKey: string | null }
) {
  let target: URL;
  try {
    target = new URL(forwardUrl);
  } catch {
    await logWebhook(projectId, { note: `forward: URL ไม่ถูกต้อง` }, "FAILED",
      `Forward ไม่สำเร็จ — Webhook URL เดิมของลูกค้าไม่ใช่ URL ที่ถูกต้อง (${forwardUrl})`);
    return;
  }
  // Guard 1: https only. Guard 2: never forward into a LINE-hub webhook endpoint
  // (ours or any deployment of this app) — that would loop events back into us.
  if (target.protocol !== "https:" || target.pathname.includes("/api/webhooks/line")) {
    await logWebhook(projectId, { note: "forward: URL ไม่ผ่านเงื่อนไข" }, "FAILED",
      "Forward ไม่สำเร็จ — Webhook เดิมของลูกค้าต้องเป็น https และห้ามชี้กลับมาที่ระบบนี้เอง");
    return;
  }

  const post = (url: URL) =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(headers.signature ? { "x-line-signature": headers.signature } : {}),
        ...(headers.retryKey ? { "x-line-retry-key": headers.retryKey } : {}),
      },
      body: rawBody,
      // Never let fetch follow a redirect on its own: 301/302/303 downgrade POST
      // to GET, which drops the body and with it the signature. 307/308 are the
      // two that MUST preserve method + body, so we re-POST those ourselves (once)
      // — that alone covers the single most common misconfiguration, an http→https
      // or apex→www hop. Confirmed live: https://lineutm.com/main_webhook answers
      // 308 to https://www.lineutm.com/... and every forward failed until the URL
      // was corrected.
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });

  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      let res = await post(target);
      if ((res.status === 307 || res.status === 308) && res.headers.get("location")) {
        const next = new URL(res.headers.get("location")!, target);
        if (next.protocol === "https:" && !next.pathname.includes("/api/webhooks/line")) {
          res = await post(next);
        }
      }
      if (res.ok) return;
      lastError =
        res.status === 508
          ? "HTTP 508 Loop Detected — ปลายทาง forward กลับมาที่ระบบนี้อีกที (ตั้ง forward ชนกันสองทาง)"
          : `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  await logWebhook(projectId, { note: `forward → ${target.origin} ล้มเหลว` }, "FAILED",
    `Forward ไป webhook เดิมของลูกค้าไม่สำเร็จ (${lastError}) — บอทลูกค้าไม่ได้รับ event รอบนี้ (ฝั่ง tracking ของเราได้รับปกติ)`);
}

/** Best-effort webhook audit row — never throws into the request path. */
async function logWebhook(
  projectId: string,
  payload: unknown,
  status: "SUCCESS" | "FAILED" | "REJECTED",
  errorMessage?: string
) {
  try {
    await prisma.webhookLog.create({
      data: {
        projectId,
        source: "LINE",
        payload: stringifyJson(payload),
        status,
        ...(errorMessage ? { errorMessage } : {}),
      },
    });
  } catch {
    // Logging must never break webhook handling.
  }
}

/**
 * Everything that used to run inline before the 200. Runs after the response
 * via waitUntil, so its duration no longer counts against LINE's timeout.
 */
async function handleEvents(project: Project, lineConfig: LineConfig, body: unknown) {
  const events = (body as { events?: LineEvent[] })?.events ?? [];
  let processed = 0;
  const failures: string[] = [];

  try {
    for (const event of events) {
      // Each event is isolated: one failure (OCR error, DB conflict) used to abort the
      // rest of the batch, and since LINE was already ACKed those events were lost.
      try {
        const lineUserId = event?.source?.userId;
        if (!lineUserId) continue;

        // unfollow / block → mark blocked, keep the lead + history for reporting.
        if (event.type === "unfollow") {
          const lu = await prisma.lineUser.findFirst({
            where: { projectId: project.id, lineUserId },
            include: { leads: { orderBy: { createdAt: "desc" }, take: 1 } },
          });
          await prisma.lineUser.updateMany({
            where: { projectId: project.id, lineUserId },
            data: { friendStatus: "BLOCKED", blockedAt: new Date() },
          });
          // Fire a `line_block` event to GA4 so the full funnel (add→…→block) is
          // visible. Block is a churn signal — GA4 only, not ad platforms.
          const lead = lu?.leads[0];
          if (lead) {
            await prisma.leadStatusHistory.create({
              data: { leadId: lead.id, newStatus: lead.status, changedBy: "LINE", note: "🚫 ลูกค้าบล็อก OA" },
            });
            // Fire a `line_block` conversion to EVERY connected platform that defines a
            // blockEvent (GA4 + Meta/TikTok/LINE Ads/Snapchat) — so you can measure which
            // campaign/channel drives OA blocks, not just see it in GA4.
            await enqueueBlockConversion(lead);
          }
          processed++;
          continue;
        }

        // Enrich with the LINE display name + picture (follow events omit them).
        const profile = lineConfig.messagingAccessToken
          ? await fetchLineProfile(lineConfig.messagingAccessToken, lineUserId)
          : null;

        // follow / message → ensure friend + lead exists.
        // message = "engaged" layer (customer actually talked to us). lastMessageAt goes
        // into the same write as the profile, not a second update.
        const isMessage = event.type === "message";
        const lineUser = await upsertLineUser({
          projectId: project.id,
          lineUserId,
          displayName: profile?.displayName,
          pictureUrl: profile?.pictureUrl,
          lastMessageAt: isMessage ? new Date() : undefined,
        });

        const { lead } = await upsertLeadFromClick({
          projectId: project.id,
          lineUserId: lineUser.id,
          clickId: null,
          displayName: profile?.displayName ?? null,
          defaultValue: project.defaultConversionValue,
          currency: project.currency,
        });

        // First inbound message → bump NEW → CONTACTED, which fires GA4 `contact`.
        if (isMessage && lead.status === "NEW") {
          await changeLeadStatus(lead.id, "CONTACTED", {
            changedBy: "LINE (first message)",
            note: "ลูกค้าทักครั้งแรก",
          });
        }

        // Image message = likely a payment slip → OCR the amount (sales confirms).
        // Split the "is this an image message" check from the "can we actually OCR
        // it" check so every image message logs SOMETHING — previously a missing
        // messageId or access token silently skipped the whole block with zero log
        // output, indistinguishable from OCR never being invoked at all.
        if (isMessage && event.message?.type === "image") {
          if (!event.message.id) {
            console.error("[line-webhook] slip OCR: image message missing message.id", { projectId: project.id });
          } else if (!lineConfig.messagingAccessToken) {
            console.error("[line-webhook] slip OCR: no messagingAccessToken configured for project", { projectId: project.id, messageId: event.message.id });
          } else if (!(await claimMessageRead(project.id, event.message.id))) {
            console.warn("[line-webhook] slip OCR: message already read, skipped", { projectId: project.id, messageId: event.message.id });
          } else {
            const img = await downloadLineContent(lineConfig.messagingAccessToken, event.message.id);
            if (!img) {
              console.error("[line-webhook] slip OCR: image download failed", { projectId: project.id, messageId: event.message.id });
            } else if (img.length > MAX_SLIP_IMAGE_BYTES) {
              console.error("[line-webhook] slip OCR: image too large, skipped", { projectId: project.id, messageId: event.message.id, bytes: img.length });
            } else {
              const ocr = await ocrSlip(img, "slip.jpg", { projectId: project.id });
              if (!ocr.ok) {
                console.error("[line-webhook] slip OCR failed:", ocr.error, { projectId: project.id, messageId: event.message.id });
              } else {
                // Auto-fill from the slip — amount + (best-effort) name/phone. Only fill
                // empty fields; sales still confirms everything before marking PAID.
                const data: Record<string, unknown> = {};
                const notes: string[] = [];
                // KOWA: the slip also moves the lead (900 → BOOKED, other amounts → PAID).
                // Re-read the status: the first-message bump above may have changed it.
                const kowa = isAutoPaidProject(project);
                const currentStatus = kowa
                  ? ((await prisma.lead.findUnique({ where: { id: lead.id }, select: { status: true } }))?.status ?? lead.status) as LeadStatus
                  : null;
                if (ocr.amount) {
                  data.slipAmount = ocr.amount; data.slipCheckedAt = new Date();
                  // A KOWA quotation already set the deal value (lead is PAID) — keep it.
                  if (currentStatus !== "PAID") data.value = ocr.amount;
                  notes.push(`ยอด ${ocr.amount.toLocaleString()} ${lead.currency}`);
                }
                if (ocr.phone && !lead.phone) { data.phone = ocr.phone; notes.push(`เบอร์ ${ocr.phone}`); }
                if (ocr.name && !lead.fullName) { data.fullName = ocr.name; notes.push(`ชื่อ ${ocr.name}`); }
                // Soft signal from Gemini only — not a real authenticity check, just
                // an extra flag so sales looks twice before confirming PAID.
                if (ocr.suspicious) {
                  notes.push(`⚠️ ต้องตรวจสอบ: ${ocr.suspiciousReason || "ระบบสงสัยว่าอาจเป็นสลิปที่ถูกตัดต่อ/แก้ไข"}`);
                  console.error("[line-webhook] slip OCR: suspicious slip flagged", { projectId: project.id, messageId: event.message.id, reason: ocr.suspiciousReason });
                }
                if (Object.keys(data).length) {
                  await prisma.lead.update({ where: { id: lead.id }, data });
                }
                const target = currentStatus && ocr.amount ? kowaSlipTargetStatus(currentStatus, ocr.amount, Boolean(ocr.suspicious)) : null;
                const slipNote = `📎 ได้รับสลิป — อ่านให้อัตโนมัติ: ${notes.join(" · ")}`;
                if (target) {
                  // Value is already written, so the queued conversion carries the slip amount.
                  await changeLeadStatus(lead.id, target, {
                    changedBy: "OCR (Gemini)",
                    note: `${slipNote} → อัปเดตเป็น ${LEAD_STATUS_LABEL[target]} อัตโนมัติ`,
                  });
                } else if (notes.length) {
                  await prisma.leadStatusHistory.create({
                    data: {
                      leadId: lead.id, newStatus: currentStatus ?? lead.status, changedBy: "OCR (Gemini)",
                      note: kowa && ocr.suspicious
                        ? `${slipNote} (สลิปน่าสงสัย ระบบไม่เปลี่ยนสถานะให้ — ทีมตรวจสอบแล้วเปลี่ยนสถานะเอง)`
                        : `${slipNote} (เซลส์ตรวจสอบก่อนกด PAID)`,
                    },
                  });
                } else {
                  console.error("[line-webhook] slip OCR ok but extracted nothing usable", { projectId: project.id, messageId: event.message.id, text: ocr.text?.slice(0, 300) });
                }
              }
            }
          }
        }

        // PDF file message = likely a sales document (quotation / invoice / receipt) →
        // read document number, total and buyer. Slip images keep using the image branch
        // above. By default nothing changes status: sales confirms before moving the lead
        // on. Auto-PAID projects (see salesDocumentService) instead move straight to PAID
        // (Purchase), which also sends the purchase conversion with the document amount.
        if (isMessage && event.message?.type === "file" && /\.pdf$/i.test(event.message.fileName ?? "")) {
          const fileName = event.message.fileName ?? "document.pdf";
          if (!event.message.id) {
            console.error("[line-webhook] sales PDF: file message missing message.id", { projectId: project.id });
          } else if (!lineConfig.messagingAccessToken) {
            console.error("[line-webhook] sales PDF: no messagingAccessToken configured for project", { projectId: project.id, messageId: event.message.id });
          } else if ((event.message.fileSize ?? 0) > MAX_QUOTATION_PDF_BYTES) {
            console.error("[line-webhook] sales PDF: file too large, skipped", { projectId: project.id, messageId: event.message.id, fileSize: event.message.fileSize });
          } else if (!(await claimMessageRead(project.id, event.message.id))) {
            console.warn("[line-webhook] sales PDF: message already read, skipped", { projectId: project.id, messageId: event.message.id });
          } else {
            const pdf = await downloadLineContent(lineConfig.messagingAccessToken, event.message.id);
            if (!pdf) {
              console.error("[line-webhook] sales PDF: download failed", { projectId: project.id, messageId: event.message.id });
            } else {
              const q = await readQuotationPdf(pdf, fileName, { projectId: project.id });
              if (!q.ok) {
                console.error("[line-webhook] sales PDF read failed:", q.error, { projectId: project.id, messageId: event.message.id });
              } else if (q.docType === "other") {
                console.error("[line-webhook] sales PDF: not a quotation/invoice/receipt, skipped", { projectId: project.id, messageId: event.message.id, fileName });
              } else {
                // Re-read: the first-message bump or a slip in this batch may have changed the lead.
                const fresh = (await prisma.lead.findUnique({ where: { id: lead.id } })) ?? lead;
                await applySalesDocument({ project, lead: fresh, q, fileName, messageId: event.message.id });
              }
            }
          }
        }
        processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${event.type ?? "?"}: ${msg}`);
        console.error("[line-webhook] event failed, continuing with the rest of the batch:", err, { projectId: project.id, type: event.type });
      }
    }

    // Flush the queue so generate_lead / contact are sent right away.
    await processQueue({ projectId: project.id });

    await logWebhook(project.id, body, failures.length ? "FAILED" : "SUCCESS", failures.length ? failures.join(" | ") : undefined);
    return processed;
  } catch (err) {
    await logWebhook(
      project.id,
      body,
      "FAILED",
      err instanceof Error ? err.message : String(err)
    );
    // Already ACKed to LINE — surface in logs + WebhookLog, nothing to return to.
    console.error("[line-webhook] background processing failed:", err);
    return 0;
  }
}

interface LineEvent {
  type?: string;
  source?: { userId?: string };
  message?: { type?: string; id?: string; text?: string; fileName?: string; fileSize?: number };
}
