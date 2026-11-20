import Link from "next/link";
import { PageHeader } from "@/components/ds";

export const dynamic = "force-dynamic";

// In-app copy of looker-connector/REPORT-BUILD-STEPS.md so the Setup page can link to
// it. Same content, kept in step order; edit both when the report layout changes.
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5 space-y-3">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function Steps({ start, children }: { start: number; children: React.ReactNode }) {
  return (
    <ol start={start} className="list-decimal space-y-2 pl-6 text-sm text-slate-700">
      {children}
    </ol>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      {children}
    </p>
  );
}

function FieldTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[28rem] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-1 pr-6">Field name</th>
            <th className="py-1">Formula</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, formula]) => (
            <tr key={name} className="border-t border-slate-100">
              <td className="py-1.5 pr-6">
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{name}</code>
              </td>
              <td className="py-1.5">
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{formula}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LookerGuidePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <PageHeader eyebrow="LINE Tracking" title={<>          สร้างรายงาน Looker Studio ให้เหมือน Dashboard MarsOS</>} className="mb-3" />
        <p className="mt-1 text-sm text-slate-500">
          ทำตามข้อ 1 → 40 เรียงลงมา ไม่ต้องข้าม ใช้เวลาประมาณ 30-45 นาที ทำครั้งเดียวสำหรับลูกค้ารายแรก
          หลังจากนั้นลูกค้ารายต่อไปกดปุ่มเดียวใน MarsOS ได้รายงานหน้าตาเดิม (ดูข้อ 40)
        </p>
        <p className="mt-1 text-sm text-slate-500">
          มีรายงาน / Dashboard เดิมอยู่แล้วและอยากเพิ่มข้อมูล MarsOS เข้าไป: ทำส่วน A และ B แล้วข้ามไปส่วน O
        </p>
      </div>

      <Section title="ส่วน A — สร้าง Data Source 3 ตัว (ข้อ 1-9)">
        <Steps start={1}>
          <li>
            เปิด MarsOS → โปรเจกต์ที่ต้องการ → <b>Setup</b> → ขั้น <b>Looker Studio</b>
          </li>
          <li>
            กด <b>เชื่อมต่อ Looker</b> — token จะแสดงครั้งเดียว <b>คัดลอกเก็บไว้ก่อน</b> ปิดหน้าไปแล้วดูย้อนหลังไม่ได้
          </li>
          <li>
            กด <b>+ Data source: Dashboard รายวัน</b> — เปิดแท็บใหม่ ทุกช่องกรอกมาให้แล้ว ห้ามแก้
          </li>
          <li>
            ในหน้า Looker กด <b>CONNECT</b> (มุมขวาบน) รอจนเห็นตารางรายชื่อฟิลด์
          </li>
          <li>
            เปลี่ยนชื่อ data source: คลิกที่ชื่อ &ldquo;Untitled Data Source&rdquo; มุมซ้ายบน พิมพ์{" "}
            <code>MarsOS — ชื่อลูกค้า — Dashboard</code>
          </li>
          <li>
            กด <b>Data credentials</b> (แถบบน) → เลือก <b>Owner&apos;s credentials</b> → <b>UPDATE</b>{" "}
            (ถ้าไม่ตั้ง ลูกค้าจะเปิดรายงานไม่ได้)
          </li>
          <li>
            กลับไปแท็บ MarsOS กด <b>+ Data source: Leads CRM</b> แล้วทำข้อ 4-6 ซ้ำ ตั้งชื่อ{" "}
            <code>MarsOS — ชื่อลูกค้า — Leads</code>
          </li>
          <li>
            กด <b>+ Data source: Conversion Events</b> ทำข้อ 4-6 ซ้ำ ตั้งชื่อ{" "}
            <code>MarsOS — ชื่อลูกค้า — Conversions</code>
          </li>
          <li>
            เช็กว่ามีครบ 3 ตัวที่{" "}
            <a
              className="text-brand-blue underline"
              href="https://lookerstudio.google.com/navigation/datasources"
              target="_blank"
              rel="noopener noreferrer"
            >
              lookerstudio.google.com/navigation/datasources
            </a>
          </li>
        </Steps>
        <Note>
          ถ้าเปิดลิงก์แล้วขึ้น &ldquo;ไม่มีสิทธิ์&rdquo; ให้ดู URL ว่าเป็น <code>/u/0/</code> หรือ{" "}
          <code>/u/4/</code> ต้องเป็นบัญชี Google ตัวเดียวกับที่ใช้ทำรายงาน
        </Note>
      </Section>

      <Section title="ส่วน B — สร้าง calculated field (ข้อ 10-15)">
        <Steps start={10}>
          <li>
            เปิด data source <code>— Dashboard</code> → <b>ADD A FIELD</b> (ขวาบน)
          </li>
          <li>สร้าง 3 ฟิลด์ กด ADD A FIELD ทีละครั้ง:</li>
        </Steps>
        <FieldTable
          rows={[
            ["Conversion (คลิก→ซื้อ)", "SUM(purchases) / SUM(visits)"],
            ["อัตราปิด (Lead→ซื้อ)", "SUM(purchases) / SUM(leads)"],
            ["อัตราแอด LINE", "SUM(leads) / SUM(visits)"],
          ]}
        />
        <Steps start={12}>
          <li>
            ทั้ง 3 ฟิลด์ ตั้ง <b>Type → Numeric → Percent</b> แล้วกด <b>SAVE</b>
          </li>
          <li>
            เปิด data source <code>— Leads</code> → <b>ADD A FIELD</b> สร้าง 3 ฟิลด์:
          </li>
        </Steps>
        <FieldTable
          rows={[
            ["เป็นเพื่อนตอนนี้", 'CASE WHEN line_stage = "FRIEND" THEN 1 ELSE 0 END'],
            ["เคยทัก", "CASE WHEN has_messaged THEN 1 ELSE 0 END"],
            ["บล็อก", 'CASE WHEN line_stage = "BLOCKED" THEN 1 ELSE 0 END'],
          ]}
        />
        <Steps start={14}>
          <li>
            เปิด data source <code>— Conversions</code> → <b>ADD A FIELD</b> สร้าง 1 ฟิลด์:{" "}
            <code>ส่งไม่สำเร็จ</code> = <code>CASE WHEN status = &quot;FAILED&quot; THEN 1 ELSE 0 END</code>
          </li>
          <li>
            กด <b>SAVE</b> ทุกฟิลด์ แล้วกด <b>DONE</b>
          </li>
        </Steps>
      </Section>

      <Section title="ส่วน C — เปิดรายงานเปล่า (ข้อ 16-19)">
        <Steps start={16}>
          <li>
            ไป{" "}
            <a
              className="text-brand-blue underline"
              href="https://lookerstudio.google.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              lookerstudio.google.com
            </a>{" "}
            → <b>Create</b> → <b>Report</b>
          </li>
          <li>
            หน้าต่าง &ldquo;Add data to report&rdquo; เด้งขึ้น (เต็มไปด้วยโลโก้ Google Analytics, BigQuery ฯลฯ
            — ไม่ต้องเลือกในนั้น) → กดแท็บ <b>My data sources</b> → เลือก{" "}
            <code>MarsOS — ชื่อลูกค้า — Dashboard</code> → <b>ADD</b>
          </li>
          <li>
            <b>Add data</b> (แถบบน) อีก 2 ครั้ง เพิ่ม <code>— Leads</code> และ <code>— Conversions</code>
          </li>
          <li>ลบตารางที่ Looker แถมมาให้ตอนแรกทิ้ง (คลิกแล้วกด Delete)</li>
        </Steps>
        <p className="text-sm text-slate-600">
          ตั้งชื่อรายงาน: คลิกชื่อมุมซ้ายบน → <code>ชื่อลูกค้า — LINE Ad Tracking</code>
        </p>
      </Section>

      <Section title="ส่วน D — ตัวคุมวันที่ (ข้อ 20-21)">
        <Steps start={20}>
          <li>
            <b>Add a control</b> → <b>Date range control</b> วางไว้มุมขวาบนของหน้า
          </li>
          <li>
            แถบขวา <b>Default date range</b> → Auto → เปลี่ยนเป็น <b>Last 7 days</b> (ให้ตรงกับค่าเริ่มต้นของ MarsOS)
          </li>
        </Steps>
      </Section>

      <Section title="ส่วน E — แถวเทียบกับช่วงก่อนหน้า (ข้อ 22-24)">
        <Steps start={22}>
          <li>
            <b>Add a chart</b> → <b>Scorecard</b> วางซ้ายบน — Data source <code>— Dashboard</code>, Metric{" "}
            <code>leads</code>, <b>Comparison date range → Previous period</b>, Style → เปิด Comparison
            ให้แสดง % และลูกศร
          </li>
          <li>คลิก scorecard นั้น กด Ctrl+D 2 ครั้ง วางเรียงข้างกัน</li>
          <li>
            เปลี่ยน Metric ของสองอันที่ซ้ำมา: อันที่ 2 = <code>purchases</code>, อันที่ 3 ={" "}
            <code>revenue</code> (อัน revenue ตั้ง Style → Number format → <b>Currency THB</b>)
          </li>
        </Steps>
      </Section>

      <Section title="ส่วน F — KPI 6 การ์ด (ข้อ 25-27)">
        <Steps start={25}>
          <li>Ctrl+D จาก scorecard เดิมอีก 6 อัน วางเป็นแถวที่สอง</li>
          <li>ปิด Comparison ของทั้ง 6 อัน (Setup → Comparison date range → None)</li>
          <li>ตั้ง Metric เรียงซ้ายไปขวาตามนี้ (กดที่ metric เพื่อ rename ป้ายกำกับ):</li>
        </Steps>
        <FieldTable
          rows={[
            ["visits", "ผู้เข้าเว็บ (unique)"],
            ["leads", "Leads (แอด LINE)"],
            ["qualified", "คุณภาพผ่าน (สะสม)"],
            ["purchases", "ปิดการขาย"],
            ["revenue", "ยอดขายรวม (Currency THB)"],
            ["Conversion (คลิก→ซื้อ)", "Conversion (คลิก→ซื้อ)"],
          ]}
        />
      </Section>

      <Section title="ส่วน G — แท่ง funnel 7 ขั้น (ข้อ 28-29)">
        <Steps start={28}>
          <li>Ctrl+D scorecard อีก 7 อัน วางเรียงลงมาเป็นคอลัมน์ (เลียนแบบแท่ง funnel ใน MarsOS)</li>
          <li>
            ตั้ง Metric เรียงบนลงล่าง: <code>visits</code> → <code>line_clicks</code> → <code>leads</code> →{" "}
            <code>contacted</code> → <code>qualified</code> → <code>quoted</code> → <code>purchases</code>
          </li>
        </Steps>
        <p className="text-sm text-slate-600">
          ทุกตัวเป็นยอดสะสม ตัวเลขจึงลดหลั่นลงเสมอ ถ้าตัวล่างมากกว่าตัวบน แปลว่าเลือก metric ผิด
        </p>
        <p className="text-sm text-slate-600">
          <b>เฉพาะ KOWA:</b> เพิ่ม scorecard อีก 1 อัน <code>booked</code> (จองสำเร็จ) วางระหว่าง{" "}
          <code>quoted</code> กับ <code>purchases</code> — โปรเจกต์อื่นไม่ต้องใส่ (ค่าเป็น 0 เสมอ)
        </p>
      </Section>

      <Section title="ส่วน H — โดนัท 2 อัน (ข้อ 30-32)">
        <Steps start={30}>
          <li>
            <b>Add a chart</b> → <b>Donut chart</b> — Data source <code>— Dashboard</code>, Dimension{" "}
            <code>channel</code>, Metric <code>leads</code>, Style → เปิด <b>Show total</b>, ชื่อกราฟ{" "}
            <code>Lead แยกตามช่องทาง</code>
          </li>
          <li>
            <b>Donut chart</b> อีกอัน — Data source <code>— Leads</code>, Dimension <code>status_label</code>,
            Metric <code>Record Count</code>, ชื่อกราฟ <code>สถานะ Lead</code>
          </li>
          <li>วางสองอันเรียงข้างกัน</li>
        </Steps>
      </Section>

      <Section title="ส่วน I — การ์ดสถานะ LINE (ข้อ 33)">
        <Steps start={33}>
          <li>
            <b>Scorecard</b> × 3 (data source <code>— Leads</code>) Metric <code>เป็นเพื่อนตอนนี้</code> /{" "}
            <code>เคยทัก</code> / <code>บล็อก</code> — ทั้งสามตั้ง aggregation = <b>Sum</b> วางเรียงข้างกัน
          </li>
        </Steps>
      </Section>

      <Section title="ส่วน J — กราฟแท่งคู่ (ข้อ 34)">
        <Steps start={34}>
          <li>
            <b>Column chart</b> — Data source <code>— Dashboard</code>, Dimension <code>channel</code>, Metric{" "}
            <code>leads</code> และ <code>purchases</code> (กด Add metric), ชื่อกราฟ{" "}
            <code>Leads เทียบ ปิดการขาย แยกตามช่องทาง</code>
          </li>
        </Steps>
      </Section>

      <Section title="ส่วน K — ตาราง 3 ตัว (ข้อ 35-37)">
        <Steps start={35}>
          <li>
            <b>Table</b> ยอดขายแยกช่องทาง — Data source <code>— Dashboard</code>, Dimension{" "}
            <code>channel</code>, Metric <code>leads</code>, <code>purchases</code>,{" "}
            <code>อัตราปิด (Lead→ซื้อ)</code>, <code>revenue</code>, Sort <code>revenue</code> → Descending
          </li>
          <li>
            <b>Table</b> Leads ล่าสุด — Data source <code>— Leads</code>, Dimension <code>lead_name</code>,{" "}
            <code>channel_group</code>, <code>status_label</code>, Metric <code>value</code>, Sort{" "}
            <code>created_at</code> → Descending, Style → Rows per page = 6
          </li>
          <li>
            <b>Table</b> Conversion ล่าสุด — Data source <code>— Conversions</code>, Dimension{" "}
            <code>event_name</code>, <code>platform</code>, <code>status</code>, <code>created_at</code>, Metric{" "}
            <code>event_value</code>, Sort <code>created_at</code> → Descending, Rows per page = 6 —
            เพิ่ม <b>Scorecard</b> หนึ่งอัน Metric = <code>ส่งไม่สำเร็จ</code> (Sum) ไว้ข้างตาราง
          </li>
        </Steps>
      </Section>

      <Section title="ส่วน L — หน้า 2: Leads CRM (ข้อ 38)">
        <Steps start={38}>
          <li>
            <b>Page</b> → <b>New page</b> แล้วใส่ <b>Table</b> เต็มหน้า (data source <code>— Leads</code>)
            Dimension: <code>created_at</code>, <code>lead_name</code>, <code>line_name</code>, <code>phone</code>,{" "}
            <code>channel_group</code>, <code>channel</code>, <code>campaign</code>, <code>keyword</code>,{" "}
            <code>status_label</code>, <code>sales_owner</code> — Metric: <code>value</code>,{" "}
            <code>slip_amount</code> — และ <b>Add a control → Drop-down list</b> × 3 ไว้ด้านบน:{" "}
            <code>channel_group</code>, <code>status_label</code>, <code>sales_owner</code>
          </li>
        </Steps>
      </Section>

      <Section title="ส่วน M — สีและธีม (ข้อ 39)">
        <Steps start={39}>
          <li>
            <b>Theme and layout</b> → <b>CUSTOMIZE</b> → Chart palette ใส่ตามลำดับนี้:
          </li>
        </Steps>
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100 dark:text-slate-800">
{`#14b8a6   #06c755   #f97316   #6366f1
#a855f7   #0ea5e9   #f43f5e   #64748b`}
        </pre>
        <p className="text-sm text-slate-600">
          พื้นหลังการ์ดขาว, ขอบ <code>#e2e8f0</code>, ตัวหนังสือหลัก <code>#0f172a</code>, ตัวหนังสือรอง{" "}
          <code>#64748b</code>
        </p>
      </Section>

      <Section title="ส่วน N — ทำให้ลูกค้ารายต่อไปกดปุ่มเดียวจบ (ข้อ 40)">
        <Steps start={40}>
          <li>
            คัดลอก report ID จาก URL: <code>lookerstudio.google.com/reporting/</code>
            <b>
              <code>&lt;REPORT_ID&gt;</code>
            </b>
            <code>/page/...</code> แล้วส่งให้ทีมเทคนิคตั้งเป็น env <code>LOOKER_TEMPLATE_REPORT_ID</code> ใน
            Vercel (Production) และ redeploy หนึ่งครั้ง
          </li>
        </Steps>
        <p className="text-sm text-slate-600">
          หลังจากนั้นหน้า Setup ของทุกโปรเจกต์จะมีปุ่ม <b>ใช้ Template รายงาน MarsOS</b> กดครั้งเดียวได้รายงาน
          หน้าตาเดียวกัน พร้อม data source ของโปรเจกต์นั้น
        </p>
        <Note>
          ห้ามลบรายงาน template และอย่ากด &ldquo;สร้าง token ใหม่&rdquo; ของโปรเจกต์ที่ต่อรายงานไว้แล้ว
          โดยไม่จำเป็น เพราะ data source เดิมจะดึงข้อมูลไม่ได้ทันที
        </Note>
      </Section>

      <Section title="ส่วน O — เอาข้อมูล MarsOS ใส่ใน Dashboard / รายงานเดิม">
        <Steps start={1}>
          <li>ทำส่วน A (Data source 3 ตัว) และส่วน B (calculated field) ให้ครบก่อน</li>
          <li>
            เปิดรายงานเดิมใน Looker Studio → กด <b>Edit</b> มุมขวาบน (ถ้ายังอยู่โหมดดู)
          </li>
          <li>
            แถบเมนูบนกด <b>Add data</b> (หรือ <b>Resource → Manage added data sources → Add a data source</b>)
            → แท็บ <b>My data sources</b> → เลือก <code>MarsOS — ชื่อลูกค้า — Dashboard</code> → <b>Add</b>
          </li>
          <li>
            ทำซ้ำเพิ่ม <code>— Leads</code> และ <code>— Conversions</code>
          </li>
          <li>
            เพิ่มกราฟ/ตาราง/scorecard ใหม่ตามส่วน E-L ที่ต้องการ โดยเลือก Data source เป็นของ MarsOS ในแถบขวา
            — กราฟเดิมในรายงานไม่ถูกแตะ
          </li>
          <li>
            ถ้ารายงานเดิมมี Date range control อยู่แล้ว กราฟของ MarsOS จะใช้ตัวเดียวกันอัตโนมัติ
          </li>
        </Steps>
      </Section>

      <p className="text-xs text-slate-400">
        ต้องการรู้ว่าทำไมแต่ละกราฟใช้ฟิลด์นั้น ดู <code>looker-connector/REPORT-LAYOUT.md</code> ในโค้ด ·{" "}
        <Link href="/line-tracking/guide" className="underline">
          คู่มือติดตั้ง Line Tracking
        </Link>
      </p>
    </div>
  );
}
