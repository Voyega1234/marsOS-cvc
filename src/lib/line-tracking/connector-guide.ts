// Plain-language, click-by-click setup steps per connector — for non-technical users.
// Shown at the top of each ConnectionCard so anyone can follow along.
import type { ConnectionType } from "./enums";

export interface ConnectorGuide {
  intro: string;
  steps: string[];
  link?: { label: string; url: string };
}

export const CONNECTOR_GUIDE: Partial<Record<ConnectionType, ConnectorGuide>> = {
  LINE: {
    intro: "⚠️ ตั้งช่อง “จำเป็น” ให้ครบ ไม่งั้น LINE ไม่ส่ง Lead เข้าระบบ. โหมดโปร่งใส (ลูกค้าไม่เห็นหน้า login) — ใช้แค่ Messaging API channel",
    steps: [
      "เข้า LINE Developers → เลือก Provider ของลูกค้า → เปิด Channel แบบ Messaging API",
      "แท็บ Basic settings → ก็อป “Channel secret” → วางช่อง Messaging Channel Secret (จำเป็น)",
      "แท็บ Messaging API → กด Issue “Channel access token (long-lived)” → วางช่อง Messaging Access Token (จำเป็น) · ก็อป “Bot basic ID” (@xxxx) → วางช่อง LINE OA ID",
      "แท็บ Messaging API → ช่อง Webhook URL → วาง URL ที่ระบบแสดงด้านล่าง → กด Verify ให้ขึ้น Success → เปิดสวิตช์ “Use webhook” (สำคัญมาก! ถ้าไม่เปิด LINE จะไม่ส่ง Lead เข้าระบบเลย)",
      "ถ้าลูกค้ามีบอท/webhook เดิมอยู่แล้ว (LINE ตั้ง webhook ได้ URL เดียว): ก็อป URL เดิมของบอทเก็บไว้ก่อนวางทับ → ในฟอร์มด้านล่างเลือกโหมด Webhook เป็น “Option 2 — forward ต่อให้บอทเดิม” แล้ววาง URL เดิมในช่อง Webhook URL เดิมของบอทลูกค้า → บอทเดิมจะได้รับทุก event เหมือนเดิม (ตอบแชทได้ปกติ) และระบบเราก็เก็บ Lead ได้พร้อมกัน",
      "⚠️ ต้องเปิดอีกที่หนึ่งด้วย — LINE Official Account Manager (manager.line.biz) → ตั้งค่า → การตอบกลับ: เปิด “Webhook” และปิด “ตอบกลับอัตโนมัติ” · ตั้งที่ LINE Developers อย่างเดียวไม่พอ ถ้าตรงนี้ไม่เปิด LINE จะตอบข้อความอัตโนมัติแทนแล้วไม่ส่ง event มาที่ระบบเลย",
      "ก็อป Add Friend URL (lin.ee/...) จาก LINE OA Manager → วางช่อง Add Friend URL (จำเป็น)",
      "กด Save → Test Connection ให้ขึ้น PASS",
      "เทสของจริง: แอดเพื่อน OA 1 ครั้ง แล้วเช็คว่ามี Lead เข้าระบบ · ปุ่ม Verify ส่งข้อมูลเปล่ามาทดสอบเฉยๆ ผ่านแล้วยังไม่การันตีว่า event จริงเข้า",
      "(ไม่บังคับ) ถ้าอยาก attribution แม่นระดับคลิก 1:1 ค่อยเพิ่ม LINE Login channel ภายหลัง — โหมดปกติไม่ต้องใช้",
      "(ไม่บังคับ — เฉพาะลูกค้าที่ยิงโฆษณา/โพสต์เข้า LINE ตรง ๆ โดยไม่ผ่านเว็บ แล้วอยากรู้ที่มาของคน add) ตั้ง LIFF: LINE Developers → Provider เดิม → สร้าง/เปิด LINE Login channel → แท็บ LIFF → Add → Endpoint URL ใส่ {โดเมนระบบ}/liff/{slug ของโปรเจกต์} · Scope เลือก profile → ได้ LIFF ID มาวางช่อง LIFF ID ในฟอร์มนี้ → ใช้ลิงก์ https://liff.line.me/{LIFF ID}?src=ชื่อช่องทาง แจกได้เลย (เป็นโดเมน LINE แท้ วัด add ได้แม่นรายคน) — โปรเจกต์ที่ไม่ตั้ง LIFF ทุกอย่างทำงานปกติเหมือนเดิม",
    ],
    link: { label: "เปิด LINE Developers", url: "https://developers.line.biz/console/" },
  },
  GA4: {
    intro: "ส่ง Conversion เข้า GA4 (Google Analytics) — ใช้วัดผลโฆษณา",
    steps: [
      "เข้า Google Analytics → เลือก property ของลูกค้า",
      "กด ⚙️ Admin (มุมซ้ายล่าง) → Data streams → เลือก stream ของเว็บ",
      "ก็อป “Measurement ID” (ขึ้นต้น G-) มาวางช่อง Measurement ID",
      "เลื่อนลงหา “Measurement Protocol API secrets” → กด Create → ก็อป “Secret value” มาวางช่อง API Secret",
      "กด Save → Test Connection",
    ],
    link: { label: "เปิด Google Analytics", url: "https://analytics.google.com/" },
  },
  META_ADS: {
    intro: "ส่ง Conversion กลับเข้า Meta (Facebook/Instagram Ads) ผ่าน Conversions API",
    steps: [
      "เข้า Meta Events Manager → เลือก Pixel/Dataset ของลูกค้า",
      "ก็อป “Pixel ID” (เลขชุดยาว) มาวางช่อง Pixel ID",
      "ไปที่ Settings → Conversions API → “Generate access token” → ก็อปมาวางช่อง Access Token",
      "แท็บ Test Events → ก็อป “Test event code” (ขึ้นต้น TEST...) มาวางช่อง Test Event Code — token ที่ Meta ออกให้ CAPI มีสิทธิ์ส่ง event อย่างเดียว อ่านข้อมูล Pixel ไม่ได้ การยิง test event จึงเป็นวิธีเดียวที่ยืนยันได้ว่าส่งเข้า Pixel ตัวนี้ได้จริง",
      "กด Save → Test Connection → ต้องขึ้น PASS พร้อมข้อความว่า Meta รับ event แล้ว และเห็น event โผล่ในแท็บ Test Events (event ที่มี test code ไม่เข้า reporting ไม่กระทบการ optimize)",
      "(ไม่บังคับ) ช่อง “ส่งเบอร์โทร (เข้ารหัส SHA-256)” — lead ที่มาจากแชท LINE ส่วนใหญ่ไม่มี fbclid ทำให้ Meta จับคู่คนไม่ได้เลย เปิดช่องนี้แล้วระบบจะแนบเบอร์ที่ทีมกรอกเอง/อ่านได้จากสลิป โดยเข้ารหัสก่อนส่งเสมอ (Meta ไม่ได้เห็นเบอร์จริง) · ค่าเริ่มต้นคือปิด และ lead ที่ยังไม่มีเบอร์ก็ไม่ส่งอะไรเพิ่ม — เปิดเมื่อตกลงกับลูกค้าเจ้าของข้อมูลแล้วเท่านั้น",
    ],
    link: { label: "เปิด Meta Events Manager", url: "https://business.facebook.com/events_manager2/" },
  },
  TIKTOK_ADS: {
    intro: "ส่ง Conversion กลับเข้า TikTok Ads ผ่าน Events API",
    steps: [
      "เข้า TikTok Ads Manager → Assets → Events → Web Events → เลือก Pixel ของลูกค้า",
      "ก็อป “Pixel ID / Event Set ID” มาวางช่อง Pixel ID",
      "ไปที่ Settings → Events API → “Generate Access Token” → ก็อปมาวางช่อง Access Token",
      "กด Save → Test Connection",
    ],
    link: { label: "เปิด TikTok Ads Manager", url: "https://ads.tiktok.com/" },
  },
  GOOGLE_SHEET: {
    intro: "ซิงก์ Lead ไป-กลับกับ Google Sheet ให้ทีมเซลส์อัปเดตสถานะได้",
    steps: [
      "วาง Service Account JSON (ทีมงานสร้างให้) ในช่องด้านล่าง",
      "ระบบจะแสดงอีเมล Service Account → เปิด Google Sheet → Share → วางอีเมลนั้น (สิทธิ์ Editor)",
      "ก็อป Sheet ID จาก URL (ส่วนระหว่าง /d/ กับ /edit) มาวางช่อง Sheet ID",
      "กด Save → Test Connection",
    ],
  },
};
