import type { Ga4Config } from "@/lib/line-tracking/connectors";
import type { SendContext, SendResult } from "./senderTypes";
import { gaSessionFor } from "@/lib/line-tracking/browserIds";

// Statuses that represent a monetary purchase and need a transaction_id.
const PURCHASE_EVENTS = new Set(["purchase", "deal_won"]);

/**
 * Build the GA4 Measurement Protocol payload.
 * Rule: never send raw personal data (no phone/email/name). We use IDs only.
 *
 * GA4 has no parameter that sets source / medium / campaign on a Measurement Protocol event.
 * The only way an event gets them is by joining the visitor's web session: the client_id
 * must be the one GA itself gave the browser, and session_id must be that session's id.
 * Without both, GA4 files the event under "Unassigned" / "(not set)". `source`, `campaign`
 * and `keyword` below are plain event parameters for custom dimensions, nothing more.
 *
 * `measurementId` picks the session of that stream; an id from another stream is never sent.
 */
export function buildGa4Payload(ctx: SendContext, measurementId?: string, now: Date = new Date()) {
  const { lead, eventName, value, currency, projectId, click } = ctx;

  // The click row is refreshed when the visitor presses the LINE button, by which time the
  // GA cookie exists; the copy on the lead was taken at page load and is often empty.
  const clientId = click?.gaClientId || lead.gaClientId || `lead.${lead.id}`;
  const sessionId = gaSessionFor(click?.gaSessions, measurementId, now);
  const params: Record<string, unknown> = {
    currency,
    value,
    project_id: projectId,
    lead_id: lead.id,
    source: lead.source ?? undefined,
    campaign: lead.campaign ?? undefined,
    keyword: lead.keyword ?? undefined,
  };
  if (sessionId) {
    params.session_id = sessionId;
    // GA4 asks for both before it shows the event in Realtime and counts it in the session.
    params.engagement_time_msec = 1;
  }
  if (PURCHASE_EVENTS.has(eventName) || eventName === "purchase") {
    params.transaction_id = lead.purchaseId || `txn.${lead.id}`;
  }

  const payload: Record<string, unknown> = {
    client_id: clientId,
    events: [{ name: eventName, params }],
  };
  // user_id from lineUserId when available (pseudonymous, not PII).
  if (lead.lineUserId) payload.user_id = lead.lineUserId;

  return payload;
}

/**
 * Send to GA4 via Measurement Protocol. REAL sender when measurementId +
 * apiSecret are configured; otherwise returns a mock/skipped result.
 */
export async function sendGa4(
  config: Ga4Config,
  ctx: SendContext
): Promise<SendResult> {
  const payload = buildGa4Payload(ctx, config.measurementId);
  const real = !!(config.measurementId && config.apiSecret);

  if (!real) {
    return {
      ok: true,
      mock: true,
      request: payload,
      response: { note: "GA4 credentials not set — logged in mock mode", status: 0 },
    };
  }

  const url =
    `https://www.google-analytics.com/mp/collect` +
    `?measurement_id=${encodeURIComponent(config.measurementId!)}` +
    `&api_secret=${encodeURIComponent(config.apiSecret!)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    // GA4 MP returns 204 No Content on success (no body).
    const text = await res.text().catch(() => "");
    const ok = res.status === 204 || res.status === 200;
    return {
      ok,
      mock: false,
      request: payload,
      response: { status: res.status, body: text || "(empty)" },
      error: ok ? undefined : `GA4 responded ${res.status}: ${text}`,
    };
  } catch (err) {
    return {
      ok: false,
      mock: false,
      request: payload,
      response: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * GA4 Debug validation endpoint — used by the Test Connection action.
 */
export async function testGa4(config: Ga4Config): Promise<{ ok: boolean; message: string }> {
  if (!config.measurementId || !config.apiSecret) {
    return { ok: false, message: "ต้องกรอก Measurement ID และ API Secret" };
  }
  const url =
    `https://www.google-analytics.com/debug/mp/collect` +
    `?measurement_id=${encodeURIComponent(config.measurementId)}` +
    `&api_secret=${encodeURIComponent(config.apiSecret)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: "test.connection",
        events: [{ name: "test_event", params: { debug: true } }],
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      validationMessages?: { description?: string }[];
    };
    const msgs = json.validationMessages ?? [];
    if (msgs.length === 0) return { ok: true, message: "GA4 ตอบรับ payload ถูกต้อง" };
    return { ok: false, message: msgs.map((m) => m.description).join("; ") };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
