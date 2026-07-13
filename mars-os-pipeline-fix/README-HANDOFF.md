# Mars OS — รายงานปัญหาทั้งระบบ + สิ่งที่แก้ + งานที่ต้องส่ง dev

โปรเจกต์: `mars-os/plans-seo-pipeline` · Deploy: Vercel + Supabase (Postgres)
เป้าหมาย pipeline: **Keyword → Content Map → เขียน → Review → Approve → Push → Published → Report**

> ยกเว้น **Keyword Research** ที่ dev แก้แล้ว — ไม่รวมในชุดนี้

---

## ตารางสรุปทุกปัญหา

| # | ปัญหา | ความรุนแรง | สาเหตุ | สถานะ |
|---|---|---|---|---|
| **P0** | Home/Console/หลายหน้า crash + **ข้อมูลไม่ถูก save** | 🔴 ระบบ | **ตรวจแล้ว: DB สมบูรณ์ 100%** — ตัวการคือ ENV บน Vercel (`DIRECT_URL`/`DATABASE_URL`) | ✅ วินิจฉัยจบ + กัน crash แล้ว · dev ตั้ง env 2 ตัว |
| **P1** | Article เขียนค้าง / ออกไปหน้าอื่นแล้วกลับมาค้าง / หยุด-เขียนใหม่ไม่ได้ | 🔴 | `writeArticle` ไม่มี AbortController + สถานะ `writing` ค้างใน sessionStorage ไม่มีปุ่มหยุด | ✅ **แก้แล้ว** |
| **P2** | Approve แล้วไม่ไป Push | 🟠 | approve ไม่เขียน DB + Push อ่าน sessionStorage ไม่ใช่ DB | ✅ **แก้แล้ว** |
| **P3** | Content Studio / Review render พังทั้งแอป (คอลัมน์แคบ) | 🟠 | `<style>` จาก AI รั่ว global ผ่าน `dangerouslySetInnerHTML` | ✅ **แก้แล้ว (Preview + Edit)** |
| **P4** | บทความค้างตอน "กำลังเขียน" (ฝั่ง server) | 🟠 | prompt โหลดจาก path Desktop เครื่อง dev → ว่างบน Vercel + SSE อาจถูก buffer | ✅ code แก้แล้ว · dev แค่ commit ไฟล์ prompt |
| **P5** | ความเร็วระบบ | 🟡 | fetch หลายชั้น sequential, query ไม่ parallel | 🔧 บางส่วนแก้แล้ว + คำแนะนำ |
| **P6** | Image Studio + Keyword Gemini expansion + ส่งเข้า Content Map พัง (`invalid_grant`) | 🔴 | สลับไป Vercel OIDC→GCP WIF แล้ว audience ไม่ตรง (config) | ✅ code fallback แล้ว · ต้องตั้ง env/WIF |
| **P7** | หน้า Report: ตัวเลขยืด, Unique Visitors กดไม่ได้, Locations ว่าง | 🟡 | SVG stretch text, `metric:null` hardcode, ไม่เคย fetch country | ✅ **แก้ครบแล้ว** |

---

# P0 — 🔴 ระบบพัง + ข้อมูลไม่ save — **ตรวจ DB จริงแล้ว (2026-07-09): ตัว database สมบูรณ์ 100%**

## ผลตรวจจริง (เชื่อมด้วย credentials ที่ dev ให้)
| ตรวจ | ผล |
|---|---|
| ตารางใน schema `plans_seo_pipeline` | ✅ ครบ **30 ตาราง** |
| Schema drift vs `prisma/schema.prisma` (`prisma migrate diff`) | ✅ **ศูนย์** — "empty migration" |
| Users | ✅ adminseo (ADMIN) + userseo (USER) — ทดสอบ bcrypt รหัส `Convertcakeseo01` **ผ่านทั้งคู่** |
| ข้อมูล | ✅ save จริง: Project 1, Article 2 (REVIEW + htmlContent), Keyword 74, timeline อยู่ครบ |
| Orphaned FK (11 จุดรวม ActivityLog→User) | ✅ ศูนย์ |
| **Pooled connection** (URL เดียวกับที่ Vercel ควรใช้) + query ทรงเดียวกับ dashboard | ✅ **ผ่าน** |

