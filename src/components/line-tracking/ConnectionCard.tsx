import { CONNECTOR_META, maskSecret, serviceAccountEmail } from "@/lib/line-tracking/connectors";
import { CONNECTOR_GUIDE } from "@/lib/line-tracking/connector-guide";
import { parseJson } from "@/lib/line-tracking/json";
import { StatusBadge, MockBadge } from "@/components/line-tracking/ui";
import { saveConnectionAction, testConnectionAction } from "@/lib/line-tracking/actions";
import { isRealMode } from "@/lib/line-tracking/connectors";
import { CopyButton } from "@/components/line-tracking/CopyButton";
import { CollapsibleCard } from "@/components/line-tracking/CollapsibleCard";
import { getTrackingBaseUrl } from "@/lib/line-tracking/services/trackingService";
import type { ConnectionType } from "@/lib/line-tracking/enums";
import type { ProjectConnection } from "@prisma/client";
import { fmtDate } from "@/lib/line-tracking/format";

/**
 * Secret fields render EMPTY on purpose — the stored value is never sent to the
 * browser, and a blank submit means "keep what's saved" (saveConnectionConfig skips
 * blank values). That contract breaks if something else fills the box for the user:
 * a browser password manager sees several `type="password"` inputs on this page and
 * can inject a saved login into them. The injected value is NOT blank, so it sails
 * past the keep-existing guard and overwrites the real channel secret / access token
 * on the next Save — after which LINE's signature check fails and webhook events are
 * rejected with nothing on screen to explain it. These attributes tell Chrome/Safari
 * and the common password managers to leave the field alone.
 */
function secretFieldGuards(isSecret?: boolean) {
  if (!isSecret) return { autoComplete: "off" };
  return {
    autoComplete: "new-password",
    "data-1p-ignore": "true",
    "data-lpignore": "true",
    "data-bwignore": "true",
  };
}

