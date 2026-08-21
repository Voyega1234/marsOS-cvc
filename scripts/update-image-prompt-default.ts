// ─────────────────────────────────────────────────────────────────────────────
//  อัปเดต CE_IMAGE_PROMPT ที่ ACTIVE อยู่ → บรีฟ "อินโฟกราฟิก-แบนเนอร์" ใหม่
//
//  ทำไมต้องมีสคริปต์นี้: seed เป็น idempotent (เจอชื่อซ้ำ = ข้าม) จึงทับของเดิม
//  ไม่ได้ และลูกค้าใหม่ clone prompt จาก "Studio ที่ active" ตอนสร้าง — การเปลี่ยน
//  default ให้มีผล "ทุกหน้า + ลูกค้าใหม่" จึงต้องอัปเดตแถวที่ active ใน DB จริง
//
//  ปลอดภัย:
//   - DRY RUN เป็นค่าเริ่มต้น (ไม่เขียนอะไร) — ต้องส่ง APPLY=1 ถึงจะเขียน
//   - สำรองข้อความเดิมทุกแถวลงไฟล์ JSON ก่อนเขียนเสมอ (กู้คืนได้)
//   - SCOPE=studio (ค่าเริ่มต้น) แตะเฉพาะ Studio (projectId=null) → ลูกค้าใหม่ได้ตาม
//     SCOPE=all  แตะ Studio + ทุกโปรเจกต์ที่มีอยู่ (ทับ prompt เดิมของแต่ละ client ด้วย)
//   - อัปเดตแค่ฟิลด์ promptText ของแถวเดิม (id เดิม) ไม่แตะ layer อื่นเลย
//
//  รัน:
//    DRY RUN ทั้งหมด:            DATABASE_URL=... npx tsx scripts/update-image-prompt-default.ts
//    เขียนจริง เฉพาะ Studio:     APPLY=1 DATABASE_URL=... npx tsx scripts/update-image-prompt-default.ts
//    เขียนจริง Studio+ทุกโปรเจกต์: APPLY=1 SCOPE=all DATABASE_URL=... npx tsx scripts/update-image-prompt-default.ts
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'fs'

const prisma = new PrismaClient()

// บรีฟใหม่ — ต้องตรงกับ IMAGE_DEFAULT ใน scripts/seed-content-engine-defaults.ts
const IMAGE_DEFAULT = `สร้าง prompt ภาษาอังกฤษสำหรับโมเดลภาพ เพื่อทำ "ภาพปกบทความสไตล์อินโฟกราฟิก-แบนเนอร์" ของบทความ "{{title}}" (หัวข้อหลัก: {{keyword}})

สไตล์ภาพ (ทีมปรับได้):
- Flat / semi-flat premium vector infographic banner — โทนองค์กร ดูน่าเชื่อถือ ระดับเอเจนซี่มืออาชีพ ไม่ใช่ภาพถ่าย ไม่ใช่ 3D realistic
- ระบบสีอิงโทน {{accent_color}} เป็นสีหลัก + สีรอง 1-2 สี + สีทอง/สีสว่างเป็น accent เน้นคำสำคัญ พื้นหลังไล่เฉดเนียนหรือสีทึบเรียบสะอาด
- เลย์เอาต์: บล็อกหัวเรื่องฝั่งซ้าย (headline เด่น + คำ accent สีทอง + sub-headline สั้น) — ฝั่งขวาเป็นกลุ่มไอคอน/วัตถุเวกเตอร์ที่สื่อถึง "{{keyword}}" โดยตรง
- แถวไอคอนวงกลม (medallion) 4-5 อัน พร้อมป้ายคำไทยสั้นๆ ใต้ไอคอน สื่อบริการ/จุดเด่น/ประโยชน์ที่ลูกค้าได้รับ
- แถบล่าง (footer bar) สีเข้ม วางแถบจุดเด่น/ความน่าเชื่อถือแบบสั้นๆ
- ดีไซน์สะอาด จัดระเบียบด้วย grid ชัด มีช่องไฟหายใจ ลำดับสายตาชัดเจน

ตัวอักษรบนภาพ (ต้องมี):
- headline หลักคือ "{{title}}" — ตัวใหญ่ หนา อ่านง่าย เป็นจุดโฟกัสของภาพ
- สะกดคำไทยทุกคำให้ถูกต้องเป๊ะ สระ/วรรณยุกต์ครบและอยู่ตำแหน่งถูก ห้ามตัด/ซ้อน/เพี้ยน/ตกหล่นตัวอักษร
- คำ callout และป้ายทั้งหมดเป็นภาษาไทยที่สะกดถูก อ่านรู้เรื่อง

ข้อห้าม:
- ห้ามใส่โลโก้แบรนด์จริง ชื่อบริษัทจริง เบอร์โทร อีเมล URL หรือราคาจริง
- ห้ามคำการันตีผลลัพธ์เกินจริง (เช่น 100%, การันตีผ่าน)
- ห้ามภาพถ่ายจริงปนในองค์ประกอบหลัก — คุมให้เป็นเวกเตอร์แฟลตทั้งภาพ
- ปีปัจจุบัน: สไตล์ร่วมสมัย`

async function main() {
  const APPLY = process.env.APPLY === '1'
  const SCOPE = (process.env.SCOPE || 'studio').toLowerCase() // 'studio' | 'all'

  const where: any = { type: 'CE_IMAGE_PROMPT', isActive: true }
  if (SCOPE === 'studio') where.projectId = null

  const rows = await prisma.promptTemplate.findMany({
    where,
    select: { id: true, organizationId: true, projectId: true, name: true, promptText: true },
    orderBy: [{ projectId: 'asc' }],
  })

  console.log(`SCOPE=${SCOPE}  APPLY=${APPLY ? 'YES (จะเขียนจริง)' : 'no (dry run)'}`)
  console.log(`พบ CE_IMAGE_PROMPT ที่ active: ${rows.length} แถว`)
  for (const r of rows) {
    const scope = r.projectId ? `project:${r.projectId}` : 'STUDIO'
    const already = r.promptText === IMAGE_DEFAULT ? ' [ตรงกับบรีฟใหม่แล้ว]' : ''
    console.log(`  - ${scope}  "${r.name}"  (${r.promptText.length} chars)${already}`)
  }

  const toChange = rows.filter(r => r.promptText !== IMAGE_DEFAULT)
  console.log(`\nต้องแก้ ${toChange.length} แถว`)

  // สำรองของเดิมเสมอ (แม้ dry run) — กู้คืนได้
  const backupPath = `/private/tmp/claude-501/image-prompt-backup-${Date.now()}.json`
  writeFileSync(backupPath, JSON.stringify(rows, null, 2))
  console.log(`สำรองข้อความเดิมไว้ที่: ${backupPath}`)

  if (!APPLY) {
    console.log('\n[DRY RUN] ไม่ได้เขียนอะไร — ส่ง APPLY=1 เพื่อเขียนจริง')
    return
  }

  let n = 0
  for (const r of toChange) {
    await prisma.promptTemplate.update({ where: { id: r.id }, data: { promptText: IMAGE_DEFAULT } })
    n++
  }
  console.log(`\n[APPLIED] อัปเดตแล้ว ${n} แถว`)
}

main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1) })
