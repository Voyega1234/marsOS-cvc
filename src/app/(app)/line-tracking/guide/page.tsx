import Link from "next/link";
import { PageHeader } from "@/components/ds";
import {
  ArrowRight,
  Code2,
  Link2,
  MessageCircleHeart,
  BarChart3,
  Facebook,
  Music2,
  Search,
  Sheet,
  ScanLine,
  Coins,
  Rocket,
} from "lucide-react";

export const dynamic = "force-dynamic";

// สถิตย์: หน้านี้อธิบายวิธีติดตั้ง Line Tracking ทีละขั้น อ้างอิงจากพฤติกรรมจริงของโค้ด
// (embed.js, /go, /t, /s, webhook LINE, ocrService, connectors.ts) — ไม่ใช่คำอธิบายลอย ๆ
export default function LineTrackingGuidePage() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="LINE Tracking" title={<>คู่มือติดตั้ง Line Tracking</>} subtitle={<>
          ทำตามลำดับ 1 → 11 ด้านล่าง เพื่อให้ระบบติดตามได้ตั้งแต่คลิกโฆษณา จนถึงยอดขายจริง
        </>} />

      {/* 1. ภาพรวม */}
      <section className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Rocket className="h-5 w-5 text-brand-blue" />
          <h2 className="text-base font-semibold text-slate-900">1. ภาพรวมการติดตั้ง</h2>
        </div>
        <p className="mb-3 text-sm text-slate-600">
          Line Tracking เชื่อมทุกขั้นตอนของ funnel เข้าด้วยกัน ตั้งแต่คนคลิกโฆษณา จนถึงยอดขายจริง
          แล้วส่งข้อมูล conversion กลับไปให้แพลตฟอร์มโฆษณาแต่ละเจ้า เพื่อให้ระบบ optimize โฆษณาได้แม่นขึ้น:
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-700">
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100">Ads (Google/Meta/TikTok/...)</span>
          <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100">เว็บไซต์ (ฝังโค้ด embed.js)</span>
          <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100">LINE OA</span>
          <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-100">Lead</span>
          <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100">Conversion (ปิดการขาย/ชำระเงิน)</span>
          <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100">ส่งกลับ GA4 / Google Ads / Meta / TikTok</span>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          ทุก credential (LINE OA, GA4, Meta, TikTok ฯลฯ) ตั้งค่าแยกต่อ <strong>โปรเจกต์</strong> ที่หน้า
          Setup Wizard: <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">/line-tracking/projects/{"{id}"}/setup</code>
          {" "}— แต่ละลูกค้า/โปรเจกต์เชื่อม LINE OA และแพลตฟอร์มโฆษณาของตัวเองแยกกัน ไม่ปนกัน
        </p>
      </section>

      {/* 2. Embed */}
      <section className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Code2 className="h-5 w-5 text-brand-blue" />
          <h2 className="text-base font-semibold text-slate-900">2. ฝังโค้ด (Embedding) บนเว็บไซต์</h2>
        </div>
        <p className="mb-3 text-sm text-slate-600">
          วางสคริปต์นี้ใน <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">&lt;head&gt;</code>{" "}
          ของทุกหน้าเว็บที่รับทราฟฟิกจากโฆษณา (หรือใส่ผ่าน Google Tag Manager ก็ได้ — วิธีทำอยู่ด้านล่าง)
          ด้านล่างเป็นตัวอย่างจริงจากโดเมนของระบบ — แก้แค่{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">project=</code>{" "}
          ให้เป็น slug ของโปรเจกต์ตัวเอง:
        </p>
        <pre className="overflow-x-auto rounded-lg bg-slate-100 border border-slate-200 p-4 text-xs text-slate-800">
{`<script src="https://your-domain.com/embed.js?project=your-project-slug"></script>`}
        </pre>
        <p className="mt-2 text-xs text-slate-500">
          ใส่ project เป็นส่วนหนึ่งของ src ตรงๆ (ไม่ใช้ data-project) เพราะ Google Tag Manager
          บางเวอร์ชันจะดรอป attribute แบบ data-* ทิ้งตอนแทรกสคริปต์ ทำให้ระบบหาโปรเจกต์ไม่เจอ
          และไม่นับผู้เข้าเว็บเลยแม้จะติดตั้งถูกทุกขั้นตอน
        </p>
        <div className="mt-4 rounded-lg bg-brand-blue/10 p-3">
          <p className="mb-2 text-sm font-medium text-slate-800">
            วิธีติดตั้งผ่าน Google Tag Manager (แนะนำ — ง่ายสุด สำหรับคนส่วนใหญ่)
          </p>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
            <li>
              เข้า{" "}
              <a href="https://tagmanager.google.com/" target="_blank" rel="noreferrer" className="text-brand-blue hover:underline">
                Google Tag Manager
              </a>{" "}
              (tagmanager.google.com) → เลือก container ของเว็บ
            </li>
            <li>
              Tags → New → Tag Configuration → เลือก <strong>Custom HTML</strong> → วางสคริปต์ embed ด้านบน (อันเดียวกัน)
            </li>
            <li>
              Triggering → เลือก <strong>All Pages</strong> (ยิงทุกหน้า)
            </li>
            <li>
              กด Save → แล้วกด <strong>Submit / Publish</strong>
            </li>
          </ol>
          <p className="mt-2 text-xs text-slate-500">
            หมายเหตุ: ถ้าไม่มี GTM ค่อยวางสคริปต์ใน <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">&lt;head&gt;</code>{" "}
            ของเว็บตรงๆ ตามตัวอย่างด้านบน
          </p>
        </div>
        <p className="mt-3 text-sm text-slate-600">สคริปต์นี้ทำอะไรบ้าง:</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-slate-600">
          <li>
            อ่านค่าพารามิเตอร์จาก URL ของหน้า: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">utm_source</code>,{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">utm_medium</code>,{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">utm_campaign</code>,{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">utm_adset</code>,{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">utm_content</code>,{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">utm_term</code> และ click id ของแต่ละแพลตฟอร์ม:{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">gclid</code> (Google),{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">fbclid</code> (Meta),{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">ttclid</code> (TikTok),{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">msclkid</code> (Microsoft),{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">twclid</code> (X),{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">scclid</code>/
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">sc_click_id</code> (Snapchat) รวมถึง GA client id จากคุกกี้{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">_ga</code>
          </li>
          <li>
            ส่งข้อมูลนี้ไปบันทึกที่ <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">/api/track/{"{project}"}</code>{" "}
            แล้วได้ <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">click_id</code> กลับมา เก็บไว้ใน{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">localStorage</code> ของเบราว์เซอร์ผู้ใช้
          </li>
          <li>
            ดักฟังการคลิกทุกปุ่ม/ลิงก์ที่มี attribute{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">data-line-add</code> หรือเป็นลิงก์ LINE
            (เช่น <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">lin.ee</code>,{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">line.me</code>) — เมื่อลูกค้ากดปุ่มแอดไลน์
            จะยิง event <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">lineclick</code> เก็บเป็น &quot;สัญญาณตั้งใจ&quot;
            ของลูกค้าคนนั้น โดย <strong>ไม่แก้ไขปุ่ม LINE เดิม</strong> (ยังกดแอดเพื่อนแบบ 1-tap ได้ปกติ)
          </li>
          <li>
            ถ้าใส่ <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">data-line-add</code> บนแท็ก{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">&lt;a&gt;</code> สคริปต์จะเปลี่ยน{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">href</code> ให้พาไปหน้า LINE Login
            (ทางเลือก สำหรับกรณีต้องการยืนยันตัวตนแม่นขึ้น)
          </li>
        </ul>
        <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          <strong>ถ้าเว็บมีปุ่ม/ลิงก์ LINE อยู่แล้ว (lin.ee / line.me) → ไม่ต้องใส่เพิ่ม</strong> — embed.js
          ตรวจจับลิงก์ LINE ที่มีอยู่และนับคลิกให้อัตโนมัติ จะใส่{" "}
          <code className="rounded bg-emerald-100 px-1 py-0.5 text-xs">data-line-add</code> เพิ่มก็ต่อเมื่อปุ่มของคุณ{" "}
          <strong>ไม่ใช่</strong> ลิงก์ LINE มาตรฐาน (เช่น เป็นปุ่มที่ลิงก์ไป path อื่นแล้วค่อยพาไป LINE)
        </div>
      </section>

      {/* 3. Tracking link */}
      <section className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Link2 className="h-5 w-5 text-brand-blue" />
          <h2 className="text-base font-semibold text-slate-900">
            3. สร้าง &amp; ใช้ Tracking Link (/go, /t) สำหรับยิงแอด
          </h2>
        </div>
        <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          <strong>จำเป็น = ข้อ 2 ฝังโค้ด · ไม่บังคับ = ข้อ 3 tracking links</strong>
          <p className="mt-1">
            ระบบรู้ campaign / ช่องทาง (channel) <strong>อัตโนมัติจาก UTM + click id</strong> ที่ embed code (ข้อ 2)
            อ่านจาก URL อยู่แล้ว — <strong>ไม่ต้องตั้งค่าอะไรเพิ่มถ้าโฆษณาใส่ UTM/auto-tagging อยู่แล้ว</strong>{" "}
            (Google Ads auto-tagging = gclid, Meta = fbclid ฯลฯ ระบบเก็บให้เองทั้งหมด)
          </p>
          <p className="mt-1">
            สิ่งที่จำเป็นจริงๆ คือข้อ 2 (ฝัง embed) เท่านั้น ส่วนข้อ 3 (Tracking Links) นี้เป็นแค่ &quot;ตัวช่วย&quot; —
            เป็นลิงก์สำเร็จรูปที่ใส่ UTM ให้แล้ว เอาไว้ก็อปไปยิงแอดในกรณีที่อยากกำหนด utm_campaign เอง ไม่บังคับใช้
          </p>
        </div>
        <p className="mb-3 text-sm text-slate-600">
          ทุกโปรเจกต์มีหน้า Tracking Links ให้สร้าง/คัดลอกลิงก์สำเร็จรูปสำหรับแต่ละแพลตฟอร์ม มี 2 รูปแบบ:
        </p>
        <div className="space-y-3 text-sm text-slate-600">
          <div>
            <p className="font-medium text-slate-800">
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">/t/{"{slug}"}</code> — มีหน้า landing คั่นก่อน
            </p>
            <p>
              เหมาะกับยิงแอดตรง ๆ: บันทึกคลิก (UTM + click id) แล้วโชว์หน้า &quot;แอด LINE คุยกับเรา&quot; ก่อนพาไปที่ LINE
              ใช้เมื่อไม่มีเว็บไซต์ปลายทางของตัวเอง หรืออยากมีหน้ายืนยันก่อนแอด
            </p>
          </div>
          <div>
            <p className="font-medium text-slate-800">
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">/go/{"{slug}"}</code> — ยิงตรงเข้า LINE เลย
            </p>
            <p>
              บันทึกคลิกแบบเดียวกัน แต่ redirect ตรงเข้า LINE Login flow ทันที ไม่มีหน้าคั่น
              เหมาะกับโพสต์ Facebook, ลิงก์ bio, หรือปุ่ม &quot;แอด LINE&quot; แบบ 1 คลิก
            </p>
          </div>
        </div>
        <p className="mt-3 mb-1 text-sm text-slate-600">ตัวอย่างลิงก์ที่ระบบสร้างให้อัตโนมัติต่อโปรเจกต์:</p>
        <pre className="overflow-x-auto rounded-lg bg-slate-100 border border-slate-200 p-4 text-xs text-slate-800">
{`# Google Ads (วาง Final URL ในแคมเปญ)
{BASE}/t/{slug}?utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_term={keyword}&utm_content={creative}&gclid={gclid}

# Meta Ads
{BASE}/t/{slug}?utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_adset={{adset.name}}&utm_content={{ad.name}}&fbclid={{fbclid}}

# TikTok Ads
{BASE}/t/{slug}?utm_source=tiktok&utm_medium=paid_social&utm_campaign=__CAMPAIGN_NAME__&utm_content=__CID_NAME__&ttclid=__CLICKID__

# โพสต์ Facebook แบบไม่ยิงแอด (organic) ตรงเข้า LINE เลย
{BASE}/go/{slug}?utm_source=facebook&utm_medium=social&utm_campaign=post`}
        </pre>
        <p className="mt-3 text-sm text-slate-600">
          นอกจากนี้ยังมีลิงก์สำเร็จรูปให้ทุกช่องทาง (LINE Ads, Microsoft/Bing, X, Snapchat, YouTube, Email, Organic)
          ที่หน้า Tracking Links ของแต่ละโปรเจกต์ — คัดลอกไปวางในตัวจัดการโฆษณาแต่ละแพลตฟอร์มได้เลย
          ระบบยังรองรับลิงก์สั้น <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">/s/{"{code}"}</code>{" "}
          ที่ redirect ไปยังลิงก์เต็มพร้อมนับจำนวนคลิก เหมาะกับใส่ในโพสต์หรือ bio ที่ต้องการลิงก์สั้น ๆ
        </p>
      </section>

      {/* 4. LINE OA */}
      <section className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <MessageCircleHeart className="h-5 w-5 text-emerald-600" />
          <h2 className="text-base font-semibold text-slate-900">4. เชื่อม LINE OA</h2>
        </div>
        <p className="mb-3 text-sm text-slate-600">
          ไปที่ Setup Wizard ของโปรเจกต์ → การ์ด &quot;Connect LINE OA&quot; แล้วกรอก:
        </p>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="th">Field</th>
              <th className="th">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr>
              <td className="td font-medium">LINE OA ID (@id)</td>
              <td className="td">เช่น <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">@abcclinic</code> — LINE ID ของ Official Account</td>
            </tr>
            <tr>
              <td className="td font-medium">Add Friend URL</td>
              <td className="td">ลิงก์ <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">https://lin.ee/xxxx</code> จากหน้า LINE Official Account Manager</td>
            </tr>
            <tr>
              <td className="td font-medium">LINE Login Channel ID / Secret</td>
              <td className="td">จาก LINE Developers Console → สร้าง Channel ประเภท &quot;LINE Login&quot; (จำเป็นสำหรับโหมด real — ไม่ใส่ระบบจะรันแบบ mock)</td>
            </tr>
            <tr>
              <td className="td font-medium">LIFF ID</td>
              <td className="td">ถ้าต้องการเปิดหน้า LIFF ในแอป LINE (ไม่บังคับ)</td>
            </tr>
            <tr>
              <td className="td font-medium">Messaging Channel Secret</td>
              <td className="td">จาก Channel ประเภท &quot;Messaging API&quot; — ใช้ยืนยันลายเซ็น (X-Line-Signature) ของ webhook</td>
            </tr>
            <tr>
              <td className="td font-medium">Messaging Access Token</td>
              <td className="td">Channel access token (long-lived) — ใช้ดึงโปรไฟล์ผู้ใช้ และดาวน์โหลดรูป (เช่น สลิปโอนเงิน)</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-sm text-slate-600">
          จากนั้นตั้งค่า Webhook URL ในหน้า LINE Developers Console ของ Messaging API channel เป็น:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-100 border border-slate-200 p-4 text-xs text-slate-800">
{`https://your-domain.com/api/webhooks/line/{projectId}`}
        </pre>
        <p className="mt-2 text-sm text-slate-600">
          แล้วเปิด &quot;Use webhook&quot; ให้เป็น ON — <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{"{projectId}"}</code>{" "}
          คือ id ของโปรเจกต์ (ดูได้จาก URL ของหน้าโปรเจกต์ใน MarsOS)
          เมื่อลูกค้าแอดเพื่อน/ทักแชท/ส่งรูปสลิป ระบบจะสร้าง Lead อัตโนมัติ อัปเดตสถานะ และอ่านสลิปให้ (ดูข้อ 10)
        </p>
        {/* จุดที่พลาดกันบ่อยที่สุด: ตั้งที่ LINE Developers อย่างเดียวไม่พอ ต้องเปิดที่ OA Manager ด้วย */}
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <div className="font-semibold">⚠️ ต้องตั้งอีกที่หนึ่งด้วย — ไม่งั้น event จะไม่เข้าเลย</div>
          <p className="mt-1">
            เปิด{" "}
            <a
              href="https://manager.line.biz/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline"
            >
              LINE Official Account Manager
            </a>{" "}
            → ตั้งค่า → การตอบกลับ แล้วตั้ง 2 อย่างนี้:
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            <li>เปิด <b>Webhook</b></li>
            <li>ปิด <b>ตอบกลับอัตโนมัติ</b> — ถ้าเปิดค้างไว้ LINE จะตอบข้อความอัตโนมัติแทน แล้วไม่ส่ง event มาที่ระบบ</li>
          </ul>
          <p className="mt-2">
            และอย่าเชื่อปุ่ม <b>Verify</b> อย่างเดียว — Verify ส่ง payload เปล่ามาทดสอบ ผ่านได้แม้ event จริงจะยังไม่เข้า
            ให้ทดสอบด้วยการ <b>แอดเพื่อน OA จริง 1 ครั้ง</b> แล้วดูว่ามี Lead ขึ้นในระบบไหม
          </p>
        </div>
      </section>

      {/* 5. GA4 */}
      <section className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-brand-blue" />
          <h2 className="text-base font-semibold text-slate-900">5. เชื่อม GA4</h2>
        </div>
        <p className="mb-3 text-sm text-slate-600">
          ส่ง conversion เข้า GA4 ผ่าน Measurement Protocol กรอก 2 ฟิลด์นี้ในการ์ด &quot;Connect GA4&quot;:
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
          <li>
            <strong>Measurement ID</strong> (เช่น <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">G-XXXXXXXXXX</code>) —
            GA4 Admin → Data Streams → เลือกสตรีมเว็บไซต์
          </li>
          <li>
            <strong>API Secret</strong> — GA4 Admin → Data Streams → เลือกสตรีม → Measurement Protocol API secrets → Create
          </li>
        </ul>
      </section>

      {/* 6. Meta */}
      <section className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Facebook className="h-5 w-5 text-brand-blue" />
          <h2 className="text-base font-semibold text-slate-900">6. เชื่อม Meta Ads</h2>
        </div>
        <p className="mb-3 text-sm text-slate-600">
          ส่ง conversion เข้า Meta ผ่าน Conversions API (CAPI) กรอก 2 ฟิลด์นี้ในการ์ด &quot;Connect Meta Ads&quot;:
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
          <li>
            <strong>Pixel ID</strong> — Meta Events Manager → เลือก Data Source (Pixel) → คัดลอก ID (ตัวเลข)
          </li>
          <li>
            <strong>Access Token</strong> — Events Manager → Settings → Conversions API → Generate Access Token
          </li>
        </ul>
      </section>

      {/* 7. TikTok */}
      <section className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Music2 className="h-5 w-5 text-brand-blue" />
          <h2 className="text-base font-semibold text-slate-900">7. เชื่อม TikTok</h2>
        </div>
        <p className="mb-3 text-sm text-slate-600">
          ส่ง conversion เข้า TikTok ผ่าน Events API กรอก 2 ฟิลด์นี้ในการ์ด &quot;Connect TikTok Ads&quot;:
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
          <li>
            <strong>Pixel ID (Event Set ID)</strong> — TikTok Ads Manager → Assets → Events → เลือก Pixel/Event Set → คัดลอก ID
          </li>
          <li>
            <strong>Access Token</strong> — TikTok Events API → สร้าง Access Token ของ Event Set นั้น
          </li>
        </ul>
      </section>

      {/* 8. Google Ads */}
      <section className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Search className="h-5 w-5 text-brand-blue" />
          <h2 className="text-base font-semibold text-slate-900">8. เชื่อม Google Ads</h2>
        </div>
        <p className="mb-3 text-sm text-slate-600">
          กรอกในการ์ด &quot;Connect Google Ads&quot; (สำหรับอัปโหลด Offline Conversion จริง ต้องมีทั้งสองส่วนด้านล่าง):
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
          <li>
            <strong>Customer ID</strong> — เลข Customer ID ของบัญชี Google Ads (ตัวเลขล้วน ไม่มีขีด)
          </li>
          <li>
            <strong>Conversion Action ID</strong> — Google Ads → Goals → Conversions → เลือก conversion action ที่ต้องการอัปโหลดออฟไลน์ → คัดลอก ID
          </li>
          <li>
            <strong>OAuth Client ID / Secret / Refresh Token / (Manager) Login Customer ID</strong> — สำหรับเปิดโหมดอัปโหลด conversion จริงผ่าน Google Ads API
          </li>
        </ul>
        <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          หมายเหตุ: ต้องมี <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">gclid</code> ติดมากับคลิกจาก tracking link
          (ข้อ 3) ระบบถึงจะส่ง conversion กลับเข้า Google Ads ได้ — ถ้าไม่มี gclid (เช่น ทราฟฟิก organic) จะข้ามการส่งให้แพลตฟอร์มนี้
        </div>
      </section>

      {/* 9. Google Sheet */}
      <section className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Sheet className="h-5 w-5 text-brand-blue" />
          <h2 className="text-base font-semibold text-slate-900">9. Google Sheet sync</h2>
        </div>
        <p className="mb-3 text-sm text-slate-600">
          ซิงก์ Lead ไป-กลับกับ Google Sheet ให้ทีมเซลส์อัปเดตสถานะได้จากในชีต กรอกในการ์ด &quot;Connect Google Sheet&quot;:
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
          <li><strong>Sheet URL</strong> — ลิงก์ Google Sheet ที่ต้องการซิงก์</li>
          <li><strong>Sheet ID</strong> — id ของสเปรดชีต (ส่วนตรงกลางของ URL)</li>
          <li><strong>Tab name</strong> — ชื่อแท็บ (sheet tab) ที่จะเขียนข้อมูล เช่น &quot;Leads&quot;</li>
          <li>
            <strong>Service Account JSON</strong> — คีย์ของ Google Service Account ที่แชร์สิทธิ์แก้ไขสเปรดชีตนั้นไว้แล้ว
            (สร้างจาก Google Cloud Console → IAM &amp; Admin → Service Accounts → Keys)
          </li>
        </ul>
      </section>

      {/* 10. OCR */}
      <section className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <ScanLine className="h-5 w-5 text-brand-blue" />
          <h2 className="text-base font-semibold text-slate-900">10. อ่านสลิปด้วย OCR</h2>
        </div>
        <p className="mb-3 text-sm text-slate-600">
          เมื่อลูกค้าส่งรูปสลิปโอนเงินเข้าแชท LINE ระบบจะพยายามอ่านยอดเงินให้อัตโนมัติผ่าน{" "}
          <strong>Gemini</strong> ผ่านช่องทาง AI ของ MarsOS (key เดียวกับ AI ส่วนอื่นของระบบ{" "}
          <strong>ไม่ต้องขอ API key แยก ไม่ต้องตั้งค่าเพิ่มต่อโปรเจกต์</strong>) ค่าใช้จ่ายแสดงในหน้า AI Cost หัวข้อ LINE Tracking ส่วน{" "}
          <a href="https://ocr.space/ocrapi" target="_blank" rel="noreferrer" className="text-brand-blue hover:underline">
            OCR.space
          </a>{" "}
          เป็นเพียงตัวสำรอง (fallback) ใช้เฉพาะกรณี Gemini อ่านไม่สำเร็จ:
        </p>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
          <li>
            <strong>โหมดหลัก:</strong> ไม่ต้องทำอะไรเพิ่ม — ระบบใช้ Gemini อ่านสลิปให้อัตโนมัติทันที (อ่านรูปสลิปโดยตรง เข้าใจว่าตัวเลขไหนคือยอดโอน)
          </li>
          <li>
            <strong>โหมดสำรอง:</strong> ทำงานเฉพาะเมื่อผู้ดูแลระบบตั้ง <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">OCR_SPACE_API_KEY</code> ไว้
            — ระบบจะสลับไปใช้ OCR.space เองเฉพาะครั้งที่ Gemini อ่านไม่สำเร็จ ถ้าไม่ได้ตั้งค่า จะไม่มีตัวสำรอง
          </li>
        </ol>
        <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          หมายเหตุ: OCR อ่านยอดเงินจากรูปเท่านั้น ไม่ใช่การตรวจสอบความถูกต้อง/ของจริงของสลิป
          เซลส์ยังต้องยืนยันก่อนกดสถานะ &quot;PAID&quot; เสมอ (OCR อาจอ่านผิด หรือสลิปอาจถูกแก้ไข)
        </div>
      </section>

      {/* 11. Conversion value */}
      <section className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Coins className="h-5 w-5 text-brand-blue" />
          <h2 className="text-base font-semibold text-slate-900">11. เรื่องมูลค่า Conversion (value)</h2>
        </div>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
          <li>
            ค่าเริ่มต้นของมูลค่า Lead คือ <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">0</code>{" "}
            (ตั้งได้ต่อโปรเจกต์เป็นค่ามาตรฐาน ถ้าต้องการให้ conversion มีมูลค่าคงที่)
          </li>
          <li>
            เมื่อลูกค้าส่งรูปสลิปโอนเงิน และ Gemini (ข้อ 10) อ่านยอดได้สำเร็จ ระบบจะ<strong>อัปเดตมูลค่า Lead ให้เป็นยอดจริงจากสลิปโดยอัตโนมัติ</strong>{" "}
            แทนค่าเริ่มต้น — ค่านี้จะถูกใช้ตอนส่ง conversion กลับไปยัง GA4 / Google Ads / Meta / TikTok ฯลฯ
          </li>
          <li>เซลส์ยังตรวจสอบและยืนยันยอดก่อนปิดสถานะ &quot;PAID&quot; ได้เสมอ หากยอดที่อ่านได้ผิดพลาด</li>
        </ul>
      </section>

      <div className="flex justify-end">
        <Link href="/line-tracking" className="btn-secondary">← กลับหน้าแดชบอร์ด</Link>
      </div>
    </div>
  );
}
