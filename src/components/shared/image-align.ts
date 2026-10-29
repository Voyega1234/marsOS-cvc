export type ImageAlign = 'left' | 'center' | 'right' | 'full'

// จัดวางรูปใน editor — ใส่ทั้ง text-align ที่ figure และ display/margin ที่ img
// เว็บที่ตัด display ทิ้ง (WP kses) img เป็น inline → text-align ของ figure จัดให้, ธีมที่ทำ img เป็น block → margin auto จัดให้
// ต้องไม่มี import/closure — เทสส่ง source เข้า Chromium ตรง ๆ
export function alignImage(img: HTMLElement, align: ImageAlign, root: HTMLElement): void {
  const s = img.style
  s.setProperty('display', 'block')
  if (align === 'full') {
    s.setProperty('width', '100%')
    s.setProperty('height', 'auto')
    s.setProperty('margin-left', '0')
    s.setProperty('margin-right', '0')
    return
  }
  if (s.width === '100%') {
    s.removeProperty('width')
    s.removeProperty('height')
  }
  s.setProperty('margin-left', align === 'left' ? '0' : 'auto')
  s.setProperty('margin-right', align === 'right' ? '0' : 'auto')
  const fig = img.closest('figure')
  if (fig && fig !== root && root.contains(fig)) (fig as HTMLElement).style.setProperty('text-align', align)
}
