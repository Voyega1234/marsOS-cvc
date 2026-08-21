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
import { IMAGE_DEFAULT } from './_image-default-brief'

const prisma = new PrismaClient()


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
