import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const adminHash = await bcrypt.hash('Convertcakeseo01', 12)
  const userHash = await bcrypt.hash('Convertcakeseo01', 12)

  const admin = await prisma.user.upsert({
    where: { email: 'adminseo@marsosapp.com' },
    update: { name: 'adminseo', password: adminHash, role: 'ADMIN' },
    create: { name: 'adminseo', email: 'adminseo@marsosapp.com', password: adminHash, role: 'ADMIN', status: 'ACTIVE' },
  })
  console.log('adminseo:', admin.id, admin.role)

  const user = await prisma.user.upsert({
    where: { email: 'userseo@marsosapp.com' },
    update: { name: 'userseo', password: userHash, role: 'SEO_MANAGER' },
    create: { name: 'userseo', email: 'userseo@marsosapp.com', password: userHash, role: 'SEO_MANAGER', status: 'ACTIVE' },
  })
  console.log('userseo:', user.id, user.role)

  const all = await prisma.user.findMany({ select: { email: true, name: true, role: true } })
  console.log('\nAll users:')
  all.forEach(u => console.log(' -', u.email, '|', u.name, '|', u.role))
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
