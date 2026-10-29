/**
 * Push article to WordPress via REST API.
 * Follows Convert-Cake wordpress_client.py logic:
 *   - Upload cover SVG as featured image (wp/v2/media)
 *   - Create post with: title, HTML content, slug, meta (Yoast), featured_media
 *   - Elementor ticked: same HTML as content in one Elementor HTML widget (applyElementorMode)
 *   - Set: meta_title, meta_description, focus_keyword via Yoast meta keys
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sanitizeArticleHtml } from '@/lib/articleSanitize'
import { boxKeyTakeaways, faqQuestionsToSpan } from '@/lib/article-structure'
import { stripStyleTags, stripLeadingH1, normalizeCtaItems, flattenEmbeddedNewlines } from '@/lib/articleComponents'
import { buildProjectArticleCss, projectThemeToUpload } from '@/lib/project-theme'
import { applyFaqDisplay } from '@/lib/upload-article/theme-css'
import { publishToSite, type SiteConnectionConfig, type SitePlatform } from '@/lib/sitePublishers'
import { buildArticleSchema } from '@/lib/articleSchema'
import { isIndexableUrl, requestIndexIfLive } from '@/lib/upload-article/request-index'
import { parsePushPrefs, saveProjectIndexRequest } from '@/lib/project-index-requests'
import { applyElementorMode, buildElementorData, type SiteTocWidget } from '@/lib/upload-article/wp-push'
import { syncSeoPluginMeta } from '@/lib/upload-article/seo-plugins'
import { safeFetch } from '@/lib/upload-article/safe-fetch'
import { resolveProjectWpCredentials } from '@/lib/project-wp-credentials'
import { updateProjectPrefs } from '@/lib/project-prefs-store'
import { findOrUploadWpMedia, replaceInlineDataImages } from '@/lib/wp-media'

export const maxDuration = 300

function extractSeoMeta(html: string, fallbackTitle: string, fallbackKeyword: string) {
  // Parse <!-- CONVERT_CAKE_SEO_META ... --> block (line-based key: value format)
  const blockMatch = html.match(/<!--\s*CONVERT_CAKE_SEO_META([\s\S]*?)-->/i)
  const block = blockMatch?.[1] ?? ''

  function get(key: string): string {
    const m = block.match(new RegExp(`${key}\\s*[:=]\\s*([^\\n]+)`, 'i'))
    return m?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
  }

  const metaTitle       = get('meta_title') || fallbackTitle
  const focusKeyword    = get('focus_keyword') || fallbackKeyword
  const coverAlt        = get('cover_image_alt') || fallbackTitle

  // en_slug: sanitize to a-z0-9 hyphens only
  let enSlug = get('en_slug').toLowerCase()
  enSlug = enSlug.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

  // meta_description: try SEO_META block first, then <meta name="description"> tag in HTML
  let metaDescription = get('meta_description')
  if (!metaDescription) {
    const metaTagMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)
                      ?? html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i)
    if (metaTagMatch?.[1]) metaDescription = metaTagMatch[1].trim()
  }

  return { metaTitle, metaDescription, focusKeyword, coverAlt, enSlug }
}

function svgToPngDataUrl(svg: string): string {
  // Return SVG as-is data URL (WordPress accepts SVG via media upload if allowed,
  // otherwise we send as PNG mime but with SVG content — WP stores it fine for featured image)
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

async function uploadCoverImage(
  wpUrl: string, creds: string, imageBase64: string, mimeType: string, title: string, altText: string
): Promise<{ id: number; url: string } | null> {
  const r = await findOrUploadWpMedia({ wpUrl, creds, base64: imageBase64, mime: mimeType, title, alt: altText, fetchFn: fetch })
  return r ? { id: r.id, url: r.url } : null
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  // metaTitle/metaDescription = ค่าที่แก้เองในแท็บ Review (override) — ถ้ามีต้องชนะทุกแหล่ง
  const { html, title, keyword, slug: manualSlug, coverImage = '', coverMimeType = 'image/webp', metaTitle: reviewMetaTitle = '', metaDescription: reviewMetaDesc = '', publishMode = 'draft', useElementor = false, wpPostType = 'post', projectId, connectionId, stripH1, autoRequestIndex, articleId } = body
  const orgId = session.user.organizationId

  // Enrich with DB article data — articleId (แถวที่หน้า Push ใช้จริง) มาก่อน ไม่มีค่อยหาตามชื่อ
  // หาตามชื่อเรียง updatedAt desc ให้ตรงกับ by-title/writer — ชื่อซ้ำกันจะได้แถวเดียวกันทุกจุด
  let dbMetaDescription = ''
  let dbSeoTitle = ''
  let dbSlug = ''
  let dbCoverDataUri = ''
  let dbArticleId = ''
  if (projectId && (title || articleId)) {
    const select = { id: true, metaDescription: true, seoTitle: true, slug: true, coverImageUrl: true }
    const byId = typeof articleId === 'string' && articleId
      ? await prisma.article.findFirst({ where: { id: articleId, projectId, project: { organizationId: orgId } }, select }).catch(() => null)
      : null
    const dbArticle = byId ?? (title ? await prisma.article.findFirst({
      where: { projectId, project: { organizationId: orgId }, title },
      orderBy: { updatedAt: 'desc' },
      select,
    }).catch(() => null) : null)
    if (dbArticle) {
      dbArticleId       = dbArticle.id
      dbMetaDescription = dbArticle.metaDescription ?? ''
      dbSeoTitle        = dbArticle.seoTitle ?? ''
      dbSlug            = dbArticle.slug ?? ''
      // ภาพปกที่เปลี่ยนในแท็บ Review ถูกเก็บเป็น data URI ไว้ที่นี่ (อยู่ข้ามเซสชัน)
      dbCoverDataUri    = (dbArticle.coverImageUrl ?? '').startsWith('data:') ? dbArticle.coverImageUrl! : ''
    }
  }

  // ── เตรียม HTML ก่อนขึ้นเว็บ (feedback PSEO) ──
  // 1. sanitize กันข้อความ AI หลุด  2. โหมด clean = ถอด <style> ให้ธีมเว็บคุม
  // 3. ตัด H1 (เว็บส่วนใหญ่แสดง H1 จาก post title อยู่แล้ว — default: ตัด)
  // บทความเก่าที่บันทึกช่วง 2026-10-21..22 มี <h3> ใน <summary> ซึ่ง WordPress ตัดทิ้ง — แปลงเป็น span ก่อน
  // หัวกล่องสรุปเป็นคำมาตรฐานตามภาษาของเนื้อหา (บทความไทยเก่าที่ยังเขียน Key Takeaways ไม่ต้อง Re-generate)
  let processedHtml = sanitizeArticleHtml(boxKeyTakeaways(faqQuestionsToSpan(html)))
  let projectStyleMode = 'embed'
  let projectEmbedCss: string | null = null
  let prefStripH1: boolean | undefined
  let sitePlatform: string | null = null
  let siteConn: SiteConnectionConfig = {}
  if (projectId) {
    try {
      const proj = await (prisma.project as any).findFirst({
        where: { id: projectId, organizationId: orgId },
        select: { themeColors: true, accentColor: true, ctaSetting: true, pushPrefs: true, websitePlatform: true, siteConnection: true },
      })
      try { projectStyleMode = JSON.parse(proj?.themeColors || '{}').styleMode === 'clean' ? 'clean' : 'embed' } catch { /* default */ }
      try { prefStripH1 = JSON.parse(proj?.pushPrefs || '{}').stripH1 } catch { /* default */ }
      if (proj && projectStyleMode === 'embed') projectEmbedCss = buildProjectArticleCss(proj)
      // FAQ เป็นแบบที่ธีมโปรเจกต์ตั้งไว้ (กดเปิด-ปิด / เปิดตลอด ตามที่สแกนเจอ) — ไม่ได้ตั้ง = แบบเดิม
      if (proj) processedHtml = applyFaqDisplay(processedHtml, projectThemeToUpload(proj.themeColors, proj.accentColor).detail?.faq)
      sitePlatform = proj?.websitePlatform ?? null
      try { siteConn = JSON.parse(proj?.siteConnection || '{}') } catch { /* ว่าง */ }
    } catch { /* non-fatal */ }
  }
  if (projectStyleMode === 'clean') processedHtml = stripStyleTags(processedHtml)
  // โหมด embed: แนบ CSS ล่าสุดของโปรเจกต์ใหม่ (ถอด <style> เดิมก่อนแล้วแปะใหม่ — idempotent ไม่แตะโครงอื่น เช่น schema)
  else if (projectEmbedCss && /class="content-article"/.test(processedHtml)) processedHtml = `<style>\n${projectEmbedCss}\n</style>\n${stripStyleTags(processedHtml)}`
  const shouldStripH1 = typeof stripH1 === 'boolean' ? stripH1 : (prefStripH1 ?? true)
  if (shouldStripH1) processedHtml = stripLeadingH1(processedHtml)

  // ── บทความรุ่นเก่าที่ยังไม่มี Schema JSON-LD → generate แปะให้ตอนขึ้นเว็บ ──
  // (บทความใหม่มีมาจาก write pipeline แล้ว — ข้ามเพราะเจอ ld+json อยู่แล้ว)
  if (projectId && title && !/application\/ld\+json/i.test(processedHtml)) {
    try {
      const projMeta = await (prisma.project as any).findFirst({
        where: { id: projectId, organizationId: orgId },
        select: { name: true, clientName: true, website: true, ctaSetting: true, businessType: true, authorEnabled: true, authors: true, authorName: true, authorTitle: true },
      })
      if (projMeta) {
        const metaForSchema = extractSeoMeta(processedHtml, title, keyword ?? '')
        let ctaFirstItemChannels: Array<{ type?: string; label?: string; value?: string }> = []
        try {
          const parsed = JSON.parse(projMeta.ctaSetting || '{}')
          const normalized = normalizeCtaItems(parsed)
          // เดิมใช้ channels ไม่สนว่าเปิด CTA อยู่หรือไม่ — คงพฤติกรรมเดิม
          ctaFirstItemChannels = normalized.items[0]?.channels ?? []
        } catch { /* ว่าง */ }
        const chans = ctaFirstItemChannels.filter(c => c?.value)
        let authorName = '', authorTitle = ''
        if (projMeta.authorEnabled) {
          try {
            const first = (JSON.parse(projMeta.authors || '[]') as Array<{ name?: string; title?: string }>)[0]
            authorName = first?.name || projMeta.authorName || ''
            authorTitle = first?.title || projMeta.authorTitle || ''
          } catch { authorName = projMeta.authorName || '' }
        }
        const schema = buildArticleSchema({
          html: processedHtml,
          title,
          metaDescription: dbMetaDescription || metaForSchema.metaDescription || undefined,
          slug: manualSlug?.trim() || dbSlug || metaForSchema.enSlug || undefined,
          siteUrl: projMeta.website || undefined,
          siteName: projMeta.clientName || projMeta.name || undefined,
          authorName: authorName || undefined,
          authorTitle: authorTitle || undefined,
          contact: {
            phones: chans.filter(c => /phone|tel|โทร/i.test(`${c.type} ${c.label}`) || /^0\d{8,9}$/.test((c.value ?? '').replace(/[\s-]/g, ''))).map(c => c.value as string),
            email: chans.find(c => /mail/i.test(`${c.type} ${c.label}`) || (c.value ?? '').includes('@'))?.value,
          },
          serviceName: (projMeta.businessType ?? '').trim() || undefined,
        })
        processedHtml = `${schema}\n${processedHtml}`
      }
    } catch { /* non-fatal — ขึ้นเว็บโดยไม่มี schema ดีกว่าล้มทั้ง publish */ }
  }

  // ── แพลตฟอร์มอื่นที่ไม่ใช่ WordPress → ลงผ่าน sitePublishers แล้วจบที่นี่ ──
  // (เว้นแต่ผู้ใช้เลือก WordPress Connection ระดับ org มาเองใน Push tab)
  if (sitePlatform && sitePlatform !== 'wordpress' && !connectionId) {
    const metaEarly = extractSeoMeta(processedHtml, dbSeoTitle || title, keyword ?? '')
    const result = await publishToSite(sitePlatform as SitePlatform, siteConn, {
      title,
      html: processedHtml,
      slug: manualSlug?.trim() || dbSlug || metaEarly.enSlug || undefined,
      excerpt: dbMetaDescription || metaEarly.metaDescription || undefined,
      coverBase64: coverImage || undefined,
      coverMimeType,
      publishMode,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })
    return NextResponse.json({
      postUrl: result.postUrl || '',
      postId: result.postId ?? '',
      platform: sitePlatform,
      mode: publishMode,
    })
  }

  const htmlForContent = processedHtml

  // credentials ชุดเดียวกับปุ่มทดสอบ (/api/push/connect) — รหัสจาก .env ใช้ได้เฉพาะเว็บเดียวกับ WP_URL ห้ามปนกับเว็บลูกค้า
  const resolved = await resolveProjectWpCredentials(orgId, projectId, connectionId)
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 })
  const { wpUrl, wpUser, wpPass } = resolved

  if (!html || !title) return NextResponse.json({ error: 'html และ title จำเป็น' }, { status: 400 })

  const creds = Buffer.from(`${wpUser}:${wpPass.replace(/\s+/g, '')}`).toString('base64')

  // 1. Extract SEO metadata from HTML (HTML comment block is the primary source)
  const meta = extractSeoMeta(html, dbSeoTitle || title, keyword ?? '')
  // ลำดับความสำคัญ: ค่าที่แก้ในแท็บ Review (override) → DB → meta block ในบทความ → title
  // ถ้าไม่เคยแก้ที่หน้า Review ค่า override เป็นค่าว่าง = ใช้ลำดับเดิมทุกอย่าง
  const reviewTitleOverride = String(reviewMetaTitle ?? '').trim()
  const reviewDescOverride  = String(reviewMetaDesc ?? '').trim()
  const finalSlug       = manualSlug?.trim() || dbSlug || ''
  const finalMetaDesc   = reviewDescOverride || dbMetaDescription || meta.metaDescription
  const finalMetaTitle  = reviewTitleOverride || meta.metaTitle || dbSeoTitle || title

  console.log('[push/publish] DEBUG', {
    title,
    manualSlug,
    dbSlug,
    finalSlug,
    reviewTitleOverride,
    reviewDescOverride: reviewDescOverride?.slice(0,80),
    finalMetaTitle,
    dbMetaDescription: dbMetaDescription?.slice(0,80),
    metaMetaDescription: meta.metaDescription?.slice(0,80),
    finalMetaDesc: finalMetaDesc?.slice(0,80),
    wpPostType,
  })
  const coverAltText    = meta.coverAlt !== (dbSeoTitle || title) ? meta.coverAlt : (dbSeoTitle || title)
  const isPage          = wpPostType === 'page'


  // 1c. Add alt text to inline <img> tags missing it (use article title as fallback)
  // WordPress แปลงขึ้นบรรทัดใหม่เป็น <br /> แม้ใน <style> — ยุบ CSS/JSON-LD เป็นบรรทัดเดียวก่อนส่ง
  const htmlWithAlt = flattenEmbeddedNewlines(htmlForContent).replace(
    /<img(?![^>]*\balt=)([^>]*?)(\s*\/?>)/gi,
    `<img alt="${(dbSeoTitle || title).replace(/"/g, '&quot;')}"$1$2`
  )

  // 2. Upload cover image as featured image
  let featuredMediaId: number | null = null
  const uploadedInline = new Map<string, string>()
  // รูปในเซสชันมาก่อน (เพิ่งเขียน/เพิ่งเปลี่ยนรอบนี้) — ไม่มีค่อยใช้ปกที่บันทึกไว้จากแท็บ Review
  let effectiveCover = String(coverImage ?? '').trim()
  let effectiveCoverMime = coverMimeType
  if (!effectiveCover && dbCoverDataUri) {
    const m = dbCoverDataUri.match(/^data:([^;]+);base64,(.+)$/)
    if (m) { effectiveCoverMime = m[1]; effectiveCover = m[2] }
  }
  if (effectiveCover) {
    const cover = await uploadCoverImage(wpUrl, creds, effectiveCover, effectiveCoverMime, dbSeoTitle || title, coverAltText)
    featuredMediaId = cover?.id ?? null
    // ปกในเนื้อหาเป็นรูปเดียวกับ featured image — ใช้ลิงก์ที่อัปแล้ว ไม่อัปซ้ำ
    if (cover?.url) uploadedInline.set(`data:${effectiveCoverMime};base64,${effectiveCover}`, cover.url)
  }
  // รูป data:image ในเนื้อหา → Media Library (บางเว็บตัด data: URI ทิ้ง)
  const htmlLinked = await replaceInlineDataImages({
    wpUrl, creds, html: htmlWithAlt, title: dbSeoTitle || title, known: uploadedInline, fetchFn: fetch,
  })

  // 3. Build post payload
  // content ใส่ HTML จริงเสมอ — ติ๊ก Elementor ก็ตาม (Elementor ล้ม = หน้าเว็บยังแสดงเนื้อหาปกติ ไม่ว่าง)
  const content = htmlLinked
  const payload: Record<string, unknown> = {
    // For pages: send empty title so WP doesn't show a title block above content (H1 is in HTML)
    // แต่ถ้าตัด H1 ออกแล้ว หน้าจะไม่มีหัวเรื่องเลย → ต้องส่ง title ไปด้วย
    title:   isPage && !shouldStripH1 ? '' : finalMetaTitle,
    content,
    excerpt: finalMetaDesc ? finalMetaDesc.slice(0, 160) : undefined,
    status: publishMode === 'publish' ? 'publish' : 'draft',
    ...(finalSlug && { slug: finalSlug }),
    ...(featuredMediaId && { featured_media: featuredMediaId }),
  }

  // 4. Yoast SEO meta
  const wpMeta: Record<string, string> = {}
  if (finalMetaTitle)    wpMeta['_yoast_wpseo_title']    = finalMetaTitle
  if (finalMetaDesc)     wpMeta['_yoast_wpseo_metadesc'] = finalMetaDesc.slice(0, 160)
  if (meta.focusKeyword) wpMeta['_yoast_wpseo_focuskw']  = meta.focusKeyword
  // Do NOT set _yoast_wpseo_slug — Yoast appends it to WP slug causing duplicates

  // 5. โหมด Elementor ตั้งใน applyElementorMode หลังบันทึกโพสต์ — ไม่ปนในคำขอแรก (ล้ม = retry ทิ้ง Yoast meta ไปด้วย)
  const wpEndpoint = isPage ? `${wpUrl}/wp-json/wp/v2/pages` : `${wpUrl}/wp-json/wp/v2/posts`

  if (Object.keys(wpMeta).length > 0) payload.meta = wpMeta

  // 6. โพสต์เดิมของบทความนี้ (เลขโพสต์ที่จดไว้ใน pushPrefs.wpPostIds) → อัปเดตโพสต์เดิมแม้ slug เปลี่ยน
  //    ไม่มี/หาไม่เจอ/อยู่ในถังขยะ → หาจาก slug ต่อ
  const postKind = isPage ? 'pages' : 'posts'
  const siteHost = (() => { try { return new URL(wpUrl).host.toLowerCase() } catch { return '' } })()
  let existingPostId: number | null = null
  let existingStatus = ''
  // ปลั๊กอิน SEO จากผลสแกนเว็บ (Article Lab) — ใช้เมื่ออ่าน /wp-json/ ไม่ได้
  let seoPluginHint: unknown
  // สารบัญที่เว็บลูกค้าวางในบทความเอง (Elementor) — วางแทนของเราตอน push แบบ Elementor, ปิด card สารบัญ = ไม่วาง
  let siteToc: SiteTocWidget | undefined
  if (projectId) {
    const proj = await prisma.project.findFirst({ where: { id: projectId, organizationId: orgId }, select: { pushPrefs: true } }).catch(() => null)
    const projPrefs = parsePushPrefs(proj?.pushPrefs)
    const scan = projPrefs.siteScan as { platform?: { seoPlugins?: unknown }; components?: { toc?: { native?: SiteTocWidget } } } | undefined
    if (dbArticleId) seoPluginHint = scan?.platform?.seoPlugins
    const excluded = (projPrefs.excludeCards as Record<string, unknown> | undefined)?.toc === true
    if (!excluded) siteToc = scan?.components?.toc?.native
    const map = dbArticleId ? projPrefs.wpPostIds as Record<string, { id?: unknown; kind?: unknown; host?: unknown }> | undefined : undefined
    const stored = map?.[dbArticleId]
    const storedId = Number(stored?.id)
    if (stored && Number.isInteger(storedId) && storedId > 0 && stored.kind === postKind && stored.host === siteHost) {
      const r = await fetch(`${wpUrl}/wp-json/wp/v2/${postKind}/${storedId}?context=edit&_fields=id,status`, {
        headers: { Authorization: `Basic ${creds}` },
        signal: AbortSignal.timeout(10000),
      }).catch(() => null)
      const found = r?.ok ? await r.json().catch(() => null) as { id?: number; status?: string } | null : null
      if (found?.id === storedId && found.status !== 'trash') { existingPostId = storedId; existingStatus = found.status ?? '' }
    }
  }
  // 6b. Check if post/page with this slug already exists → update instead of create
  if (!existingPostId && finalSlug) {
    const checkUrl = `${wpUrl}/wp-json/wp/v2/${isPage ? 'pages' : 'posts'}?slug=${encodeURIComponent(finalSlug)}&status=any&_fields=id,status&per_page=1`
    const checkRes = await fetch(checkUrl, {
      headers: { Authorization: `Basic ${creds}` },
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)
    if (checkRes?.ok) {
      const found = await checkRes.json().catch(() => [])
      if (Array.isArray(found) && found.length > 0) { existingPostId = found[0].id; existingStatus = found[0].status ?? '' }
    }
  }

  // Re-push โพสต์ที่ Live อยู่แล้ว (หน้า Push ตั้งต้นที่ Draft) — ห้ามดึงโพสต์ลงจากเว็บ คงสถานะ publish ไว้
  //   อยากซ่อนโพสต์เป็น Draft ให้ทำใน WordPress เอง
  const effectiveMode: 'draft' | 'publish' = publishMode === 'publish' || existingStatus === 'publish' ? 'publish' : 'draft'
  if (effectiveMode !== publishMode) payload.status = 'publish'

  try {
    const method = existingPostId ? 'POST' : 'POST'
    const endpoint = existingPostId
      ? `${wpUrl}/wp-json/wp/v2/${isPage ? 'pages' : 'posts'}/${existingPostId}`
      : wpEndpoint
    let res = await fetch(endpoint, {
      method,
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    })

    // Retry without meta if WP rejects (some installs don't expose meta via REST)
    if (!res.ok && payload.meta) {
      const retryPayload = { ...payload }
      delete retryPayload.meta
      res = await fetch(endpoint, {
        method,
        headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(retryPayload),
        signal: AbortSignal.timeout(30000),
      })
    }

    if (!res.ok) {
      const errText = await res.text()
      return NextResponse.json({ error: `WordPress API error ${res.status}: ${errText.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)}` }, { status: 400 })
    }

    const data = await res.json()
    const postId: number = data.id
    const postUrl: string = data.link ?? ''

    // จดเลขโพสต์ทันทีหลังสร้างใหม่ — ถ้า timeout ระหว่างงานหลังจากนี้ ครั้งหน้าจะอัปเดตโพสต์เดิมไม่สร้างซ้ำ
    if (projectId && dbArticleId && postId && !existingPostId) {
      await updateProjectPrefs(projectId, orgId, (cur) => {
        const prev = cur.wpPostIds && typeof cur.wpPostIds === 'object' ? cur.wpPostIds as Record<string, unknown> : {}
        return { prefs: { ...cur, wpPostIds: { ...prev, [dbArticleId]: { id: postId, kind: postKind, host: siteHost, at: new Date().toISOString() } } }, result: null }
      }).catch((e) => console.error('[push/publish] early save wpPostIds failed:', e instanceof Error ? e.message : e))
    }

    // 7. Elementor: ติ๊ก = เอกสาร Elementor (HTML widget ชุดเดียวกับ content) ไม่ติ๊ก = ออกจาก builder
    //    ใช้ตัวเดียวกับ Upload Article — REST ก่อน ตรวจหน้าเว็บจริง เว็บที่ไม่เปิด meta ของ Elementor ค่อยใช้ปลั๊กอิน convert-cake
    const yoastMeta: Record<string, string> = {}
    if (finalMetaTitle)    yoastMeta['_yoast_wpseo_title']    = finalMetaTitle
    if (finalMetaDesc)     yoastMeta['_yoast_wpseo_metadesc'] = finalMetaDesc.slice(0, 160)
    if (meta.focusKeyword) yoastMeta['_yoast_wpseo_focuskw']  = meta.focusKeyword

    console.log('[push/publish] postId:', postId, 'wpPostType:', wpPostType, 'yoastMeta keys:', Object.keys(yoastMeta))
    let warning: string | undefined
    if (postId) {
      // Yoast meta ผ่านปลั๊กอิน convert-cake เหมือนเดิม (หลายเว็บไม่เปิด meta ของ Yoast ผ่าน REST)
      // ปลั๊กอินตั้งโหมด builder ไปด้วยเสมอ — applyElementorMode ด้านล่างตั้งโหมดตามที่ติ๊กทับอีกรอบ
      const ccRes = await fetch(`${wpUrl}/wp-json/convert-cake/v1/elementor-meta`, {
        method: 'POST',
        headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post_id: postId,
          elementor_data_b64: Buffer.from(buildElementorData(htmlLinked, undefined, { siteToc: useElementor ? siteToc : undefined })).toString('base64'),
          edit_mode: 'builder',
          template_type: isPage ? 'wp-page' : 'wp-post',
          yoast_meta: yoastMeta,
        }),
        signal: AbortSignal.timeout(30000),
      }).catch(() => null)
      console.log('[push/publish] cc status:', ccRes?.status)

      warning = await applyElementorMode({
        wpUrl, creds, postId, isPage,
        useElementor: !!useElementor,
        html: htmlLinked,
        isUpdate: existingPostId != null,
        liveUrl: data.status === 'publish' && postUrl ? postUrl : undefined,
        yoastMeta,
        siteToc,
        // มีรหัสผ่าน + ล้าง cache ทั้งเว็บ — ห้ามถูกรีไดเรกต์ไปโดเมนอื่น หรือจาก https ลงไป http
        fetcher: (url, init) => safeFetch(url, init, { requireHttps: wpUrl.startsWith('https://'), sameHostOnly: true }),
      })
      console.log('[push/publish] elementor:', useElementor ? 'on' : 'off', warning ? `warning: ${warning.slice(0, 80)}` : 'ok')

      if (Object.keys(yoastMeta).length > 0) {
        // ส่ง Yoast meta ซ้ำทาง REST — เว็บที่ไม่มีปลั๊กอิน และคำขอแรกอาจ retry แบบตัด meta ทิ้งไปแล้ว
        await fetch(`${wpUrl}/wp-json/wp/v2/${isPage ? 'pages' : 'posts'}/${postId}`, {
          method: 'POST',
          headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ meta: yoastMeta }),
          signal: AbortSignal.timeout(20000),
        }).catch(() => {})
      }

      // For pages: set Yoast meta via XML-RPC (WP REST doesn't expose Yoast fields for pages)
      if (isPage && Object.keys(yoastMeta).length) {
        const escXml = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
        const customFields = Object.entries(yoastMeta).map(([key, value]) =>
          `<value><struct><member><name>key</name><value><string>${escXml(key)}</string></value></member><member><name>value</name><value><string>${escXml(value)}</string></value></member></struct></value>`
        ).join('')
        const cleanPass = wpPass.replace(/\s+/g,'')
        const xmlBody = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<methodCall><methodName>wp.editPost</methodName><params>',
          `<param><value><int>1</int></value></param>`,
          `<param><value><string>${escXml(wpUser)}</string></value></param>`,
          `<param><value><string>${escXml(cleanPass)}</string></value></param>`,
          `<param><value><int>${postId}</int></value></param>`,
          `<param><value><struct><member><name>custom_fields</name><value><array><data>${customFields}</data></array></value></member></struct></value></param>`,
          '</params></methodCall>',
        ].join('')
        const xmlRes = await fetch(`${wpUrl}/xmlrpc.php`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
          body: xmlBody,
          signal: AbortSignal.timeout(15000),
        }).catch(() => null)
        const xmlText = await xmlRes?.text().catch(() => '')
        console.log('[push/publish] xmlrpc:', xmlRes?.status, xmlText?.replace(/\s+/g,' ').slice(0, 600))
      }

      // ปลั๊กอิน SEO ตัวอื่น (AIOSEO / Rank Math / SEOPress / Slim SEO) — ไม่เจอ = ไม่ยิงเพิ่ม
      const seo = await syncSeoPluginMeta({
        wpUrl, creds, postId, isPage,
        title: finalMetaTitle,
        description: finalMetaDesc,
        post: data,
        hint: seoPluginHint,
        fetcher: (url, init) => safeFetch(url, init, { requireHttps: wpUrl.startsWith('https://'), sameHostOnly: true }),
      })
      console.log('[push/publish] seo plugins:', seo.plugins.join(',') || '-', 'written:', seo.written.join(',') || '-')
      if (seo.warning) warning = warning ? `${warning} · ${seo.warning}` : seo.warning
    }

    // Upsert article status in DB so Published tab persists across refreshes
    let articleIdForIndex: string | null = null
    if (projectId && orgId && title) {
      try {
        // แถวเดียวกับที่ enrich ไว้ตอนต้น (articleId/ชื่อล่าสุด) — ไม่หาตามชื่อซ้ำ ชื่อซ้ำกันจะเขียนผิดแถว
        const existing = dbArticleId ? { id: dbArticleId } : await prisma.article.findFirst({
          where: { projectId, project: { organizationId: orgId }, title },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        })
        const articleStatus = effectiveMode === 'publish' ? 'POSTED' : 'WORDPRESS_DRAFTED'
        if (existing) {
          articleIdForIndex = existing.id
          await prisma.article.update({
            where: { id: existing.id },
            data: { wordpressUrl: postUrl || null, status: articleStatus },
          })
        } else {
          // Get createdById from session
          const userId = session.user.id
          const created = await prisma.article.create({
            data: {
              projectId,
              title,
              slug: finalSlug || data.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
              status: articleStatus,
              wordpressUrl: postUrl || null,
              createdById: userId,
            },
            select: { id: true },
          })
          articleIdForIndex = created.id
        }
      } catch { /* non-fatal */ }
    }

    // จดเลขโพสต์ไว้ให้ push ครั้งหน้าอัปเดตโพสต์เดิม (ไม่สร้างซ้ำ) — ล้มก็ไม่กระทบผล push
    const postMapKey = dbArticleId || articleIdForIndex
    if (projectId && postMapKey && postId) {
      await updateProjectPrefs(projectId, orgId, (cur) => {
        const prev = cur.wpPostIds && typeof cur.wpPostIds === 'object' ? cur.wpPostIds as Record<string, unknown> : {}
        return { prefs: { ...cur, wpPostIds: { ...prev, [postMapKey]: { id: postId, kind: postKind, host: siteHost, at: new Date().toISOString() } } }, result: null }
      }).catch((e) => console.error('[push/publish] save wpPostIds failed:', e instanceof Error ? e.message : e))
    }

    // Request Index อัตโนมัติ (เฉพาะ Publish) — ห้ามทำให้ push ล้มเหลว
    let indexRequest: { url: string; at: string; ok: boolean; error?: string } | undefined
    try {
      if (articleIdForIndex && projectId && effectiveMode === 'publish' && data.status === 'publish' && autoRequestIndex !== false && isIndexableUrl(postUrl)) {
        const proj = await prisma.project.findFirst({ where: { id: projectId, organizationId: orgId }, select: { pushPrefs: true } })
        if (parsePushPrefs(proj?.pushPrefs).autoRequestIndex !== false) {
          indexRequest = await requestIndexIfLive(postUrl)
          await saveProjectIndexRequest(projectId, articleIdForIndex, indexRequest)
        }
      }
    } catch { /* non-fatal */ }

    // Activity log
    try {
      const userId = session.user.id
      if (orgId && userId) {
        await prisma.activityLog.create({
          data: {
            organizationId: orgId, userId,
            action: 'ARTICLE_PUSHED',
            entityType: 'Article',
            entityId: projectId || 'unknown',
            newValue: JSON.stringify({ title, keyword, postId, postUrl, publishMode: effectiveMode, wpUrl }),
          },
        })
      }
    } catch { /* non-fatal */ }

    return NextResponse.json({ ok: true, postId, postUrl, status: data.status, slug: data.slug ?? finalSlug, ...(warning ? { warning } : {}), ...(indexRequest ? { indexRequest } : {}) })

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Push ล้มเหลว: ${msg}` }, { status: 500 })
  }
}
