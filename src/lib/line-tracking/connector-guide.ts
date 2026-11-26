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
  GOOGLE_ADS: {
    intro: "ส่ง Offline Conversion (ยอดขายจริงจาก LINE) กลับเข้า Google Ads ด้วย gclid — จับคู่ได้เฉพาะ lead ที่มาจากคลิกโฆษณา Google (มี gclid / gbraid / wbraid)",
    steps: [
      "เข้า Google Ads → Goals → Conversions → New conversion action → Import → CRM, file uploads → Track conversions from clicks → สร้าง conversion action แล้วก็อป “Conversion Action ID” (เลขท้าย URL ctId=...) มาวางช่อง Conversion Action ID",
      "ก็อป Customer ID (เลข 10 หลักมุมขวาบนของ Google Ads ใส่เฉพาะตัวเลข ไม่ต้องมีขีด) มาวางช่อง Customer ID",
      "เข้าบัญชี MCC → Admin → API Center → ก็อป Developer Token มาวางช่อง Developer Token (ต้องขออนุมัติก่อนใช้กับบัญชีจริง)",
      "เข้า Google Cloud Console → APIs & Services → Credentials → สร้าง OAuth Client ID → ก็อป Client ID และ Client Secret มาวางช่อง OAuth Client ID / OAuth Client Secret",
      "เข้า OAuth Playground (developers.google.com/oauthplayground) → ตั้งค่าใช้ Client ID/Secret ของตัวเอง → เลือก scope https://www.googleapis.com/auth/adwords → ขอ Refresh Token → วางช่อง OAuth Refresh Token",
      "ถ้าเข้าผ่านบัญชีศูนย์กลาง (MCC) ใส่ Login Customer ID (ตัวเลขล้วน) ด้วย — ไม่เข้าผ่าน MCC ปล่อยว่าง",
      "กด Save → Test Connection (ระบบเช็คของจริงว่า Conversion Action ID นี้มีอยู่ในบัญชี โดยไม่ส่ง conversion) แล้วไปตรวจสวิตช์ Google Ads ที่หน้า Conversion Mapping ว่าเปิดในสถานะที่ต้องการ (โปรเจกต์เก่าจะปิดอยู่จนกว่าจะเปิดเอง)",
    ],
    link: { label: "เปิด Google Ads", url: "https://ads.google.com/aw/conversions" },
  },
  CUSTOM_WEBHOOK: {
    intro: "ส่ง Conversion เป็น JSON เข้าระบบของคุณเอง (CRM / Data Warehouse / Make / n8n) ผ่านการยิง POST — ใช้เมื่ออยากได้ event เดียวกับที่ส่งเข้าแพลตฟอร์มโฆษณา",
    steps: [
      "ที่ระบบปลายทาง สร้าง endpoint ที่รับ POST แบบ JSON และเข้าถึงได้จากอินเทอร์เน็ต (ต้องเป็น https:// เท่านั้น ที่อยู่ภายในเครือข่าย/localhost ใช้ไม่ได้) แล้ววาง URL ในช่อง Destination URL",
      "(ไม่บังคับ) ถ้าปลายทางต้องมี token ใส่ Custom Headers เป็น JSON เช่น {\"Authorization\":\"Bearer xxxxx\"} — host / content-type / content-length / x-marsos-signature ตั้งทับไม่ได้",
      "(ไม่บังคับ) ใส่ Signing Secret แล้วระบบจะเซ็นเนื้อ request ด้วย HMAC-SHA256 ส่งใน header x-marsos-signature (ค่า hex) — ฝั่งปลายทางคำนวณจาก body ดิบด้วย secret เดียวกันแล้วเทียบ เพื่อยืนยันว่ามาจาก MarsOS จริง",
      "กด Save → Test Connection (ตรวจแค่ว่า URL ใช้ได้ ยังไม่ส่ง request ทดสอบ ผลจริงดูที่หน้า Conversions หลังยิงครั้งแรก)",
      "ไปตรวจสวิตช์ Custom Webhook ที่หน้า Conversion Mapping ว่าเปิดในสถานะที่ต้องการ (โปรเจกต์เก่าจะปิดอยู่จนกว่าจะเปิดเอง)",
    ],
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
  LINE_ADS: {
    intro: "ส่ง Conversion กลับเข้า LINE Ads ผ่าน LINE Conversion API (ฝั่งเซิร์ฟเวอร์ ใช้คู่กับ LINE Tag บนเว็บ)",
    steps: [
      "เข้า LINE Business Manager → LINE Tag → เลือก Tag ของลูกค้า",
      "ก็อป “LINE Tag ID” มาวางช่อง LINE Tag ID",
      "เปิดหน้า Conversion API ของ Tag → ออก “Tag Access Token” → ก็อปมาวางช่อง Tag Access Token",
      "(ไม่บังคับ แต่แนะนำ) ใส่ Channel ID (ตัวเลขล้วน จาก LINE Developers) — ใส่แล้วระบบจะส่ง LINE User ID ไปจับคู่ด้วยทำให้แม่นกว่ามาก LINE บังคับให้มี Channel ID คู่กันเสมอ",
      "กด Save → Test Connection (ตรวจแค่ว่ากรอกครบและรูปแบบถูก ผลจริงดูที่หน้า Conversions หลังยิงครั้งแรก)",
    ],
    link: { label: "เปิด LINE Business Manager", url: "https://tag.line.me/" },
  },
  MICROSOFT_ADS: {
    intro: "ส่ง Conversion กลับเข้า Microsoft Ads ผ่าน Conversions API (ผูกกับ UET Tag) — ถ้าเคยตั้งแบบเดิม (Customer ID / Developer Token) ต้องใส่ UET Tag ID และ Token ใหม่",
    steps: [
      "เข้า Microsoft Advertising → Tools → UET tag → เลือก tag ของลูกค้า",
      "ก็อป “UET Tag ID” (ตัวเลขล้วน) มาวางช่อง UET Tag ID",
      "กด แก้ไข tag → เปิด “Use Conversions API” → กด Copy Token → วางช่อง Conversions API Token",
      "(ไม่บังคับ) ใส่ชื่อ Conversion Goal ในช่อง Conversion Goal Name ถ้าอยากให้ตรงกับเป้าหมายที่ตั้งไว้",
      "ต้องมี Conversion Goal แบบ Event ที่ใช้ UET tag นี้ใน Microsoft Advertising ไว้ก่อน",
      "กด Save → Test Connection (ตรวจแค่ว่ากรอกครบและรูปแบบถูก ผลจริงดูที่หน้า Conversions หลังยิงครั้งแรก)",
    ],
    link: { label: "เปิด Microsoft Advertising", url: "https://ads.microsoft.com/" },
  },
  X_ADS: {
    intro: "ส่ง Conversion กลับเข้า X Ads ผ่าน Conversion API — จับคู่ได้เฉพาะ lead ที่มี twclid (มาจากคลิกโฆษณา X)",
    steps: [
      "เข้า X Ads Manager → Tools → Events Manager → เลือก Pixel ของลูกค้า",
      "ก็อป “Pixel ID” มาวางช่อง Pixel ID",
      "ออก Access Token แบบ OAuth 1.0a user context ของผู้ใช้ที่มีสิทธิ์ AD_MANAGER ขึ้นไป → วางช่อง Access Token",
      "(ไม่บังคับ) ใส่ Default Event ID ถ้าต้องการกำหนด event ที่ตั้งไว้ใน Events Manager",
      "กด Save → Test Connection (ตรวจแค่ว่ากรอกครบ ผลจริงดูที่หน้า Conversions หลังยิงครั้งแรก)",
    ],
    link: { label: "เปิด X Ads Manager", url: "https://ads.x.com/" },
  },
  SNAPCHAT_ADS: {
    intro: "ส่ง Conversion กลับเข้า Snapchat Ads ผ่าน Conversions API",
    steps: [
      "เข้า Snapchat Ads Manager → Events Manager → เลือก Pixel ของลูกค้า",
      "ก็อป “Pixel ID” มาวางช่อง Pixel ID",
      "ไปที่ Conversions API → สร้าง/ก็อป Access Token → วางช่อง Access Token",
      "กด Save → Test Connection (ตรวจแค่ว่ากรอกครบ ผลจริงดูที่หน้า Conversions หลังยิงครั้งแรก)",
    ],
    link: { label: "เปิด Snapchat Ads Manager", url: "https://ads.snapchat.com/" },
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
