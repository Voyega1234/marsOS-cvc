import { useMemo } from 'react'
import { projectThemeToUpload } from '@/lib/project-theme'
import type { ProjectData } from '@/components/projects/sme-types'

/** หน้าตาที่พรีวิว/ไฟล์ดาวน์โหลดต้องใช้จากธีมโปรเจกต์ — ยังไม่เคยสแกน = ไม่มีค่า พรีวิวเหมือนเดิม */
export function useProjectArticleLook(project: ProjectData) {
  return useMemo(() => {
    const t = projectThemeToUpload(project.themeColors ?? null, project.accentColor ?? null)
    return { detail: t.detail, pageBackground: t.pageBackground || undefined }
  }, [project.themeColors, project.accentColor])
}