## ข้อสรุป: ปัญหาไม่ได้อยู่ที่ database — อยู่ที่ **ENV บน Vercel**
`prisma/schema.prisma` ประกาศ `directUrl = env("DIRECT_URL")` — **ถ้าบน Vercel ไม่ได้ตั้ง `DIRECT_URL` (หรือ `DATABASE_URL` เป็นค่าเก่า/ไม่มี `?schema=`/ไม่มี `pgbouncer=true`) → Prisma init ล้มเหลว → ทุกหน้าที่แตะ DB crash ("Server Components render error") และทุกการ save เงียบๆ fail** — ตรงกับอาการ "พังทั้งระบบหลัง deploy" และ "ข้อมูลหายหลัง refresh" เป๊ะ

## วิธีแก้ (dev — 5 นาที)
ตั้ง env 2 ตัวนี้บน Vercel (Production + Preview) แล้ว redeploy:
```
DATABASE_URL=postgresql://postgres.falakbebwdnrbkvnamrs:<PASSWORD>@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?schema=plans_seo_pipeline&pgbouncer=true&connection_limit=1
DIRECT_URL=postgresql://postgres:<PASSWORD>@db.falakbebwdnrbkvnamrs.supabase.co:5432/postgres?schema=plans_seo_pipeline
```
(รหัสผ่านตัวจริงอยู่กับ dev — ค่าเดียวกับที่ส่งให้ทีมแล้ว)

**Verify หลังตั้ง:** รัน `DATABASE_URL="<pooled url>" node db-pooler-test.mjs` (สคริปต์อยู่ที่ root ของโปรเจกต์) — ต้องเห็น `✓ pooled OK` + users=2
> ❌ **ไม่ต้อง** รัน migrate/db push/force-reset ใดๆ — schema ตรงแล้ว ข้อมูลอยู่ครบ อย่าแตะ

## สิ่งที่ผมแก้ให้แล้ว (กันหน้าพังชั่วคราว)
- `src/app/(app)/dashboard/page.tsx` — ห่อ query ด้วย `try/catch` + `Promise.all`
- `src/app/(app)/projects/page.tsx` (หน้า **Clients**) — ห่อ query ด้วย `try/catch`

→ ถ้า DB error จะโชว์หน้าเปล่าแทนการ crash ทั้งหน้า

> ⚠️ ยังมี Server Component อื่นอีก ~35 หน้าที่ยิง prisma ตรง (report, client-portal, articles, ฯลฯ) — ถ้า DB ยังพัง หน้าเหล่านั้นจะ crash. **ทางแก้จริงคือแก้ DB (ข้างบน) ไม่ใช่ห่อทีละหน้า**

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

# P6 — 🔴 Gemini auth `invalid_grant` (Image Studio + Keyword + Content Map)

## อาการ
- Image Studio: `Error code invalid_grant: The audience in ID Token [//iam.googleapis.com/projects/457755368033/.../providers/vercel] does not match the expected audience`
- Keyword Research: KP ได้ 25 แต่ Gemini เพิ่ม 0 (`Batch error invalid_grant`) → รวม 25 (ขอ 79)
- ส่ง keyword → Content Map ไม่ครบ (เพราะ research ไม่จบ)
- **ก่อนหน้าใช้ได้** ตอนใช้ service account · **พังหลังสลับไป Vercel OIDC → GCP Workload Identity Federation**

## สาเหตุ
WIF audience mismatch — token `aud` ที่ Vercel OIDC ส่ง ไม่ตรงกับ `allowed-audiences` ที่ GCP provider คาดหวัง (หรือ `GCP_PROJECT_NUMBER` ไม่ตรงกับ project จริงของ pool) → GCP ปฏิเสธ token → Gemini ทุกจุดที่ใช้ auth นี้พัง (image + keyword expansion + article cover/mid images)

