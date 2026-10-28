import sharp from 'sharp'

/** รูปประกอบในเนื้อหาย่อกว้างสุด 1200px — บทความมีได้ถึง 5 รูป ฝังเป็น base64 ต้องไม่ให้ response เกินเพดาน 4.5MB */
export const INLINE_MAX_W = 1200

export async function shrinkInline(base64: string, mimeType: string): Promise<{ base64: string; mimeType: string }> {
  try {
    const buf = await sharp(Buffer.from(base64, 'base64'))
      .resize({ width: INLINE_MAX_W, withoutEnlargement: true })
      .webp({ quality: 76 })
      .toBuffer()
    return { base64: buf.toString('base64'), mimeType: 'image/webp' }
  } catch {
    return { base64, mimeType }
  }
}
