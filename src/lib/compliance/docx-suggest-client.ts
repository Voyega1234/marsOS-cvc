// Browser only — ใช้ DOMParser / XMLSerializer / URL.createObjectURL
import type { Finding } from './types'
import { annotateDocumentXml, buildCommentsXml, ensureCommentsPart, docxBodyText, findingsToItems, plainDocxParts } from './docx-suggest'
import type { XmlDom } from './docx-suggest'

export const DOCX_MAX_BYTES = 25 * 1024 * 1024
const DOC_XML_MAX = 30_000_000
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const BAD_FILE = 'ไฟล์ Word เสียหรืออ่านไม่ได้'
const AUTHOR = 'MarsOS Compliance'

const dom: XmlDom = {
  parse: (x) => {
    const d = new DOMParser().parseFromString(x, 'application/xml')
    if (d.getElementsByTagName('parsererror').length) throw new Error(BAD_FILE)
    return d
  },
  serialize: (d) => new XMLSerializer().serializeToString(d),
}

async function loadZip(file: Blob) {
  if (file.size > DOCX_MAX_BYTES) throw new Error('ไฟล์ใหญ่เกิน 25 MB')
  const { default: JSZip } = await import('jszip')
  let zip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    throw new Error(BAD_FILE)
  }
  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error(BAD_FILE)
  const documentXml = await docFile.async('string')
  if (documentXml.length > DOC_XML_MAX) throw new Error('เนื้อหาในไฟล์ใหญ่เกินไป')
  return { zip, documentXml }
}

export async function readDocxBodyText(file: Blob): Promise<string> {
  const { documentXml } = await loadZip(file)
  return docxBodyText(documentXml, dom)
}

export async function annotateDocx(
  file: Blob,
  findings: Finding[],
): Promise<{ blob: Blob; changes: number; comments: number; unplaced: number; total: number; withFix: number }> {
  const { zip, documentXml } = await loadZip(file)
  const items = findingsToItems(findings)
  const ctFile = zip.file('[Content_Types].xml')
  if (!ctFile) throw new Error(BAD_FILE)
  const contentTypesXml = await ctFile.async('string')
  const relsFile = zip.file('word/_rels/document.xml.rels')
  const relsXml = relsFile ? await relsFile.async('string') : null

  // เช็คก่อนว่ามี comments part เดิมไหม (ไม่แก้ไฟล์ถ้ายังไม่มี comment ใหม่)
  const probe = ensureCommentsPart(contentTypesXml, relsXml, dom)
  const existingFile = relsXml && probe.rels === relsXml ? zip.file(probe.target) : null
  const existingCommentsXml = existingFile ? await existingFile.async('string') : null

  const date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const res = annotateDocumentXml(documentXml, items, { dom, author: AUTHOR, date, existingCommentsXml })
  // ใส่อะไรลงไฟล์ไม่ได้เลย (เช่น ไฟล์ Strict Open XML ที่โครงสร้างต่างออกไป) — บอกตรง ๆ ดีกว่าให้ไฟล์เปล่ากลับไป
  if (items.length > 0 && res.comments.length === 0) {
    throw new Error('ใส่คำแนะนำลงไฟล์นี้ไม่ได้ — อ่านเนื้อหาในไฟล์ไม่ออก ลองบันทึกเป็น Word Document (.docx) ใหม่ หรือใช้ปุ่ม "สร้างไฟล์ Word ใหม่จากข้อความที่ตรวจ"')
  }
  zip.file('word/document.xml', res.xml)
  if (res.comments.length) {
    zip.file(probe.target, buildCommentsXml(existingCommentsXml, res.comments, { dom, author: AUTHOR, date }))
    zip.file('[Content_Types].xml', probe.contentTypes)
    zip.file('word/_rels/document.xml.rels', probe.rels)
  }
  const blob = await zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE' })
  const withFix = items.filter(i => i.fixTarget && i.replacement && i.fixTarget !== i.replacement).length
  return { blob, changes: res.changes, comments: res.comments.length, unplaced: res.unplaced.length, total: items.length, withFix }
}

export async function buildPlainDocx(title: string, text: string): Promise<Blob> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const parts = plainDocxParts(title, text)
  for (const name of Object.keys(parts)) zip.file(name, parts[name])
  return zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE' })
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
