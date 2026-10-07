/**
 * คู่มือ "วิธีเอาค่ามาใส่" ของแต่ละแพลตฟอร์ม (ข้อมูลล้วน ไม่มี React) — ใช้ทั้งแสดงใน ConnectHowTo และเป็นความรู้ให้ AI ช่วยแก้ปัญหา
 * ห้ามใส่ secret ใด ๆ ในไฟล์นี้
 */
import type { UploadPlatformId } from './platform-info'

/** ลิงก์ลัดไปหน้าที่ต้องใช้ — href มี {wp} {shop} {wfShort} {wixSite} ได้ ถ้ายังไม่มีค่านั้นจะใช้ fallback (ไม่มี fallback = ไม่แสดง) */
export type ConnectGuideLink = { label: string; href: string; fallback?: string }
export type ConnectGuideItem = { field: string; steps: string[]; why: string; problems?: string[]; code?: string; links?: ConnectGuideLink[] }
export type ConnectGuideCtx = { wp?: string; shop?: string; wfShort?: string; wixSite?: string }

/** ค่าจากฟอร์ม Connect → ตัวแปรสำหรับลิงก์ (ตัด / ท้าย, เอาแค่ชื่อร้าน shopify, ชื่อย่อ webflow จาก xxx.webflow.io) */
export function connectGuideCtx(input: { wpUrl?: string; storeDomain?: string; siteUrl?: string; siteId?: string }): ConnectGuideCtx {
  const host = (u?: string) => { try { return new URL(/^https?:\/\//i.test(u || '') ? u! : `https://${u}`).hostname.toLowerCase() } catch { return '' } }
  const wp = (input.wpUrl || '').trim().replace(/\/+$/, '')
  const shopHost = host(input.storeDomain)
  const wfHost = host(input.siteUrl)
  return {
    wp: /^https?:\/\/[^/]+/i.test(wp) ? wp : undefined,
    shop: shopHost.endsWith('.myshopify.com') ? shopHost.slice(0, -'.myshopify.com'.length) : undefined,
    wfShort: wfHost.endsWith('.webflow.io') ? wfHost.slice(0, -'.webflow.io'.length) : undefined,
    wixSite: /^[0-9a-f-]{36}$/i.test((input.siteId || '').trim()) ? input.siteId!.trim() : undefined,
  }
}

/** แทนค่าตัวแปรใน href — คืน null ถ้าขาดค่าและไม่มี fallback */
export function resolveGuideLink(link: ConnectGuideLink, ctx: ConnectGuideCtx): string | null {
  let missing = false
  const href = link.href.replace(/\{(wp|shop|wfShort|wixSite)\}/g, (_, k: keyof ConnectGuideCtx) => {
    const v = ctx[k]
    if (!v) { missing = true; return '' }
    return k === 'wp' ? v : encodeURIComponent(v)
  })
  if (!missing) return href
  return link.fallback ?? null
}

const CUSTOM_PAYLOAD = `{
  "event": "article.publish",
  "title": "...",
  "slug": "...",
  "html": "<article>...</article>",
  "excerpt": "...",
  "coverImageBase64": "...",
  "coverMimeType": "image/webp",
  "publishMode": "draft | publish",
  "existingId": "(มีเมื่อ push ซ้ำ)"
}

// ping ตอนกดทดสอบ
{ "event": "ping" }

// เว็บต้องตอบ 2xx เป็น JSON
{ "url": "https://.../article", "id": "..." }`;

export const CONNECT_GUIDE: Record<UploadPlatformId, ConnectGuideItem[]> = {
  wordpress: [
    {
      field: "WordPress URL",
      steps: [
        "ใช้ URL หน้าแรกของเว็บ WordPress เช่น https://example.com",
        "ไม่ต้องใส่ /wp-admin ต่อท้าย",
      ],
      why: "ระบบจะส่งบทความไปที่ <url>/wp-json/wp/v2 — เว็บต้องเป็น https",
    },
    {
      field: "WP Username",
      steps: [
        "เข้า wp-admin → Users (ผู้ใช้) → Profile (โปรไฟล์)",
        "ดูช่อง \"Username\" (สีเทา แก้ไม่ได้) แล้วคัดลอกมาใส่",
      ],
      why: "ใช้คู่กับ Application Password — ต้องเป็น username ที่ใช้ล็อกอิน ไม่ใช่อีเมลหรือชื่อที่แสดง และผู้ใช้ต้องมีสิทธิ์ Editor หรือ Administrator",
      links: [{ label: "เปิดหน้า Profile ใน wp-admin", href: "{wp}/wp-admin/profile.php" }],
    },
    {
      field: "Application Password",
      steps: [
        "เข้า wp-admin → Users (ผู้ใช้) → Profile (โปรไฟล์)",
        "เลื่อนลงไปที่หัวข้อ \"Application Passwords\"",
        "ช่อง New Application Password Name พิมพ์ \"MarsOS\"",
        "กด \"Add New Application Password\"",
        "คัดลอกรหัส 24 ตัวที่ขึ้นมา (มีเว้นวรรคได้) — จะโชว์ครั้งเดียวเท่านั้น",
      ],
      why: "ให้ Mars โพสต์ผ่าน REST API ได้โดยไม่ต้องใช้รหัสผ่านจริง และเพิกถอนได้ทุกเมื่อ",
      links: [{ label: "เปิดหัวข้อ Application Passwords", href: "{wp}/wp-admin/profile.php#application-passwords-section" }],
      problems: [
        "ไม่เห็นหัวข้อ Application Passwords = เว็บไม่ใช่ https หรือมีปลั๊กอินความปลอดภัย (Wordfence, iThemes/Solid Security, Really Simple SSL hardening) ปิดไว้ / บล็อก REST API",
        "ขึ้น 401 = username ผิด หรือรหัสถูกเพิกถอนแล้ว ให้สร้างใหม่",
        "เคล็ดลับ: ถ้าเว็บติดตั้งปลั๊กอิน Yoast SEO ระบบจะใส่ SEO title / description / focus keyword ให้ด้วย",
      ],
    },
  ],
  webflow: [
    {
      field: "Site API token",
      steps: [
        "เข้า Webflow Dashboard → กดไอคอนเฟือง ⚙ ที่การ์ดของเว็บ (Site settings)",
        "เมนูซ้าย \"Apps & integrations\"",
        "เลื่อนลงล่างสุดที่หัวข้อ \"API access\" → กด \"Generate API token\"",
        "ตั้งชื่อ \"MarsOS\"",
        "สิทธิ์: CMS = Read and write, Assets = Read and write, Sites = Read-only, ที่เหลือ No access",
        "กด Generate แล้วคัดลอกทันที — โชว์ครั้งเดียว",
      ],
      why: "เป็นกุญแจรายเว็บ: CMS ใช้สร้าง/แก้ item บทความ, Assets ใช้อัปโหลดรูปปกและรูปในบทความ, Sites ใช้อ่าน URL เว็บและรายการ Collection",
      links: [{ label: "เปิด Apps & integrations ของเว็บนี้", href: "https://webflow.com/dashboard/sites/{wfShort}/integrations", fallback: "https://webflow.com/dashboard" }],
    },
    {
      field: "Collection",
      steps: [
        "กดปุ่ม \"ทดสอบการเชื่อมต่อ\" ก่อน เพื่อโหลดรายการ",
        "เลือก Collection ที่เป็นบล็อก (เช่น \"Blogs\")",
        "ถ้ายังไม่มี: Designer → ไอคอน CMS → \"+ New Collection\" และต้องมีอย่างน้อย 1 ฟิลด์ Rich text",
      ],
      why: "Webflow รับบทความเป็น item ใน CMS Collection เท่านั้น และหน้า template ของ Collection คือดีไซน์หน้าบทความ (ออกแบบครั้งเดียวใน Designer)",
      links: [{ label: "เปิด Designer ของเว็บนี้", href: "https://{wfShort}.design.webflow.com/" }],
    },
    {
      field: "จับคู่ฟิลด์ (Field mapping)",
      steps: [
        "เนื้อหาบทความ = ฟิลด์ Rich text (เช่น Post Body)",
        "รูปปก = ฟิลด์ Image ที่หน้าบทความแสดงจริง (ส่วนใหญ่คือ Main Image)",
        "Meta Description / คำโปรย = ฟิลด์ Plain text สำหรับสรุป (เช่น Post Summary)",
        "SEO Title = ฟิลด์ Plain text สำหรับ SEO title หรือเลือก \"ไม่ส่ง\" (ฟิลด์ Name เป็นชื่อบทความอยู่แล้ว)",
      ],
      why: "ฟิลด์ที่ไม่ได้จับคู่ ระบบจะไม่แตะต้อง",
    },
    {
      field: "ข้อควรรู้",
      steps: [
        "โหมด Publish ต้องเคย Publish เว็บอย่างน้อย 1 ครั้งแล้ว",
        "แพ็กเกจฟรี Starter จำกัดจำนวน CMS item (ประมาณ 50)",
        "Rich text ของ Webflow เก็บ HTML พื้นฐานเท่านั้น (หัวข้อ ย่อหน้า ลิสต์ ลิงก์ รูป คำพูดอ้างอิง)",
        "ปรับหน้าตาผ่านเมนู สไตล์บทความ → CSS สำหรับ Webflow Custom Code",
        "ช่อง Head code ใน Site settings → Custom code ใช้ได้เฉพาะเว็บที่มี Site plan (แพ็กเกจเสียเงิน)",
      ],
      why: "ช่วยให้เข้าใจข้อจำกัดของ Webflow ก่อนเริ่มใช้งานจริง",
      problems: [
        "หน้า Custom code ขึ้น \"To unlock custom code, add a site plan to this site\" = เว็บยังเป็นแพ็กเกจฟรี ไม่มีช่อง Head code ให้วาง CSS",
        "ทางแก้ 1 (แนะนำ): ให้เจ้าของเว็บซื้อ Site plan (Basic ขึ้นไป) แล้วกลับมาวาง CSS ใน Head code → Save → Publish",
        "ทางแก้ 2: ไม่วาง CSS — Push ได้ตามปกติ บทความจะใช้สไตล์ Rich text ของธีม Webflow เอง (ปรับใน Designer ที่หน้า template ของ Collection ได้) ข้อ checklist เรื่อง CSS จะยังไม่ผ่าน",
      ],
      links: [{ label: "เปิด Custom code ของเว็บนี้", href: "https://webflow.com/dashboard/sites/{wfShort}/custom-code" }, { label: "เปิด Publishing ของเว็บนี้", href: "https://webflow.com/dashboard/sites/{wfShort}/publishing" }],
    },
  ],
  shopify: [
    {
      field: "Store domain",
      steps: [
        "ใช้โดเมนรูปแบบ xxx.myshopify.com",
        "ดูได้ที่ Shopify admin → Settings → Domains",
        "หรือดูจาก URL ของหน้า admin: admin.shopify.com/store/<xxx> → โดเมนคือ <xxx>.myshopify.com",
      ],
      why: "การเรียก API ไปที่โดเมน myshopify ไม่ใช่โดเมนจริงของเว็บ (ใส่โดเมนจริงในช่อง \"เว็บไซต์\" ด้านบน เพื่อให้ลิงก์บทความ/Request Index ใช้โดเมนนั้น)",
      links: [{ label: "เปิด Settings → Domains", href: "https://admin.shopify.com/store/{shop}/settings/domains", fallback: "https://admin.shopify.com" }],
    },
    {
      field: "Admin API access token (ขึ้นต้น shpat_)",
      steps: [
        "Shopify admin → Settings → Apps and sales channels → \"Develop apps\" (ครั้งแรกกด \"Allow custom app development\")",
        "กด \"Create an app\" ตั้งชื่อ \"MarsOS\"",
        "แท็บ Configuration → Admin API integration → Configure",
        "ติ๊ก scope: write_content + read_content (บทความบล็อก) และ write_files + read_files (รูปภาพ) → Save",
        "แท็บ API credentials → กด \"Install app\" → \"Reveal token once\" แล้วคัดลอก",
      ],
      why: "scope content ใช้สร้าง/แก้บทความบล็อก, scope files ใช้อัปโหลดรูป — ต้องเป็น Owner หรือ Staff ที่มีสิทธิ์ \"Develop apps\"",
      links: [{ label: "เปิดหน้า Develop apps", href: "https://admin.shopify.com/store/{shop}/settings/apps/development", fallback: "https://admin.shopify.com" }, { label: "เปิด Shopify Dev Dashboard", href: "https://dev.shopify.com/dashboard" }],
      problems: [
        "ถ้าร้านไม่มีเมนู \"Develop apps\" (ร้านรุ่นใหม่) ให้สร้างแอปที่ Shopify Dev Dashboard (dev.shopify.com) ด้วย scope เดียวกัน แล้วติดตั้งลงร้าน จากนั้นใช้ Admin API token ของแอปนั้น",
      ],
    },
    {
      field: "Blog",
      steps: [
        "กดปุ่ม \"ทดสอบการเชื่อมต่อ\" ก่อน เพื่อโหลดรายการ Blog",
        "เลือก Blog ที่จะลงบทความ (ดูรายการได้ที่ Online Store → Blog posts → Manage blogs)",
        "เว้นว่าง = ใช้บล็อกแรกของร้าน",
      ],
      why: "ร้าน Shopify มีได้หลายบล็อก ต้องระบุว่าจะลงบทความที่บล็อกไหน",
      links: [{ label: "เปิดหน้า Blog posts", href: "https://admin.shopify.com/store/{shop}/content/articles" }],
    },
  ],
  wix: [
    {
      field: "API Key",
      steps: [
        "เข้า Wix API Keys Manager: manage.wix.com/account/api-keys (เฉพาะเจ้าของ/co-owner ของบัญชี)",
        "กด \"Generate API Key\" ตั้งชื่อ \"MarsOS\"",
        "สิทธิ์: All site permissions → Wix Blog (\"Manage Blog\") และ Media Manager (\"Manage Media Manager\")",
        "กด Generate แล้วคัดลอก — โชว์ครั้งเดียว",
      ],
      why: "ให้ Mars สร้าง/แก้บทความบล็อก และอัปโหลดรูปปกได้",
      links: [{ label: "เปิด Wix API Keys Manager", href: "https://manage.wix.com/account/api-keys" }],
    },
    {
      field: "Site ID",
      steps: [
        "เปิด Dashboard ของเว็บที่ต้องการ",
        "URL จะเป็น manage.wix.com/dashboard/<SITE_ID>/home",
        "คัดลอกรหัสยาวที่อยู่ระหว่าง /dashboard/ กับ / ตัวถัดไป",
      ],
      why: "API Key ตัวเดียวเข้าถึงได้หลายเว็บ — Site ID ใช้ระบุว่าจะลงเว็บไหน",
      links: [{ label: "เปิดรายการเว็บใน Wix", href: "https://manage.wix.com/account/sites" }],
    },
    {
      field: "Member ID (ผู้เขียน)",
      steps: [
        "กดปุ่ม \"ทดสอบการเชื่อมต่อ\" ก่อน แล้วเลือก Member ที่จะเป็นผู้เขียนบทความ",
        "คนนั้นต้องเป็นสมาชิกของเว็บ: Dashboard → Contacts → Site Members",
      ],
      why: "Wix บังคับให้ทุกบทความที่สร้างผ่าน API Key ต้องมี Member เป็นผู้เขียน",
      links: [{ label: "เปิด Dashboard ของเว็บนี้", href: "https://manage.wix.com/dashboard/{wixSite}/home" }],
    },
    {
      field: "ข้อควรรู้",
      steps: [
        "ต้องติดตั้งแอป Wix Blog ในเว็บก่อน",
        "เนื้อหาบทความจะเข้าเป็นบล็อก HTML",
      ],
      why: "ถ้าไม่มี Wix Blog จะสร้างบทความไม่ได้",
      links: [{ label: "เปิด Wix App Market (Wix Blog)", href: "https://www.wix.com/app-market/wix-blog" }],
    },
  ],
  custom: [
    {
      field: "Webhook URL",
      steps: [
        "ขอจากทีมพัฒนาเว็บ — เป็น endpoint แบบ https ที่รับ JSON ผ่าน POST",
        "ตัวอย่างข้อมูลที่ Mars ส่งไป และสิ่งที่ endpoint ต้องตอบกลับ ดูในกล่องด้านล่าง",
        "ต้องตอบ 2xx เป็น JSON ที่มี url (ใช้ทำลิงก์/Request Index) และ id (ใช้ push ซ้ำ)",
      ],
      why: "เว็บที่ไม่ใช่ WordPress/Webflow/Wix/Shopify ใช้ช่องทางนี้รับบทความ",
      code: CUSTOM_PAYLOAD,
    },
    {
      field: "Secret (ไม่บังคับ)",
      steps: [
        "ตั้งรหัสลับร่วมกับทีมพัฒนาเว็บ แล้วใส่ที่นี่",
      ],
      why: "ระบบจะส่งใน header X-Content-Secret เพื่อให้ endpoint ตรวจได้ว่าคำขอมาจาก Mars จริง",
    },
  ],
};

/** คู่มือเป็นข้อความล้วน สำหรับใส่ใน prompt ของ AI */
export function connectGuideText(platform: UploadPlatformId): string {
  const items = CONNECT_GUIDE[platform] ?? []
  return items
    .map(it => {
      const lines = [`## ${it.field}`, 'ไปเอาที่ไหน:', ...it.steps.map((s, i) => `${i + 1}. ${s}`), `ใช้ทำอะไร: ${it.why}`]
      if (it.problems?.length) lines.push('ปัญหาที่เจอบ่อย:', ...it.problems.map(p => `- ${p}`))
      if (it.code) lines.push('ตัวอย่างข้อมูล:', it.code)
      return lines.join('\n')
    })
    .join('\n\n')
}

/** ตัดความลับ (token/key/password) ออกจากข้อความ error ก่อนส่งให้ AI + จำกัด 2000 ตัวอักษร */
export function redactSecrets(input: string, max = 2000): string {
  return String(input ?? '')
    .slice(0, max)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?token|authorization)\b(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi, '$1$2[REDACTED]')
    .replace(/\bshp(?:at|ss|ca|pa)_\w+/gi, '[REDACTED]')
    .replace(/\bIST\.[A-Za-z0-9._-]+/g, '[REDACTED]')
    .replace(/[A-Za-z0-9+/_=-]{24,}/g, m => (/^[a-z]+$/i.test(m) ? m : '[REDACTED]'))
}
