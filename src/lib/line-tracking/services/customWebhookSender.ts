import { createHmac } from "crypto";
import type { CustomWebhookConfig } from "@/lib/line-tracking/connectors";
import type { SendContext, SendResult } from "./senderTypes";
import { safeFetch, SafeFetchError } from "@/lib/line-tracking/safeFetch";

/** Header that carries the HMAC-SHA256 signature of the request body. */
export const SIGNATURE_HEADER = "x-marsos-signature";

/**
 * Generic outbound conversion webhook — lets a customer receive MarsOS conversion
 * events in their own system (CRM, data warehouse, Make/n8n scenario) instead of
 * only through the built-in ad platforms.
 */
export function buildCustomPayload(_config: CustomWebhookConfig, ctx: SendContext) {
  const { lead, click, eventName, value, currency, projectId, projectName } = ctx;
  return {
    event: eventName,
    sent_at: new Date().toISOString(),
    project: { id: projectId, name: projectName },
    lead: {
      id: lead.id,
      status: lead.status,
      line_user_id: lead.lineUserId ?? null,
      click_id: lead.clickId,
      source: lead.source,
      campaign: lead.campaign,
      keyword: lead.keyword,
      channel: lead.channel,
      channel_group: lead.channelGroup,
      gclid: lead.gclid,
      fbclid: lead.fbclid,
      ttclid: lead.ttclid,
      msclkid: lead.msclkid,
      twclid: lead.twclid,
      scclid: lead.scclid,
      ga_client_id: lead.gaClientId ?? click?.gaClientId ?? null,
      gbraid: click?.gbraid ?? null,
      wbraid: click?.wbraid ?? null,
      fbp: click?.fbp ?? null,
      fbc: click?.fbc ?? null,
      ttp: click?.ttp ?? null,
      line_click_id: click?.lineClickId ?? null,
      line_browser_id: click?.lineBrowserId ?? null,
      scid: click?.scid ?? null,
      ga_sessions: click?.gaSessions ?? null,
      landing_url: click?.landingUrl ?? null,
      referrer: click?.referrer ?? null,
      user_agent: click?.userAgent ?? null,
      clicked_at: click?.clickedAt ?? null,
      created_at: lead.createdAt,
    },
    value,
    currency,
    order_id: lead.purchaseId || lead.id,
  };
}

/** Hostnames/IPs that must never be reachable from a tenant-configured URL. */
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^\[?::1\]?$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./, // cloud instance metadata
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /\.internal$/i,
  /\.local$/i,
];

/**
 * Reject non-HTTPS and obviously-internal destinations up front, with a friendly
 * Thai error message. This is only a cheap first screen — the actual outbound
 * request always goes through `safeFetch`, which resolves DNS itself, rejects
 * private/loopback/link-local/metadata addresses (IPv4 and IPv6), pins the
 * validated address for the connection (defeating DNS rebinding), and
 * re-validates every redirect hop the same way.
 */
export function validateDestination(rawUrl: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: "Destination URL ไม่ถูกต้อง" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "Destination URL ต้องเป็น https:// เท่านั้น" };
  }
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(url.hostname))) {
    return { ok: false, error: "ปลายทางนี้เป็นที่อยู่ภายในเครือข่าย ใช้ไม่ได้" };
  }
  return { ok: true, url };
}

function parseHeaders(raw?: string): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      // Never let a configured header override the ones we control.
      if (/^(host|content-type|content-length|x-marsos-signature)$/i.test(k)) continue;
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Request headers: configured ones first, then ours on top so they can never be overridden. */
export function buildCustomHeaders(config: CustomWebhookConfig, body: string): Record<string, string> {
  const headers: Record<string, string> = { ...parseHeaders(config.headersJson) };
  headers["content-type"] = "application/json";
  if (config.signingSecret) {
    headers[SIGNATURE_HEADER] = createHmac("sha256", config.signingSecret).update(body).digest("hex");
  }
  return headers;
}

export async function sendCustomWebhook(
  config: CustomWebhookConfig,
  ctx: SendContext
): Promise<SendResult> {
  const request = buildCustomPayload(config, ctx);

  if (!config.destinationUrl) {
    return {
      ok: true,
      mock: true,
      request,
      response: { note: "Custom webhook mock mode · ยังไม่ได้ตั้ง Destination URL" },
    };
  }

  const dest = validateDestination(config.destinationUrl);
  if (!dest.ok) {
    return { ok: false, mock: false, request, response: null, error: dest.error };
  }

  const body = JSON.stringify(request);
  const headers = buildCustomHeaders(config, body);

  try {
    const res = await safeFetch(dest.url.toString(), {
      method: "POST",
      headers,
      body,
      timeoutMs: 10_000,
    });
    // Only a truncated excerpt is kept — never the full body — and nothing
    // beyond what safeFetch itself already capped is ever read into memory.
    const text = await res.text().catch(() => "");
    return {
      ok: res.ok,
      mock: false,
      request,
      response: { status: res.status, body: text.slice(0, 1000) },
      error: res.ok ? undefined : `ปลายทางตอบกลับ ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      mock: false,
      request,
      response: null,
      error: err instanceof SafeFetchError ? err.message : err instanceof Error ? err.message : String(err),
    };
  }
}
