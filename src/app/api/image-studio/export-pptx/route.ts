import { NextRequest, NextResponse } from 'next/server'
import PptxGenJS from 'pptxgenjs'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { imageBase64, mimeType, title, keyword, type, accentColor, siteName, w, h } = body

  if (!imageBase64 || !title || !keyword) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const prs = new PptxGenJS()

  const slideW = (w || 1536) / 96
  const slideH = (h || 864) / 96
  prs.defineLayout({ name: 'CUSTOM', width: slideW, height: slideH })
  prs.layout = 'CUSTOM'

  const slide = prs.addSlide()

  // Background image
  slide.addImage({
    data: `data:${mimeType || 'image/webp'};base64,${imageBase64}`,
    x: 0, y: 0, w: slideW, h: slideH,
  })

  // Dark overlay at bottom
  const overlayH = slideH * 0.45
  slide.addShape(prs.ShapeType.rect, {
    x: 0,
    y: slideH - overlayH,
    w: slideW,
    h: overlayH,
    fill: { color: '000000', transparency: 30 },
    line: { color: '000000', transparency: 100 },
  })

  // Accent bar
  const hex = (accentColor || '#2563eb').replace('#', '')
  slide.addShape(prs.ShapeType.rect, {
    x: 0,
    y: slideH * 0.55,
    w: 0.08,
    h: slideH * 0.45,
    fill: { color: hex },
    line: { color: hex, transparency: 100 },
  })

  // Keyword badge
  if (keyword) {
    slide.addText(keyword.toUpperCase(), {
      x: 0.2,
      y: slideH * 0.57,
      w: slideW - 0.4,
      h: 0.35,
      fontSize: 10,
      bold: true,
      color: hex,
      fontFace: 'Arial',
    })
  }

  // Title
  slide.addText(title, {
    x: 0.2,
    y: slideH * 0.63,
    w: slideW * 0.85,
    h: slideH * 0.28,
    fontSize: type === 'cover' ? 28 : 22,
    bold: true,
    color: 'FFFFFF',
    fontFace: 'Arial',
    wrap: true,
    valign: 'top',
  })

  // Site name
  if (siteName) {
    slide.addText(siteName, {
      x: 0,
      y: slideH - 0.35,
      w: slideW - 0.2,
      h: 0.3,
      fontSize: 9,
      color: 'CCCCCC',
      fontFace: 'Arial',
      align: 'right',
    })
  }

  const buffer = await prs.write({ outputType: 'arraybuffer' }) as ArrayBuffer

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${type || 'image'}-${keyword.replace(/\s+/g, '-')}.pptx"`,
    },
  })
}
