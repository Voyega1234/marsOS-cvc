export interface BriefAlert {
  id: string
  level: 'critical' | 'warning' | 'ok'
  project: string
  projectId: string
  title: string
  detail: string
  metric?: string
  metricDelta?: string
  action: string
  href: string
}

export interface MorningBrief {
  generatedAt: string
  date: string
  totalAlerts: number
  criticalCount: number
  warningCount: number
  alerts: BriefAlert[]
  aiSummary: string
  source: string
}

export const MOCK_MORNING_BRIEF: MorningBrief = {
  generatedAt: '2026-05-29T07:00:00+07:00',
  date: '2026-05-29',
  totalAlerts: 5,
  criticalCount: 1,
  warningCount: 3,
  aiSummary: 'วันนี้มี 1 critical: บทความ "วีซ่าญี่ปุ่น 2026" ค้างที่ SEO_REVIEW นาน 3 วันแล้ว ต้องรีวิวด่วนก่อนหมดเดือน มี 3 บทความรอ Approve และ AI cost เดือนนี้ใช้ไปแล้ว 87% ของงบ แนะนำตรวจสอบ Batch job ที่รันค้างอยู่',
  source: 'Mars DB · AI Job Monitor · 2026-05-29 07:00',
  alerts: [
    {
      id: 'brief-1',
      level: 'critical',
      project: 'Cojourney Visa',
      projectId: 'proj-1',
      title: 'บทความ "วีซ่าญี่ปุ่น 2026" ค้าง SEO Review 3 วัน',
      detail: 'บทความนี้ถึง deadline ส่งลูกค้าวันที่ 31 พ.ค. ยังไม่มีคนรีวิว SEO score 62/100 ต่ำกว่า threshold',
      metric: '62/100',
      metricDelta: 'SEO Score',
      action: 'รีวิวทันที',
      href: '/review',
    },
    {
      id: 'brief-2',
      level: 'warning',
      project: 'Cojourney Travel',
      projectId: 'proj-2',
      title: 'AI Cost เดือนนี้ใช้ไป 87% ของงบแล้ว',
      detail: 'ใช้ไป $43.50 จากงบ $50.00 เหลืออีก 2 วันของเดือน มี Batch job 12 บทความที่ยังไม่ได้รัน',
      metric: '$43.50',
      metricDelta: '87% of budget',
      action: 'ดู AI Jobs',
      href: '/ai-jobs',
    },
    {
      id: 'brief-3',
      level: 'warning',
      project: 'All Projects',
      projectId: 'all',
      title: '3 บทความรอ Approve ค้างนานกว่า 24 ชม.',
      detail: 'บทความที่รอ: "ประกันเดินทาง AXA", "วีซ่าเชงเก้น 2026", "ทริปญี่ปุ่น 7 วัน" ทั้งหมดผ่าน SEO check แล้ว',
      metric: '3',
      metricDelta: 'Pending approval',
      action: 'ดู Review Queue',
      href: '/review',
    },
    {
      id: 'brief-4',
      level: 'warning',
      project: 'Siam Clinic',
      projectId: 'proj-3',
      title: 'WordPress sync ล้มเหลว 2 ครั้งล่าสุด',
      detail: 'Application Password หมดอายุ บทความที่ draft ไว้ยังไม่ได้ส่ง WordPress ต้อง reconnect ก่อน',
      metric: '2 failed',
      metricDelta: 'WP sync',
      action: 'ตั้งค่า WordPress',
      href: '/website-connect',
    },
    {
      id: 'brief-5',
      level: 'ok',
      project: 'Cojourney Visa',
      projectId: 'proj-1',
      title: '8 บทความ Posted เดือนนี้ — ตามเป้า',
      detail: 'เป้าหมายเดือนนี้ 10 บทความ ทำไปแล้ว 8 เหลืออีก 2 บทความ keyword "วีซ่าออสเตรเลีย" และ "ต่อวีซ่า" อยู่ระหว่างรีวิว',
      metric: '8/10',
      metricDelta: 'Monthly target',
      action: 'ดูบทความ',
      href: '/articles',
    },
  ],
}