## สิ่งที่ผมแก้ (code)
`src/lib/google-auth.ts` — `getGeminiAccessToken()` ตอนนี้ **ถ้า OIDC/WIF ล้มเหลว จะ fallback ไป service account JSON อัตโนมัติ** (สถานะที่เคยใช้ได้) แทนที่จะ throw

## ⚡ ทางแก้ด่วนที่สุด (ยืนยันแล้ว 2026-07-09 — ไม่ต้อง deploy โค้ด/แตะ GCP)
`GOOGLE_SERVICE_ACCOUNT_JSON` **ตั้งอยู่บน Vercel แล้วและใช้งานได้จริง** (หน้า Report ดึง GA4 ผ่าน credentials ตัวนี้อยู่) — โค้ด production เข้า OIDC เพียงเพราะเจอ env `GCP_PROJECT_NUMBER`
1. Vercel → Settings → Environment Variables → **ลบ `GCP_PROJECT_NUMBER`**
2. Deployments → **Redeploy** อันล่าสุด
3. เสร็จ — Gemini กลับไปใช้ service account เหมือนช่วงที่ใช้งานได้
> เมื่อ deploy โค้ดชุดแก้ (มี fallback) แล้ว ค่อยเติม `GCP_PROJECT_NUMBER` กลับเพื่อเปิด OIDC — พังก็ fallback อัตโนมัติ ผู้ใช้ไม่เจอ error

## สิ่งที่ dev/ops ต้องทำ — เลือก 1 ทาง
**ทาง A (เร็วสุด — กู้สถานะเดิม):** ลบ env `GCP_PROJECT_NUMBER` ตามข้างบน (service account JSON มีอยู่แล้ว)

**ทาง B (คงใช้ OIDC ไม่ต้องมี key):** แก้ config WIF ให้ audience ตรง
Error บอก `aud` ตัวจริงใน token แล้ว (ค่าในวงเล็บ) — ตั้ง allowed-audiences ให้เท่ากันเป๊ะ:
```bash
gcloud iam workload-identity-pools providers update-oidc vercel \
  --project=<GCP_PROJECT_ID> --location=global --workload-identity-pool=vercel \
  --allowed-audiences="https://iam.googleapis.com/projects/457755368033/locations/global/workloadIdentityPools/vercel/providers/vercel"
```
(หรือใน Console: provider `vercel` → Edit → Audiences → เลือก **Default audience** — ค่า default คือ path ของ provider ซึ่งตรงกับ token พอดี)
เช็คเพิ่ม: Issuer URI ต้องตรงกับ `iss` ใน token (`https://oidc.vercel.com/<team-slug>`) + service account มี binding `roles/iam.workloadIdentityUser` ให้ principal ของ pool

> หลังแก้ P6: Image Studio, Keyword (79 ครบ), และส่งเข้า Content Map จะทำงานพร้อมกัน

---

# P7 — ✅ หน้า Report แสดงผลเพี้ยน (แก้ครบ 3 จุดแล้ว)

## อาการ → สาเหตุ → แก้
1. **ตัวเลขแกนกราฟยืด/เบี้ยว อ่านยาก** — `SKLineChart` ใช้ `<svg preserveAspectRatio="none">` ที่ถูก stretch ตามความกว้างจอ และมี `<text>` อยู่ข้างใน → ตัวหนังสือถูกยืดตาม
   → **แก้:** ย้าย label ทั้งแกน Y และวันที่ออกมาเป็น HTML overlay (ไม่โดน stretch) SVG เหลือเฉพาะเส้นกราฟ + แก้ bug ค่า grid ไม่เรียง (เดิม 0, 60, 100, 200 — สูตร nice-round ผิด) เป็นเส้นแบ่งเท่ากัน 4 ช่วง
2. **"Unique Visitors from Search" กดไม่ได้** — การ์ดถูก hardcode `metric: null` → ปุ่ม disabled
   → **แก้:** เพิ่ม metric `'users'` — กดแล้วกราฟสลับไปแสดงข้อมูล GA4 daily users + legend เปลี่ยนตาม
