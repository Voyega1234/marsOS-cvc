import { createHash } from "crypto";
import type { LineAdsConfig } from "@/lib/line-tracking/connectors";
import type { SendContext, SendResult } from "./senderTypes";

// LINE Conversion API v1 (the server-side counterpart of the LINE Tag).
// Docs: https://conversion-api-docs.linebiz.com/en/
//   POST https://conversion-api.tr.line.me/v1/{line_tag_id}/events
//   X-Line-TagAccessToken: <token issued in LINE Business Manager for the tag>
//   X-Line-ChannelID: <channel id>   (required whenever user.line_uid is sent)
// The body is a JSON ARRAY of events, not an object.
const LINE_CONVERSION_API = "https://conversion-api.tr.line.me/v1";

/**
 * LINE only accepts ^[A-Za-z0-9_-]{1,20}$ as an event name, while our
 * conversion mapping lets the customer type anything (Thai included). Fold the
 * name into the allowed shape instead of letting LINE reject the whole event.
 */
export function lineEventName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "_").replace(/_{2,}/g, "_").slice(0, 20);
  return cleaned.replace(/^_+|_+$/g, "") || "Conversion";
}

// Field shapes from the API schema. LINE rejects the WHOLE request (400) when one
// field is malformed, so a value that does not fit is left out instead of sent:
// the event then still matches on the identifiers that are valid.
const LINE_UID_RE = /^U[0-9a-f]{32}$/;
const LINE_CLICK_ID_RE = /^[A-Za-z0-9_-]{1,512}$/;
const LINE_BROWSER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINE_EXTERNAL_ID_RE = /^[0-9A-Za-z_-]{1,512}$/;
const LINE_CURRENCY_RE = /^[A-Z]{3}$/;
const LINE_VALUE_MAX = 2147483647;

const fits = (re: RegExp, v: string | null | undefined): string | undefined =>
  v && re.test(v) ? v : undefined;

/**
 * deduplication_key must match ^[0-9a-zA-Z_-]{1,256}$, and our event names are free
 * text (Thai included). Hash the name: two different names never share a key, and the
 * key stays the same on a retry so LINE counts the conversion once.
 */
export function lineDedupKey(leadId: string, eventName: string): string {
  const lead = leadId.replace(/[^0-9A-Za-z_-]/g, "").slice(0, 200) || "lead";
  return `${lead}_${createHash("sha256").update(eventName).digest("hex").slice(0, 16)}`;
}

/**
 * Build a LINE Conversion API v1 event.
 *
 * `line_uid` is the strongest identifier we have — the same "U…" id LINE gave
 * us over the Messaging webhook — and this API takes it RAW (only email and
 * phone are hashed). LINE only accepts it alongside the Channel ID, so it is
 * omitted when that is not configured and the event matches on external_id.
 * `click_id` is the landing URL's `ldtag_cl`; `browser_id` is the LINE Tag
 * first-party cookie `__lt__cid` (a UUID).
 */
export function buildLineAdsPayload(config: LineAdsConfig, ctx: SendContext) {
  const { lead, click, eventName, value, currency } = ctx;
  const lineUid = config.channelId ? fits(LINE_UID_RE, lead.lineUserId) : undefined;
  const amount = typeof value === "number" && value >= 0 && value <= LINE_VALUE_MAX ? value : undefined;
  const code = fits(LINE_CURRENCY_RE, typeof currency === "string" ? currency.toUpperCase() : undefined);
  return [
    {
      event: {
        source_type: "web",
        event_type: "conversion",
        event_name: lineEventName(eventName),
        deduplication_key: lineDedupKey(lead.id, eventName),
        event_timestamp: Math.floor(Date.now() / 1000),
        test_flag: false,
      },
      user: {
        line_uid: lineUid,
        external_id: fits(LINE_EXTERNAL_ID_RE, lead.id),
        click_id: fits(LINE_CLICK_ID_RE, click?.lineClickId),
        browser_id: fits(LINE_BROWSER_ID_RE, click?.lineBrowserId),
      },
      custom: amount === undefined ? undefined : { value: amount, currency: code },
    },
  ];
}

/**
 * Send to the LINE Conversion API. REAL when a Tag ID + Tag Access Token are
 * configured, mock otherwise.
 */
export async function sendLineAds(
  config: LineAdsConfig,
  ctx: SendContext
): Promise<SendResult> {
  const request = buildLineAdsPayload(config, ctx);
  const real = !!(config.tagId && config.accessToken);

  if (!real) {
    return {
      ok: true,
      mock: true,
      request,
      response: { note: "LINE Ads mock mode · ยังไม่ได้ใส่ LINE Tag ID / Tag Access Token", accepted: true },
    };
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "X-Line-TagAccessToken": config.accessToken!,
  };
  if (config.channelId) headers["X-Line-ChannelID"] = config.channelId;

  try {
    const res = await fetch(
      `${LINE_CONVERSION_API}/${encodeURIComponent(config.tagId!)}/events`,
      { method: "POST", headers, body: JSON.stringify(request) }
    );
    const text = await res.text();
    return {
      ok: res.ok,
      mock: false,
      request,
      response: { status: res.status, ...(safeJson(text) ?? { body: text.slice(0, 500) }) },
      error: res.ok
        ? undefined
        : res.status === 401 || res.status === 403
          ? "LINE ปฏิเสธ Tag Access Token ออก token ใหม่ใน LINE Business Manager ให้ตรงกับ LINE Tag ID นี้"
          : `LINE Conversion API ตอบกลับ ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      mock: false,
      request,
      response: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
