# Mars OS — รายงานปัญหาทั้งระบบ + สิ่งที่แก้ + งานที่ต้องส่ง dev

โปรเจกต์: `mars-os/plans-seo-pipeline` · Deploy: Vercel + Supabase (Postgres)
เป้าหมาย pipeline: **Keyword → Content Map → เขียน → Review → Approve → Push → Published → Report**

> ยกเว้น **Keyword Research** ที่ dev แก้แล้ว — ไม่รวมในชุดนี้

---

## ตารางสรุปทุกปัญหา

| # | ปัญหา | ความรุนแรง | สาเหตุ | สถานะ |
|---|---|---|---|---|
| **P0** | Home/Console/หลายหน้า crash "Server Components render error" + **ข้อมูลไม่ถูก save** (refresh แล้วหาย) | 🔴 ระบบ | DB connection/schema ล่มหรือไม่ตรง (หลังเปลี่ยน `?schema=plans_seo_pipeline`) → read crash, write fail เงียบ | ⚠️ ต้อง dev/ops แก้ + ผมกัน crash หน้า dashboard แล้ว |
| **P1** | Article เขียนค้าง / ออกไปหน้าอื่นแล้วกลับมาค้าง / หยุด-เขียนใหม่ไม่ได้ | 🔴 | `writeArticle` ไม่มี AbortController + สถานะ `writing` ค้างใน sessionStorage ไม่มีปุ่มหยุด | ✅ **แก้แล้ว** |
| **P2** | Approve แล้วไม่ไป Push | 🟠 | approve ไม่เขียน DB + Push อ่าน sessionStorage ไม่ใช่ DB | ✅ **แก้แล้ว** |
| **P3** | Content Studio / Review render พังทั้งแอป (คอลัมน์แคบ) | 🟠 | `<style>` จาก AI รั่ว global ผ่าน `dangerouslySetInnerHTML` | ✅ **แก้แล้ว (Preview + Edit)** |
| **P4** | บทความค้างตอน "กำลังเขียน" (ฝั่ง server) | 🟠 | prompt โหลดจาก path Desktop เครื่อง dev → ว่างบน Vercel + SSE อาจถูก buffer | ✅ code แก้แล้ว · dev แค่ commit ไฟล์ prompt |
| **P5** | ความเร็วระบบ | 🟡 | fetch หลายชั้น sequential, query ไม่ parallel | 🔧 บางส่วนแก้แล้ว + คำแนะนำ |

---

# P0 — 🔴 ระบบพัง + ข้อมูลไม่ save (สำคัญสุด — dev/ops)

## อาการ
- Home (`/dashboard`), Console โหลดไม่ได้ / "เกิดข้อผิดพลาด — Server Components render error"
- Generate keyword/บทความเสร็จ → refresh หรือ login ใหม่ → **ข้อมูลหายหมดทุกหน้า** (Content Map, Articles, Client bar)

## สาเหตุ (หลักฐานจากโค้ด)
1. **หน้า Server Component ยิง `prisma` ตรงๆ ไม่มี try/catch** — `dashboard/page.tsx` query `project.findMany` + `activityLog.findMany`. ถ้า DB error → ทั้งหน้า crash
2. **ทุกการ save ห่อ `.catch(() => {})` เงียบ** — เช่น timeline (`PATCH /api/scheduler`), keywords-cache, article status. ถ้า DB write fail → เงียบ ไม่มี error แต่ **ข้อมูลไม่ถูกบันทึก** → refresh แล้วหาย

> ทั้ง 2 อาการชี้จุดเดียวกัน: **DB เขียนไม่ได้/อ่านไม่ได้** — เกือบแน่นอนว่าเกิดหลังเปลี่ยน `DATABASE_URL` เป็น schema `plans_seo_pipeline` โดยที่ schema นั้น **ยังไม่มีตารางครบ** (migrations ยังไม่ได้รันใน schema ใหม่) หรือ connection pool ของ serverless หมด

## วิธีแก้ (dev/ops)
1. ตรวจ Supabase: schema `plans_seo_pipeline` มีตารางครบทุกตัวไหม (โดยเฉพาะ `ActivityLog`, `Project`, `Article`, `Keyword`)
   - ถ้าไม่มี: รัน migration เข้า schema นั้น
   ```bash
   npx prisma migrate deploy      # หรือ prisma db push ไปยัง schema ที่ถูกต้อง
   npx prisma generate
   ```
