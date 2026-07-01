export type TaskSource = 'mars' | 'manual' | 'client' | 'review'
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked'
export type TaskPriority = 'urgent' | 'high' | 'normal' | 'low'

export interface MarsTask {
  id: string
  title: string
  description: string
  source: TaskSource
  sourceRef?: string
  status: TaskStatus
  priority: TaskPriority
  assignee: string
  projectId: string | null
  projectName: string | null
  dueDate: string
  dueTime?: string
  tags: string[]
  createdAt: string
  completedAt?: string
  actionHref?: string
  actionLabel?: string
  artifact?: {
    type: 'article' | 'review' | 'ai_job' | 'wordpress'
    id: string
    title: string
    status: string
    href: string
  }
}

export const MOCK_TASKS: MarsTask[] = [
  {
    id: 'task-1',
    title: 'รีวิว SEO บทความ "วีซ่าญี่ปุ่น 2026" ด่วน',
    description: 'บทความค้าง SEO Review มา 3 วันแล้ว deadline ส่งลูกค้า 31 พ.ค. SEO score ตอนนี้ 62/100 ต้องขึ้นเป็น 75+',
    source: 'review',
    status: 'in_progress',
    priority: 'urgent',
    assignee: 'Admin',
    projectId: 'proj-1',
    projectName: 'Cojourney Visa',
    dueDate: '2026-05-31',
    dueTime: '17:00',
    tags: ['seo', 'review', 'deadline'],
    createdAt: '2026-05-26T09:00:00',
    actionHref: '/review',
    actionLabel: 'เปิด Review Queue',
    artifact: {
      type: 'article',
      id: 'art-001',
      title: 'วีซ่าญี่ปุ่น 2026 — ขอยังไง ใช้เอกสารอะไรบ้าง',
      status: 'SEO_REVIEW',
      href: '/review',
    },
  },
  {
    id: 'task-2',
    title: 'Reconnect WordPress — Siam Clinic',
    description: 'Application Password หมดอายุ บทความที่ draft ไว้ 2 ชิ้นยังไม่ได้ส่ง ต้อง reconnect แล้วกด Publish อีกครั้ง',
    source: 'mars',
    status: 'todo',
    priority: 'high',
    assignee: 'Admin',
    projectId: 'proj-3',
    projectName: 'Siam Clinic',
    dueDate: '2026-05-29',
    tags: ['wordpress', 'publish'],
    createdAt: '2026-05-29T07:00:00',
    actionHref: '/website-connect',
    actionLabel: 'ตั้งค่า WordPress',
    artifact: {
      type: 'wordpress',
      id: 'wp-001',
      title: 'Siam Clinic — WordPress Connection',
      status: 'ERROR',
      href: '/website-connect',
    },
  },
  {
    id: 'task-3',
    title: 'Approve 3 บทความที่รอการอนุมัติ',
    description: '"ประกันเดินทาง AXA", "วีซ่าเชงเก้น 2026", "ทริปญี่ปุ่น 7 วัน" ทั้งหมดผ่าน SEO check แล้ว รอ Approve เพื่อ Push WordPress',
    source: 'review',
    status: 'todo',
    priority: 'high',
    assignee: 'Admin',
    projectId: null,
    projectName: null,
    dueDate: '2026-05-30',
    tags: ['approve', 'publish'],
    createdAt: '2026-05-28T14:00:00',
    actionHref: '/review',
    actionLabel: 'ดู Review Queue',
  },
  {
    id: 'task-4',
    title: 'ตรวจสอบ AI Cost — ใกล้เกินงบ',
    description: 'ใช้ AI ไป $43.50 จากงบ $50.00 (87%) เหลือ 2 วัน มี Batch 12 บทความยังค้างอยู่ พิจารณาเลื่อน batch ไปเดือนหน้า',
    source: 'mars',
    status: 'todo',
    priority: 'normal',
    assignee: 'Admin',
    projectId: 'proj-2',
    projectName: 'Cojourney Travel',
    dueDate: '2026-05-31',
    tags: ['ai-cost', 'budget'],
    createdAt: '2026-05-29T07:00:00',
    actionHref: '/ai-jobs',
    actionLabel: 'ดู AI Jobs',
    artifact: {
      type: 'ai_job',
      id: 'batch-001',
      title: 'Batch — 12 บทความ Cojourney Travel',
      status: 'PENDING',
      href: '/batch',
    },
  },
  {
    id: 'task-5',
    title: 'เขียน Outline บทความ "ต่อวีซ่านักเรียน"',
    description: 'Keyword มี volume 2,400/เดือน intent: INFORMATIONAL เหมาะเป็น TOFU บทความ ลูกค้าขอภายในสัปดาห์นี้',
    source: 'client',
    status: 'todo',
    priority: 'normal',
    assignee: 'Writer',
    projectId: 'proj-1',
    projectName: 'Cojourney Visa',
    dueDate: '2026-06-02',
    tags: ['outline', 'keyword', 'tofu'],
    createdAt: '2026-05-28T10:00:00',
    actionHref: '/articles/new',
    actionLabel: 'สร้างบทความ',
  },
  {
    id: 'task-6',
    title: 'ส่ง Monthly Report ให้ลูกค้า Cojourney',
    description: 'Report เดือน พ.ค. พร้อมแล้ว: 8 บทความ Posted, avg SEO score 78/100, organic traffic +22% MoM ต้องส่งก่อน 31 พ.ค.',
    source: 'manual',
    status: 'todo',
    priority: 'normal',
    assignee: 'Admin',
    projectId: 'proj-1',
    projectName: 'Cojourney Visa',
    dueDate: '2026-05-31',
    tags: ['report', 'client'],
    createdAt: '2026-05-29T08:00:00',
    actionHref: '/ai-seo-report',
    actionLabel: 'ดู SEO Report',
  },
  {
    id: 'task-7',
    title: 'ตั้งค่า Prompt Template ใหม่สำหรับ Medical niche',
    description: 'Siam Clinic ต้องการ tone ที่เป็น professional medical มากขึ้น ต้องสร้าง Brand Template และ Prompt แยกจาก Cojourney',
    source: 'client',
    status: 'in_progress',
    priority: 'normal',
    assignee: 'Admin',
    projectId: 'proj-3',
    projectName: 'Siam Clinic',
    dueDate: '2026-06-05',
    tags: ['prompt', 'template', 'setup'],
    createdAt: '2026-05-27T11:00:00',
    actionHref: '/templates',
    actionLabel: 'จัดการ Templates',
  },
  {
    id: 'task-8',
    title: 'รัน Keyword Research batch — Cojourney Travel Q3',
    description: 'ต้องการ keyword list 50 คำสำหรับ Q3 content plan destination: ญี่ปุ่น, เกาหลี, ยุโรป ใช้ AI Keyword Research tool',
    source: 'mars',
    status: 'done',
    priority: 'normal',
    assignee: 'Admin',
    projectId: 'proj-2',
    projectName: 'Cojourney Travel',
    dueDate: '2026-05-28',
    tags: ['keyword', 'planning', 'q3'],
    createdAt: '2026-05-25T09:00:00',
    completedAt: '2026-05-28T16:30:00',
    actionHref: '/projects',
    actionLabel: 'ดู Project',
  },
]