export async function ConnectionCard({
  projectId,
  type,
  connection,
}: {
  projectId: string;
  type: ConnectionType;
  connection?: ProjectConnection;
}) {
  const meta = CONNECTOR_META[type];
  const config = parseJson<Record<string, string>>(connection?.configJson, {});
  const real = isRealMode(type, config);
  const status = connection?.status ?? "NOT_CONNECTED";

  // Google Sheet: the #1 confusion is "which email do I share the sheet with?"
  const shareEmail =
    type === "GOOGLE_SHEET"
      ? serviceAccountEmail(config.serviceAccountJson)
      : null;

  const header = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-slate-800">{meta.title}</h3>
          <StatusBadge status={status} />
          <MockBadge mock={!real} />
        </div>
        <p className="text-sm text-slate-500">{meta.description}</p>
      </div>
    </div>
  );

  const guide = CONNECTOR_GUIDE[type];
  // Was reading TRACKING_BASE_URL / NEXT_PUBLIC_APP_URL directly, so with neither set
  // this rendered a domain-less "/api/webhooks/line/<id>" — paste that into LINE and no
  // event ever reaches us. getTrackingBaseUrl() is the same helper the tracking links
  // already use and falls back to the Vercel deployment URL, so the address is correct
  // out of the box; setting TRACKING_BASE_URL still overrides it (e.g. a custom domain).
  const baseUrl = getTrackingBaseUrl();
  const lineWebhookUrl = type === "LINE" ? `${baseUrl}/api/webhooks/line/${projectId}` : null;

  return (
    <CollapsibleCard header={header} defaultOpen={false} storageKey={`conn.${projectId}.${type}`}>
      {guide && (
        <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-xs text-slate-700">
          <div className="mb-1.5 flex items-center gap-2 font-semibold text-blue-800">
            📋 วิธีเชื่อม (ทำตามทีละขั้น)
            {guide.link && (
              <a href={guide.link.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 underline">
                {guide.link.label} ↗
              </a>
            )}
          </div>
          <p className="mb-2 text-slate-500">{guide.intro}</p>
          <ol className="list-decimal space-y-1 pl-4">
            {guide.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>
      )}

      {lineWebhookUrl && (
        <div className="mt-2 rounded-lg bg-brand-blue/10 p-3 text-xs text-brand-deep">
          <div className="font-semibold">Webhook URL (ก็อปไปวางใน LINE → Messaging API → Webhook URL):</div>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-white px-2 py-1 text-slate-700">{lineWebhookUrl}</code>
            <CopyButton text={lineWebhookUrl} label="Copy" />
          </div>
          {baseUrl.includes("localhost") && (
            <div className="mt-1 text-rose-500">
              ⚠️ นี่เป็น URL ของเครื่อง dev — LINE เรียกไม่ถึง ตั้ง TRACKING_BASE_URL เป็นโดเมนจริงก่อนใช้งาน
            </div>
          )}
          <div className="mt-2 border-t border-brand-blue/20 pt-2 text-brand-blue">
            🤖 <b>ลูกค้ามีบอท/webhook เดิมอยู่แล้ว?</b> LINE ให้ตั้ง Webhook ได้ URL เดียวต่อ channel —
            ให้วาง URL ข้างบนนี้ใน LINE ตามปกติ แล้วเลือก <b>Option 2</b> ในฟอร์มด้านล่าง
            พร้อมใส่ Webhook URL เดิมของบอทลูกค้า ระบบจะส่งทุก event ต่อให้บอทเดิมแบบครบถ้วน
            (raw body + ลายเซ็นเดิม — บอทลูกค้า verify ผ่านและตอบแชทได้ปกติ ส่วนเราก็เก็บ Lead ได้พร้อมกัน)
          </div>
          {/* โหมด "webhook ยังอยู่ที่ระบบเดิมของลูกค้า" — ใช้เมื่อเราแตะคอนโซล LINE ของเขาไม่ได้
              (เช่น Apps Script ที่ลูกค้าเขียนเอง) LINE ยิงไปที่เขาเหมือนเดิม แล้วเขายิงสำเนาต่อมาหาเรา
              ตัวกลางแบบนี้มักส่ง x-line-signature ต่อไม่ได้ ลายเซ็นจึงใช้ยืนยันไม่ได้ — relayToken
              คือความลับที่ระบบเราออกให้แทน ต่อท้าย URL เป็น ?k=<token> */}
          {config.relayToken && lineWebhookUrl && (
            <div className="mt-2 border-t border-brand-blue/20 pt-2">
              <div className="font-semibold">📨 โหมดตัวกลาง — ให้ระบบเดิมของลูกค้ายิงสำเนามาที่:</div>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-white px-2 py-1 text-slate-700">
                  {`${lineWebhookUrl}?k=${config.relayToken}`}
                </code>
                <CopyButton text={`${lineWebhookUrl}?k=${config.relayToken}`} label="Copy" />
              </div>
              <div className="mt-2 text-[11px] opacity-80">
                ถ้าระบบเดิมเป็น Google Apps Script ให้แปะบรรทัดนี้ไว้ใน <code>doPost(e)</code> เดิม
                (ไม่ต้องแก้อย่างอื่น ไม่ต้องเปลี่ยน Webhook URL ในคอนโซล LINE):
              </div>
              <pre className="mt-1 overflow-x-auto rounded bg-white px-2 py-1 text-[11px] leading-relaxed text-slate-700">
{`UrlFetchApp.fetch("${lineWebhookUrl}?k=${config.relayToken}", {
  method: "post", contentType: "application/json",
  payload: e.postData.contents, muteHttpExceptions: true
});`}
              </pre>
              <div className="mt-1 text-[11px] text-rose-500">
                ⚠️ URL นี้มีความลับติดอยู่ — ส่งให้ผู้ดูแลระบบของลูกค้าเท่านั้น ห้ามลงในเอกสารสาธารณะ
              </div>
            </div>
          )}

          {/* LIFF tracking link — LINE-domain-only measurement (FB post → LINE ตรง ๆ) */}
          {config.liffId && (
            <div className="mt-2 border-t border-brand-blue/20 pt-2">
              <div className="font-semibold">📱 ลิงก์ LIFF (โดเมน LINE — วัด add ที่ไม่ผ่านเว็บได้แบบ 1:1):</div>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-white px-2 py-1 text-slate-700">
                  {`https://liff.line.me/${config.liffId}?src=ชื่อช่องทาง`}
                </code>
                <CopyButton text={`https://liff.line.me/${config.liffId}?src=`} label="Copy" />
              </div>
              <div className="mt-1 text-[11px] opacity-80">
                เปลี่ยน <code>src=</code> ต่อช่องทาง (เช่น fb-post / line-ads) — และตั้ง Endpoint URL ของ LIFF app
                ใน LINE Developers เป็น <code>{baseUrl}/liff/&lt;slug ของโปรเจกต์&gt;</code>
              </div>
            </div>
          )}
        </div>
      )}

      {type === "GOOGLE_SHEET" && (
        <div className="mt-2 rounded-lg bg-brand-blue/10 p-3 text-xs text-brand-deep">
          {shareEmail ? (
            <>
              <div className="font-semibold">วิธีต่อ (ง่าย ๆ):</div>
              <div className="mt-1">
                1. เปิด Google Sheet ของคุณ → <b>Share</b> → วางอีเมลนี้ (สิทธิ์ Editor):
              </div>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-white px-2 py-1 text-slate-700">{shareEmail}</code>
                <CopyButton text={shareEmail} label="Copy" />
              </div>
              <div className="mt-1">2. วาง <b>Sheet ID</b> ด้านล่าง → Save → Test</div>
            </>
          ) : (
            <>
              💡 ใส่ <b>Service Account JSON ใหม่ของโปรเจกต์นี้</b> ด้านล่าง แล้วแชร์ Sheet ให้อีเมล Service Account
            </>
          )}
        </div>
      )}

      <form action={saveConnectionAction} className="mt-3 space-y-3">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="type" value={type} />
        {meta.fields.map((f) => {
          const current = config[f.key];
          if (f.options) {
            return (
              <div key={f.key}>
                <label className="mb-1 block text-sm font-medium text-gray-600">
                  {f.label} {f.optional && <span className="text-slate-300">(optional)</span>}
                </label>
                <select name={f.key} className="field-input" defaultValue={current || f.options[0].value}>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            );
          }
          if (f.textarea) {
            return (
              <div key={f.key}>
                <label className="mb-1 block text-sm font-medium text-gray-600">
                  {f.label} {f.optional && <span className="text-slate-300">(optional)</span>}
                </label>
                <textarea
                  name={f.key}
                  rows={3}
                  className="field-input font-mono text-xs"
                  {...secretFieldGuards(f.secret)}
                  placeholder={
                    f.secret && current
                        ? "•••••• (บันทึกไว้แล้ว — เว้นว่างถ้าไม่เปลี่ยน)"
                        : f.placeholder
                  }
                />
              </div>
            );
          }
          return (
            <div key={f.key}>
              <label className="mb-1 block text-sm font-medium text-gray-600">
                {f.label} {f.optional && <span className="text-slate-300">(optional)</span>}
              </label>
              <input
                name={f.key}
                type={f.secret ? "password" : "text"}
                className="field-input"
                defaultValue={f.secret ? "" : current ?? ""}
                {...secretFieldGuards(f.secret)}
                placeholder={
                    f.secret && current
                      ? `${maskSecret(current)} — เว้นว่างถ้าไม่เปลี่ยน`
                      : f.placeholder
                }
              />
            </div>
          );
        })}

        <div className="flex items-center justify-between pt-1">
          <div className="text-xs text-slate-400">
            {connection?.lastTestAt ? (
              <>
                Last test:{" "}
                <StatusBadge status={connection.lastTestStatus ?? "FAIL"} />{" "}
                <span>{fmtDate(connection.lastTestAt)}</span>
              </>
            ) : (
              "ยังไม่เคยทดสอบการเชื่อมต่อ"
            )}
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-sm">Save</button>
          </div>
        </div>
      </form>

      {/* ข้อความผลทดสอบเคยอยู่ข้างปุ่มพร้อม truncate — ตัดทิ้งตั้งแต่กลางประโยค
          ทั้งที่มันคือคำอธิบายว่าต้องแก้อะไร ย้ายลงบรรทัดใหม่เต็มความกว้างและปล่อยให้ขึ้นบรรทัดเอง
          สีแดงเก็บไว้ให้ ERROR จริง ส่วน "ยังยืนยันไม่ได้" (warnOnly → NOT_CONNECTED) ใช้สีเหลือง */}
      <form action={testConnectionAction} className="mt-2 space-y-2">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="type" value={type} />
        <button type="submit" className="btn-secondary text-sm">Test Connection</button>
        {connection?.lastError && (
          <p
            className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
              status === "ERROR" ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-700"
            }`}
          >
            {connection.lastError}
          </p>
        )}
      </form>
    </CollapsibleCard>
  );
}