3. **Locations ว่าง** — เป็น **hardcode** "ยังไม่มีข้อมูล Locations" และ GA4 API ไม่เคยดึง dimension `country`
   → **แก้:** `api/report/ga4/route.ts` เพิ่ม query `country` (top 8 ตาม sessions) + `ClientReportClient` สร้าง `locationData` + donut แสดงจริง
   > GA4 report ใช้ service account (ไม่ใช่ OIDC) และตอนนี้ดึงข้อมูลได้อยู่แล้ว (เห็น 8K visitors) → Locations จะขึ้นทันทีหลัง deploy โค้ดชุดนี้

---

## ไฟล์ที่แก้ (ชุดนี้ — พร้อม redeploy, ผ่าน tsc)

| ไฟล์ | เรื่อง |
|---|---|
| `src/components/shared/ArticleFrame.tsx` | **ใหม่** — iframe กัน style รั่ว (preview, P3) |
| `src/components/shared/ScopedEditable.tsx` | **ใหม่** — contentEditable scope CSSOM กัน style รั่ว (edit, P3) |
| `src/components/projects/ClientDetailTabs.tsx` | Article stop/abort/watchdog (P1), Approve→DB + Push←DB (P2), iframe+scoped edit (P3) |
| `src/components/content-studio/ContentStudioClient.tsx` | iframe preview + scoped edit (P3) |
| `src/app/api/article/write/route.ts` | prompt loader หลาย path + SSE header กัน buffer (P4) |
| `src/lib/google-auth.ts` | Gemini OIDC→service account fallback อัตโนมัติ (P6) |
| `src/app/(app)/dashboard/page.tsx` | กัน DB crash + parallel query (P0/P5) |
| `src/app/(app)/projects/page.tsx` | กัน DB crash หน้า Clients (P0) |
| `src/app/api/report/ga4/route.ts` | เพิ่ม Locations (country) query (P7) |
| `src/components/report/ClientReportClient.tsx` | แก้ตัวเลขยืด + Unique Visitors กดได้ + Locations donut (P7) |
| `db-pooler-test.mjs` | สคริปต์ verify DB connection สำหรับ dev (P0) |

**Patch:** `mars-os-pipeline-fix.patch` (git apply ได้) + ไฟล์เต็มในโฟลเดอร์ handoff

---

## Checklist ก่อน redeploy
- [ ] **P0:** ตั้ง `DATABASE_URL` (pooled + `?schema=plans_seo_pipeline&pgbouncer=true&connection_limit=1`) + `DIRECT_URL` บน Vercel ⭐ **ห้ามรัน migrate/reset — DB ตรง schema แล้ว ข้อมูลอยู่ครบ**
- [ ] **P6:** แก้ WIF allowed-audiences (ทาง B — ทีมเลือกทางนี้) — ระหว่างรอ ตั้ง `GOOGLE_SERVICE_ACCOUNT_JSON` ไว้ด้วย code fallback จะทำงานทันที ⭐
- [ ] **P4:** commit ไฟล์ prompt เข้า repo (`prompts/*.md`)
- [ ] ตั้ง ENV อื่น: `ANTHROPIC_API_KEY`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- [ ] apply patch (10 ไฟล์) + redeploy
- [ ] verify DB: `node db-pooler-test.mjs` → ต้องเห็น `✓ pooled OK`
- [ ] ทดสอบ flow เต็ม 1 รอบ: keyword(79) → map → เขียน+รูป → review → approve → push → published → report (Locations ขึ้น)

## Note: P3 แก้ครบทั้ง Preview + Edit แล้ว
Preview = iframe (`ArticleFrame`), Edit = CSSOM scoping (`ScopedEditable`) — ไม่เหลือ `dangerouslySetInnerHTML` ที่ leak แล้ว. `ScopedEditable` ห่อ try/catch ทุกจุด: ถ้า scope fail จะกลับเป็นพฤติกรรมเดิม ไม่ทำ editor พัง