2. ใช้ **connection pooler URL** ของ Supabase (`...pooler.supabase.com:6543/...?pgbouncer=true`) สำหรับ serverless (Vercel) — กัน connection หมด
3. ตั้ง `DATABASE_URL` + `DIRECT_URL` บน Vercel ให้ถูก (pooled สำหรับ runtime, direct สำหรับ migrate)
4. ยืนยันว่า `prisma/schema.prisma` datasource ตรงกับวิธี set schema (ถ้าใช้ `?schema=` ใน URL ต้องมั่นใจว่า migration สร้างตารางใน schema นั้น)

## สิ่งที่ผมแก้ให้แล้ว (กันหน้าพังชั่วคราว)
`src/app/(app)/dashboard/page.tsx` — ห่อ 2 query ด้วย `try/catch` + `Promise.all` → ถ้า DB error จะโชว์ dashboard เปล่าแทนการ crash ทั้งหน้า (และได้ perf จาก parallel query ด้วย)

> ⚠️ แนะนำ dev ทำแบบเดียวกันกับ Server Component อื่นที่ยิง prisma ตรง (เช่นหน้า report, client-portal)

---

# P1 — ✅ Article เขียนค้าง / หยุด-เขียนใหม่ไม่ได้ (แก้แล้ว)

## อาการ
กดเขียนบทความ ระบบกำลังเขียน → ออกไปหน้าอื่น/กดดูอย่างอื่น → กลับมา **ค้าง** บทความไม่ถูกเขียนต่อ และ **กดหยุดแล้วเขียนใหม่ไม่ได้**

## สาเหตุ
- `writeArticle()` ใช้ `fetch` **ไม่มี AbortController** → หยุดไม่ได้ (ปุ่ม Stop ที่มีเป็นของ keyword คนละตัว)
- `isDrawerWriting` เช็คจาก `job.status === 'writing'` ที่เก็บใน sessionStorage → พอ job ค้างสถานะ writing (หลัง navigate/refresh) UI ค้าง "กำลังเขียน" ตลอด และ**ไม่มีปุ่มหยุด**

## สิ่งที่แก้ (`ClientDetailTabs.tsx`)
1. เพิ่ม `writeAbortRef: Map<entryIdx, AbortController>` — 1 ตัวต่อ 1 งานเขียน
2. `writeArticle` ส่ง `signal: abort.signal` เข้า fetch + cleanup controller ใน `finally`
3. จับ `AbortError` แยกจาก error จริง → ถ้ามี html บางส่วนเก็บเป็น review, ถ้าไม่มีลบ job ทิ้ง (กลับเป็น pending เขียนใหม่ได้)
4. เพิ่มฟังก์ชัน `stopWriting(entryIdx)` — abort งานที่กำลังวิ่ง **หรือ** reset job ที่ค้างจาก session ก่อน
5. เพิ่มปุ่ม **"⏹ หยุด / เขียนใหม่"** ใน drawer header (โชว์เมื่อ `isDrawerWriting`)
6. **Watchdog** — auto-abort ถ้าไม่มี stream activity เกิน 120s (กันค้างถาวรแม้ผู้ใช้ไม่กด Stop)

> หลังแก้: กดหยุดได้ทุกเมื่อ, งานค้างจาก session เก่ากด reset แล้วเขียนใหม่ได้

---

# P2 — ✅ Approve → Push (แก้แล้ว)

**สาเหตุ:** approve() อัปเดตแค่ timeline ใน memory ไม่เขียน DB + Push อ่าน `jobs` (sessionStorage) ที่ว่างหลัง refresh
**แก้ (`ClientDetailTabs.tsx`):**
- `approve()` → `PATCH /api/articles/{id}` ตั้ง `status: APPROVED`
- `PushTab` โหลดบทความจาก DB (`GET /api/articles?projectId=`) merge กับ session jobs → push ได้แม้ refresh
- `handlePush` ดึง html จาก merged list

---

# P3 — ✅ `<style>` รั่วทั้งแอป (แก้แล้ว)

**สาเหตุ:** บทความ AI ขึ้นต้นด้วย `<style>` (prompt สั่ง) → inject ผ่าน `dangerouslySetInnerHTML` → CSS ใช้ทั้งหน้า → layout พัง
**แก้ (ครบทั้ง Preview + Edit):**
- **Preview** → ไฟล์ใหม่ `ArticleFrame.tsx` render บทความใน `<iframe>` แยก document 100% + auto-height. Wire 5 จุด (ContentStudio ×2, drawer/stream/expanded ×3)
- **Edit** → ไฟล์ใหม่ `ScopedEditable.tsx` — contentEditable ที่ scope CSSOM ของ `<style>` ในตัว editor (prefix `.cc-scoped-editor`) โดย**ไม่แตะ innerHTML ที่ save** → execCommand toolbar ทำงานเหมือนเดิม, บทความที่ save ยังมี style เดิมครบ. Wire 3 จุด (ContentStudio edit/review-edit, drawer edit)

