/**
 * ป้ายกำกับ AIJob ของเมนู Upload Article — AIJob.projectId ผูกกับตาราง Project จึงใส่ id ของ UploadClient ไม่ได้
 * เก็บไว้ในช่อง input (inputSummary ของ logAIJob) แทน หน้า AI Jobs อ่านกลับเพื่อแยกค่าใช้จ่ายตามลูกค้า
 */

export const UPLOAD_ARTICLE_JOB_INPUT_PREFIX = 'upload-article:'
export const UPLOAD_ARTICLE_PAGE_LABEL = 'Upload Article'

export function uaJobInput(clientId: string): string {
  return `${UPLOAD_ARTICLE_JOB_INPUT_PREFIX}${clientId}`
}

/** id ของ UploadClient จากช่อง input — ไม่ใช่งานของ Upload Article = null */
export function uaClientIdFromJobInput(input: string | null | undefined): string | null {
  if (!input || !input.startsWith(UPLOAD_ARTICLE_JOB_INPUT_PREFIX)) return null
  const id = input.slice(UPLOAD_ARTICLE_JOB_INPUT_PREFIX.length).trim()
  return id || null
}

/** jobType ที่มีแค่ในเมนูนี้ — ใช้กับ log เก่าที่ยังไม่มีป้ายกำกับ */
export function isUploadArticleJobType(jobType: string): boolean {
  return jobType.startsWith('UPLOAD_')
}
