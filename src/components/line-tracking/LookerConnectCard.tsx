import { CopyButton } from "@/components/line-tracking/CopyButton";
import {
  connectLookerAction,
  revokeLookerAction,
  setLookerPiiAction,
} from "@/lib/line-tracking/actions";
import { LookerConnectButton } from "@/components/line-tracking/LookerConnectButton";
import { LookerAccountField } from "@/components/line-tracking/LookerAccountField";
import {
  buildConnectorConfig,
  buildDataSourceUrl,
  buildFeedUrl,
  buildReportUrl,
  getLookerDeploymentId,
  getLookerTemplateReportId,
} from "@/lib/line-tracking/lookerLink";
import { fmtDate } from "@/lib/line-tracking/format";

/**
 * Setup step: connect this project to Looker Studio in one click.
 *
 * The plaintext token is only ever available in the request that mints it (the database
 * keeps a sha256 and nothing else), so the connect links can only be rendered right
 * after pressing Connect/Rotate. Coming back to this page later shows the status and the
 * rotate button — not the old links. That is a property of the storage design, not a
 * limitation to work around.
 */
export function LookerConnectCard({
  project,
  freshToken,
  accountEmail,
}: {
  project: {
    id: string;
    name: string;
    connected: boolean;
    tokenSetAt: Date | null;
    includePii: boolean;
  };
  freshToken?: string;
  /** MarsOS login of the person viewing the card — Looker is told to open in this account. */
  accountEmail?: string | null;
}) {
  const deploymentId = getLookerDeploymentId();
  const templateReportId = getLookerTemplateReportId();

  return (
    <div id="looker" className="card space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">เชื่อมต่อ Looker Studio</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            project.connected
              ? "bg-emerald-100 text-emerald-700"
              : "bg-slate-100 text-slate-500"
          }`}
        >
          {project.connected ? "เชื่อมแล้ว" : "ยังไม่เชื่อม"}
        </span>
      </div>

      <p className="text-sm text-slate-500">
        ส่งข้อมูล 3 ชุดเข้า Looker อัตโนมัติ — <b>Dashboard รายวัน</b> (แยกตามช่องทาง),{" "}
        <b>Leads CRM</b> (รายคน) และ <b>Conversion Events</b> เลือกช่วงวันที่ใน Looker ได้เอง
        ข้อมูลอัปเดตทุกครั้งที่รีเฟรชรายงาน
      </p>

      {!deploymentId && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          ⚠️ ยังไม่ได้ตั้งค่า <code>LOOKER_CONNECTOR_DEPLOYMENT_ID</code> — ต้อง deploy connector
          ใน Apps Script ก่อน (ดู <code>looker-connector/README.md</code>) แล้วเอา Deployment ID
          ใส่ใน environment variable ของโปรเจกต์ ปุ่มกดเชื่อมถึงจะทำงาน
        </p>
      )}

      {project.connected && freshToken && deploymentId && (
        <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-800">
            สร้าง token ใหม่แล้ว — เลือกแบบที่ต้องการด้านล่างได้เลย (ปุ่มชุดนี้แสดงครั้งเดียว
            ถ้าออกจากหน้านี้ต้องกด &ldquo;สร้าง token ใหม่&rdquo; อีกครั้ง)
          </p>
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <LookerAccountField current={accountEmail ?? ""} />
            <p>
              <b>ต้องเป็นบัญชี Google ที่ถูก Share ให้เปิด Apps Script &ldquo;MarsOS Looker Connector&rdquo; ได้</b>{" "}
              (ข้อกำหนดของ Google สำหรับ connector ที่ไม่ได้ publish สาธารณะ) ถ้าใช้ gmail ส่วนตัวหรือบัญชีที่ไม่มีสิทธิ์
              Looker จะขึ้น &ldquo;connector could not be found&rdquo; หรือหน้าตั้งค่าบัญชีใหม่ ให้เปลี่ยนอีเมลด้านบนแล้วกดปุ่มใหม่
            </p>
          </div>

          {/* Path 1: brand-new report. One click — Looker opens a report that already has
              the three MarsOS data sources attached (a copy of the MarsOS template when one
              is configured, otherwise a blank report). */}
          <div className="rounded-lg border border-emerald-200 bg-white p-3">
            <p className="font-semibold text-emerald-800">แบบที่ 1 · สร้างรายงาน Looker ใหม่</p>
            <div className="mt-2">
              <a
                className="btn-primary text-sm"
                target="_blank"
                rel="noopener noreferrer"
                href={buildReportUrl({ deploymentId, token: freshToken, projectName: project.name, reportId: templateReportId, accountEmail })}
              >
                {templateReportId
                  ? "สร้างรายงานใหม่จาก Template MarsOS (ต่อข้อมูลให้อัตโนมัติ) →"
                  : "สร้างรายงานใหม่ (ต่อข้อมูล 3 ชุดให้อัตโนมัติ) →"}
              </a>
            </div>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
              <li>
                กดปุ่มด้านบน Looker Studio เปิดแท็บใหม่ ถ้าเป็นครั้งแรกจะถามสิทธิ์ กด <b>Authorize / Allow</b>
              </li>
              <li>
                รายงานเปิดมาพร้อม Data source ของ MarsOS ครบ 3 ชุด (Dashboard / Leads / Conversions)
                ดูได้ที่เมนู <b>Resource → Manage added data sources</b>
              </li>
              <li>
                <b>ตั้งสิทธิ์ให้คนอื่นเห็นข้อมูล:</b> Resource → Manage added data sources → EDIT ที่ Data source ของ MarsOS
                → <b>Data credentials</b> เป็น <b>Owner&apos;s credentials</b> → UPDATE ทำครบ 3 ตัว แล้วกด <b>Share</b> ให้ทีม/ลูกค้า
              </li>
              <li>
                {templateReportId
                  ? "กราฟและตารางถูกจัดหน้าไว้แล้วตาม Template MarsOS ตั้งชื่อรายงานแล้วแชร์ลูกค้าได้เลย"
                  : "ลากกราฟ/ตารางลงหน้ารายงานแล้วเลือก Data source ของ MarsOS ที่ต่อไว้แล้ว"}
                {" "}จัดหน้าตาม{" "}
                <a className="font-medium text-brand-blue underline" href="/line-tracking/looker-guide" target="_blank" rel="noopener noreferrer">
                  คู่มือจัดหน้ารายงาน 40 ข้อ (เปิดแท็บใหม่)
                </a>
              </li>
            </ol>
          </div>

          {/* Path 2: the dashboard the team already has. Looker's Linking API can only
              *replace* data sources that already exist in a report (`c.reportId` + a new
              alias fails with "ds0 is not a valid data source alias for this report"), so
              the supported way in is: create the three MarsOS data sources as reusable
              ones (one prefilled connector form each), then pick them from "My data
              sources" inside the existing report. The report itself is untouched. */}
          <div className="rounded-lg border border-emerald-200 bg-white p-3">
            <p className="font-semibold text-emerald-800">แบบที่ 2 · ดึงข้อมูลเข้า Looker Dashboard ที่มีอยู่แล้ว</p>
            <p className="mt-1 text-xs text-slate-600">
              กด 3 ปุ่มนี้ทีละปุ่ม (ฟอร์มกรอกให้แล้ว แค่กด CONNECT) จะได้ Data source ของ MarsOS 3 ตัวไว้ในบัญชี Looker
              แล้วเลือกใช้ใน Dashboard เดิมได้ทันที ไม่ต้องสร้างสำเนา
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a className="btn-primary text-sm" target="_blank" rel="noopener noreferrer"
                href={buildDataSourceUrl(deploymentId, buildConnectorConfig(freshToken, "summary"), accountEmail)}>
                1. Data source: Dashboard รายวัน →
              </a>
              <a className="btn-primary text-sm" target="_blank" rel="noopener noreferrer"
                href={buildDataSourceUrl(deploymentId, buildConnectorConfig(freshToken, "leads"), accountEmail)}>
                2. Data source: Leads CRM →
              </a>
              <a className="btn-primary text-sm" target="_blank" rel="noopener noreferrer"
                href={buildDataSourceUrl(deploymentId, buildConnectorConfig(freshToken, "conversions"), accountEmail)}>
                3. Data source: Conversion Events →
              </a>
            </div>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
              <li>
                กดปุ่ม 1 Looker เปิดฟอร์ม connector ที่กรอก URL / Token / ชุดข้อมูลให้แล้ว <b>ห้ามแก้</b> กด <b>CONNECT</b> มุมขวาบน
                (ครั้งแรกจะถามสิทธิ์ กด Authorize / Allow)
              </li>
              <li>
                หน้าถัดไปเป็นรายการฟิลด์: ตั้งชื่อ Data source มุมซ้ายบนเป็น <code>MarsOS — {project.name} — Dashboard</code>
                แล้วเปลี่ยน <b>Data credentials</b> (มุมขวาบน) เป็น <b>Owner&apos;s credentials</b> เสร็จแล้วปิดแท็บได้เลย
              </li>
              <li>ทำซ้ำกับปุ่ม 2 (ชื่อ … — Leads) และปุ่ม 3 (ชื่อ … — Conversions)</li>
              <li>
                เปิด Dashboard เดิม กด <b>Add data</b> (เมนู Insert หรือปุ่มในแถบเครื่องมือ) → แท็บ <b>My data sources</b>
                → เลือก Data source ของ MarsOS ทั้ง 3 ตัว → <b>Add</b>
              </li>
              <li>ลากกราฟ/ตารางลงหน้า เลือก Data source ของ MarsOS ทีมและลูกค้าที่มีสิทธิ์ใน Dashboard เห็นข้อมูลทันที ไม่ต้องยุ่ง Apps Script</li>
            </ol>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-800">
            <code className="truncate rounded bg-white/70 px-2 py-1">{freshToken}</code>
            <CopyButton text={freshToken} label="คัดลอก token" />
            <CopyButton text={buildFeedUrl("summary", freshToken)} label="คัดลอกลิงก์ทดสอบ" />
          </div>

          <details className="rounded-lg bg-white/70 p-3 text-sm text-slate-700">
            <summary className="cursor-pointer font-medium">ปุ่มแบบที่ 1 ไม่ทำงาน?</summary>
            <p className="mt-2">
              ใช้ปุ่ม 3 ปุ่มของแบบที่ 2 แทนได้ทุกกรณี: สร้าง Data source ทั้ง 3 ตัวก่อน แล้วไปที่ Looker Studio หน้าแรก
              กด <b>Create → Report</b> → แท็บ <b>My data sources</b> → เลือก Data source ของ MarsOS
            </p>
          </details>

          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <b>ถ้า Looker ขึ้น &ldquo;connector could not be found&rdquo; / &ldquo;The linked connectorId was invalid&rdquo; หรือเปิดมาเป็นหน้ารายการ connector เปล่าๆ</b>{" "}
            แปลว่าบัญชี Google ที่ Looker ใช้ยังไม่มีสิทธิ์ใน Apps Script &ldquo;MarsOS Looker Connector&rdquo; ให้เจ้าของสคริปต์ Share ให้บัญชีนั้น (Viewer พอ)
            แล้วปิดแท็บ กลับมากดปุ่มใน MarsOS ใหม่ <b>ห้ามสลับบัญชีในแท็บ Looker</b> เพราะ Looker จะโหลดหน้าใหม่แล้วทิ้งค่าที่ MarsOS ส่งไป
          </p>
          <p className="text-xs text-slate-500">
            ทำครั้งเดียวต่อโปรเจกต์ รายงานถัดไปเลือก Data source เดิมจาก My data sources ได้เลย{" "}
            <b>ไม่ต้องกดสร้าง token ใหม่</b> — ถ้ากด token เดิมจะใช้ไม่ได้ทันที และรายงานที่ต่อไว้จะดึงข้อมูลไม่ได้
            ถ้าลูกค้าเปิดรายงานแล้วข้อมูลไม่ขึ้น ให้ตั้ง Data credentials ของ Data source เป็น Owner&apos;s credentials
            (Resource → Manage added data sources → Edit)
          </p>
        </div>
      )}

      {project.connected && !freshToken && (
        <div className="space-y-2 text-sm text-slate-500">
          <p>
            เชื่อมไว้เมื่อ {project.tokenSetAt ? fmtDate(project.tokenSetAt) : "—"} · token
            เก็บเป็นค่า hash เท่านั้น จึงเอากลับมาแสดงไม่ได้
          </p>
          <p>
            <b>ทำรายงานเพิ่ม:</b> ไม่ต้องกดอะไรในหน้านี้ — เปิด Looker Studio → Create → Report
            → <b>Add data</b> → แท็บ <b>My data sources</b> → เลือก Data source ชื่อ <code>MarsOS — {project.name} — …</code> ที่เชื่อมไว้แล้ว
            กด &ldquo;สร้าง token ใหม่&rdquo; เฉพาะตอน token หลุดหรือยังไม่เคยกด CONNECT ใน Looker
            เพราะของเดิมจะใช้ไม่ได้ทันทีและรายงานที่ต่อไว้จะพัง
          </p>
          <p>
            <a
              className="font-medium text-brand-blue underline"
              href="/line-tracking/looker-guide"
              target="_blank"
              rel="noopener noreferrer"
            >
              คู่มือจัดหน้ารายงาน 40 ข้อ + วิธีใส่ใน Dashboard เดิม (เปิดแท็บใหม่)
            </a>
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <LookerConnectButton
          projectId={project.id}
          connected={project.connected}
          action={connectLookerAction}
        />
        {project.connected && (
          <form action={revokeLookerAction}>
            <input type="hidden" name="projectId" value={project.id} />
            <button type="submit" className="btn-secondary text-sm text-rose-600">
              ยกเลิกการเชื่อมต่อ
            </button>
          </form>
        )}
      </div>

      <form action={setLookerPiiAction} className="rounded-lg border border-slate-100 px-3 py-2">
        <input type="hidden" name="projectId" value={project.id} />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="include"
            defaultChecked={project.includePii}
            className="h-4 w-4"
          />
          <span>ส่งชื่อจริงและเบอร์โทรเต็มไปที่ Looker</span>
          <button type="submit" className="btn-secondary ml-auto text-xs">
            บันทึก
          </button>
        </label>
        <p className="mt-1 text-xs text-slate-400">
          ค่าเริ่มต้นคือ &ldquo;ไม่ส่ง&rdquo; — เบอร์จะเห็นแค่ 4 ตัวท้าย และชื่อจะใช้ชื่อ LINE แทน
          จำนวนคอลัมน์เท่าเดิมทุกกรณี เปิด/ปิดแล้วรายงานเดิมจึงไม่พัง
        </p>
      </form>
    </div>
  );
}
