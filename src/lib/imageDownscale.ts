// ย่อรูปที่ผู้ใช้อัปโหลดก่อนเก็บเป็น data URL (รูปผู้เขียน / รูปช่องทาง CTA)
// รูปจากกล้องมือถือเป็น base64 ได้หลาย MB ทำให้ปุ่มบันทึกของ Article Lab
// ชนเพดาน request 4.5MB ของ Vercel — ใช้ในเบราว์เซอร์เท่านั้น

/** data URL ที่เล็กกว่านี้ไม่ต้องย่อ */
const SMALL_ENOUGH = 150_000

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('อ่านไฟล์รูปไม่ได้'))
    img.src = src
  })
}

/** ย่อ data URL ให้ด้านยาวไม่เกิน maxSide — คืนค่าเดิมถ้าเล็กอยู่แล้วหรือย่อไม่ได้ */
export async function downscaleDataUrl(dataUrl: string, maxSide = 512): Promise<string> {
  if (!dataUrl.startsWith('data:image/') || dataUrl.length <= SMALL_ENOUGH) return dataUrl
  if (dataUrl.startsWith('data:image/svg')) return dataUrl
  try {
    const img = await loadImage(dataUrl)
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    ctx.drawImage(img, 0, 0, w, h)
    // webp เก็บพื้นโปร่งใสได้ (QR / โลโก้) — เบราว์เซอร์ที่ไม่รองรับจะคืน png มาแทน
    const out = canvas.toDataURL('image/webp', 0.85)
    return out.length < dataUrl.length ? out : dataUrl
  } catch {
    return dataUrl
  }
}

/** อ่านไฟล์ที่อัปโหลดเป็น data URL ที่ย่อแล้ว */
export async function fileToDownscaledDataUrl(file: File, maxSide = 512): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (ev) => resolve((ev.target?.result as string) ?? '')
    reader.onerror = () => reject(new Error('อ่านไฟล์รูปไม่ได้'))
    reader.readAsDataURL(file)
  })
  return downscaleDataUrl(raw, maxSide)
}