---

# P4 — ✅ บทความค้างฝั่ง server (code แก้แล้ว · dev แค่ commit ไฟล์ prompt)

## (a) Prompt โหลดจาก path เครื่อง local → ว่างบน Vercel — ✅ แก้ loader แล้ว
เดิม `api/article/write/route.ts` อ่าน prompt จาก `~/Desktop/Mars/...` ซึ่งไม่มีบน Vercel → prompt ว่าง
**แก้แล้วในโค้ด:** `readPromptFile` ตอนนี้ลองอ่านตามลำดับ `process.cwd()/<path>` → `process.cwd()/prompts/<file>` → Desktop (local fallback)

> 👉 **สิ่งเดียวที่ dev ต้องทำ:** `git add` โฟลเดอร์ `prompts/*.md` (global_rules, convert_cake_seo_master, convert_cake_validator_10_10, cover_master_prompt) เข้า repo ให้ deploy ไปด้วย

## (b) SSE buffering / timeout — ✅ แก้แล้ว
- **Header กัน buffer:** เพิ่ม `'X-Accel-Buffering': 'no'` + `no-transform` ที่ response ของ route แล้ว
- **Client watchdog:** `writeArticle` จะ auto-abort ถ้าไม่มี stream activity เกิน 120s (กันค้างถาวร) + มีปุ่ม Stop (P1)
- ⚠️ ยังเหลือ: `maxDuration=300` ถ้าบทความ+รูปยาวเกิน 5 นาที Vercel อาจ kill — พิจารณาแยก image gen ออกจาก write stream ถ้ายังเจอ timeout

---

# P5 — 🟡 ความเร็วระบบ

**ทำแล้ว:** dashboard เปลี่ยน 2 query เป็น `Promise.all` (จาก sequential)
**แนะนำเพิ่ม (dev):**
- ตอน mount `ClientDetailTabs` มี fetch หลายชั้น sequential — รวมเป็น `Promise.all`
- ใช้ Supabase connection pooler (P0 ข้อ 2) — ลด latency ต่อ request มาก
- บทความ HTML ก้อนใหญ่เก็บใน sessionStorage/DB — พิจารณา lazy-load เฉพาะตอนเปิด drawer (ทำแล้วบางส่วน)
- เพิ่ม `revalidate`/cache กับหน้า Server Component ที่ข้อมูลไม่เปลี่ยนบ่อย

---

## ไฟล์ที่แก้ (ชุดนี้ — พร้อม redeploy, ผ่าน tsc)

| ไฟล์ | เรื่อง |
|---|---|
| `src/components/shared/ArticleFrame.tsx` | **ใหม่** — iframe กัน style รั่ว (preview, P3) |
| `src/components/shared/ScopedEditable.tsx` | **ใหม่** — contentEditable scope CSSOM กัน style รั่ว (edit, P3) |
| `src/components/projects/ClientDetailTabs.tsx` | Article stop/abort/watchdog (P1), Approve→DB + Push←DB (P2), iframe+scoped edit (P3) |
| `src/components/content-studio/ContentStudioClient.tsx` | iframe preview + scoped edit (P3) |
| `src/app/api/article/write/route.ts` | prompt loader หลาย path + SSE header กัน buffer (P4) |
| `src/app/(app)/dashboard/page.tsx` | กัน DB crash + parallel query (P0/P5) |

**Patch:** `mars-os-pipeline-fix.patch` (git apply ได้) + ไฟล์เต็มในโฟลเดอร์ handoff

---

## Checklist ก่อน redeploy
- [ ] **P0:** ตรวจ/รัน migration เข้า schema `plans_seo_pipeline` + `prisma generate` + ใช้ pooler URL ⭐ สำคัญสุด
- [ ] **P4:** commit ไฟล์ prompt เข้า repo + แก้ `readPromptFile`
- [ ] ตั้ง ENV: `DATABASE_URL`(pooled), `DIRECT_URL`, `ANTHROPIC_API_KEY`, Gemini OIDC
- [ ] apply patch 4 ไฟล์ชุดนี้
- [ ] ทดสอบ flow เต็ม 1 รอบ: keyword → map → เขียน → review → approve → push → published

## Note: P3 แก้ครบทั้ง Preview + Edit แล้ว
Preview = iframe (`ArticleFrame`), Edit = CSSOM scoping (`ScopedEditable`) — ไม่เหลือ `dangerouslySetInnerHTML` ที่ leak แล้ว. `ScopedEditable` ห่อ try/catch ทุกจุด: ถ้า scope fail จะกลับเป็นพฤติกรรมเดิม ไม่ทำ editor พัง
