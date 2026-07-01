/**
 * Push article to WordPress via REST API.
 * Follows Convert-Cake wordpress_client.py logic:
 *   - Upload cover SVG as featured image (wp/v2/media)
 *   - Create post with: title, HTML content, slug, meta (Yoast), featured_media
 *   - Optionally wrap HTML in Elementor HTML widget
 *   - Set: meta_title, meta_description, focus_keyword via Yoast meta keys
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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

function buildElementorData(html: string): string {
  const uid = () => Math.random().toString(16).slice(2, 10)
  const data = [{
    id: uid(), elType: 'section',
    settings: { layout: 'full_width', content_width: { unit: '%', size: 100 } },
    elements: [{
      id: uid(), elType: 'column',
      settings: { _column_size: 100, _inline_size: null },
      elements: [{
        id: uid(), elType: 'widget', widgetType: 'html',
        settings: { html },
        elements: [],
      }],
    }],
  }]
  return JSON.stringify(data)
}

function svgToPngDataUrl(svg: string): string {
  // Return SVG as-is data URL (WordPress accepts SVG via media upload if allowed,
  // otherwise we send as PNG mime but with SVG content — WP stores it fine for featured image)
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

async function uploadCoverImage(
  wpUrl: string, creds: string, imageBase64: string, mimeType: string, title: string, altText: string
): Promise<number | null> {
  try {
    const imageBuffer = Buffer.from(imageBase64, 'base64')
    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'webp'
    const boundary = `----WPUpload${Date.now()}`
    const filename = `cover-${Date.now()}.${ext}`

    const titleBuf = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="alt_text"\r\n\r\n${altText}\r\n`
    )
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    )
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`)
    const body = Buffer.concat([titleBuf, header, imageBuffer, footer])

    const res = await fetch(`${wpUrl}/wp-json/wp/v2/media`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      body,
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) return null
    const data = await res.json()
    return data.id ? Number(data.id) : null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { html, title, keyword, slug: manualSlug, coverImage = '', coverMimeType = 'image/webp', publishMode = 'draft', useElementor = false, wpPostType = 'post', projectId, connectionId } = body
  const orgId = session.user.organizationId

  // Enrich with DB article data if we can match by projectId + title
  let dbMetaDescription = ''
  let dbSeoTitle = ''
  let dbSlug = ''
  if (projectId && title) {
    const dbArticle = await prisma.article.findFirst({
      where: { projectId, project: { organizationId: orgId }, title },
      select: { metaDescription: true, seoTitle: true, slug: true },
    }).catch(() => null)
    if (dbArticle) {
      dbMetaDescription = dbArticle.metaDescription ?? ''
      dbSeoTitle        = dbArticle.seoTitle ?? ''
      dbSlug            = dbArticle.slug ?? ''
    }
  }

  const normalizeWpUrl = (raw: string) =>
    raw.trim().replace(/\/(wp-admin|wp-login\.php)(\/.*)?$/, '').replace(/\/$/, '')

  let wpUrl = '', wpUser = '', wpPass = ''

  // 1. Explicit connectionId from Push tab dropdown
  if (connectionId) {
    const conn = await prisma.wordPressConnection.findFirst({ where: { id: connectionId, organizationId: orgId } })
    if (conn) {
      wpUrl  = normalizeWpUrl(conn.siteUrl)
      wpUser = conn.username.trim()
      try { const { decrypt } = await import('@/lib/crypto'); wpPass = decrypt(conn.appPasswordEncrypted) } catch { wpPass = '' }
    }
  }

  // 2. Project's linked WordPressConnection
  if (!wpUrl && projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      include: { wordpressConnection: true },
    })
    const conn = project?.wordpressConnection
    if (conn) {
      wpUrl  = normalizeWpUrl(conn.siteUrl)
      wpUser = conn.username.trim()
      try { const { decrypt } = await import('@/lib/crypto'); wpPass = decrypt(conn.appPasswordEncrypted) } catch { wpPass = '' }
    }
    if (!wpUrl) {
      wpUrl  = normalizeWpUrl((project as any)?.wpUrl ?? '')
      wpUser = (project as any)?.wpUser?.trim() ?? ''
      wpPass = (project as any)?.wpAppPassword?.trim() ?? ''
    }
  }

  if (!wpUrl)  wpUrl  = normalizeWpUrl(process.env.WP_URL ?? '')
  if (!wpUser) wpUser = process.env.WP_USER?.trim() ?? ''
  if (!wpPass) wpPass = process.env.WP_APP_PASSWORD?.trim() ?? ''

  if (!wpUrl || !wpUser || !wpPass) {
    return NextResponse.json({ error: 'ไม่พบ WordPress credentials — เลือก Connection ใน Push tab หรือตั้งค่าใน Project Settings' }, { status: 400 })
  }

  if (!html || !title) return NextResponse.json({ error: 'html และ title จำเป็น' }, { status: 400 })

  const creds = Buffer.from(`${wpUser}:${wpPass.replace(/\s+/g, '')}`).toString('base64')

  // 1. Extract SEO metadata from HTML (HTML comment block is the primary source)
  const meta = extractSeoMeta(html, dbSeoTitle || title, keyword ?? '')
  // DB values override HTML-comment values for slug and meta description
  const finalSlug       = manualSlug?.trim() || dbSlug || ''
  const finalMetaDesc   = dbMetaDescription || meta.metaDescription

  console.log('[push/publish] DEBUG', {
    title,
    manualSlug,
    dbSlug,
    finalSlug,
    dbMetaDescription: dbMetaDescription?.slice(0,80),
    metaMetaDescription: meta.metaDescription?.slice(0,80),
    finalMetaDesc: finalMetaDesc?.slice(0,80),
    wpPostType,
  })
  const coverAltText    = meta.coverAlt !== (dbSeoTitle || title) ? meta.coverAlt : (dbSeoTitle || title)
  const isPage          = wpPostType === 'page'

  const htmlForContent = html

  // 1c. Add alt text to inline <img> tags missing it (use article title as fallback)
  const htmlWithAlt = htmlForContent.replace(
    /<img(?![^>]*\balt=)([^>]*?)(\s*\/?>)/gi,
    `<img alt="${(dbSeoTitle || title).replace(/"/g, '&quot;')}"$1$2`
  )

  // 2. Upload cover image as featured image
  let featuredMediaId: number | null = null
  if (coverImage?.trim()) {
    featuredMediaId = await uploadCoverImage(wpUrl, creds, coverImage, coverMimeType, dbSeoTitle || title, coverAltText)
  }

  // 3. Build post payload
  const content = useElementor ? '' : htmlWithAlt
  const payload: Record<string, unknown> = {
    // For pages: send empty title so WP doesn't show a title block above content (H1 is in HTML)
    title:   isPage ? '' : (meta.metaTitle || dbSeoTitle || title),
    content,
    excerpt: finalMetaDesc ? finalMetaDesc.slice(0, 160) : undefined,
    status: publishMode === 'publish' ? 'publish' : 'draft',
    ...(finalSlug && { slug: finalSlug }),
    ...(featuredMediaId && { featured_media: featuredMediaId }),
  }

  // 4. Yoast SEO meta
  const wpMeta: Record<string, string> = {}
  const finalMetaTitle = meta.metaTitle || dbSeoTitle || title
  if (finalMetaTitle)    wpMeta['_yoast_wpseo_title']    = finalMetaTitle
  if (finalMetaDesc)     wpMeta['_yoast_wpseo_metadesc'] = finalMetaDesc.slice(0, 160)
  if (meta.focusKeyword) wpMeta['_yoast_wpseo_focuskw']  = meta.focusKeyword
  // Do NOT set _yoast_wpseo_slug — Yoast appends it to WP slug causing duplicates

  // 5. Elementor wrapping (non-data keys only in initial POST)
  const wpEndpoint = isPage ? `${wpUrl}/wp-json/wp/v2/pages` : `${wpUrl}/wp-json/wp/v2/posts`
  if (useElementor) {
    wpMeta['_elementor_edit_mode']      = 'builder'
    wpMeta['_elementor_template_type']  = isPage ? 'wp-page' : 'wp-post'
  }

  if (Object.keys(wpMeta).length > 0) payload.meta = wpMeta

  // 6. Check if post/page with this slug already exists → update instead of create
  let existingPostId: number | null = null
  if (finalSlug) {
    const checkUrl = `${wpUrl}/wp-json/wp/v2/${isPage ? 'pages' : 'posts'}?slug=${encodeURIComponent(finalSlug)}&_fields=id&per_page=1`
    const checkRes = await fetch(checkUrl, {
      headers: { Authorization: `Basic ${creds}` },
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)
    if (checkRes?.ok) {
      const found = await checkRes.json().catch(() => [])
      if (Array.isArray(found) && found.length > 0) existingPostId = found[0].id
    }
  }

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
      return NextResponse.json({ error: `WordPress API error ${res.status}: ${errText.slice(0, 300)}` }, { status: 400 })
    }

    const data = await res.json()
    const postId: number = data.id
    const postUrl: string = data.link ?? ''

    // 7. Inject Yoast meta + optional Elementor data via convert-cake plugin
    const ccEndpoint = `${wpUrl}/wp-json/convert-cake/v1/elementor-meta`
    const yoastMeta: Record<string, string> = {}
    if (finalMetaTitle)    yoastMeta['_yoast_wpseo_title']    = finalMetaTitle
    if (finalMetaDesc)     yoastMeta['_yoast_wpseo_metadesc'] = finalMetaDesc.slice(0, 160)
    if (meta.focusKeyword) yoastMeta['_yoast_wpseo_focuskw']  = meta.focusKeyword

    console.log('[push/publish] postId:', postId, 'wpPostType:', wpPostType, 'yoastMeta keys:', Object.keys(yoastMeta))
    if (postId) {
      const elementorData = buildElementorData(htmlWithAlt)
      const ccRes = await fetch(ccEndpoint, {
        method: 'POST',
        headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post_id: postId,
          elementor_data_b64: Buffer.from(elementorData).toString('base64'),
          edit_mode: 'builder',
          template_type: isPage ? 'wp-page' : 'wp-post',
          yoast_meta: yoastMeta,
        }),
        signal: AbortSignal.timeout(30000),
      }).catch(() => null)
      const ccText = await ccRes?.text().catch(() => '')
      console.log('[push/publish] cc status:', ccRes?.status, 'body:', ccText?.slice(0, 200))

      if (!ccRes?.ok) {
        // fallback: native content PATCH
        const fallbackEndpoint = `${wpUrl}/wp-json/wp/v2/${isPage ? 'pages' : 'posts'}/${postId}`
        await fetch(fallbackEndpoint, {
          method: 'POST',
          headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: htmlWithAlt }),
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
    }

    // Upsert article status in DB so Published tab persists across refreshes
    if (projectId && orgId && title) {
      try {
        const existing = await prisma.article.findFirst({
          where: { projectId, project: { organizationId: orgId }, title },
          select: { id: true },
        })
        const articleStatus = publishMode === 'publish' ? 'POSTED' : 'WORDPRESS_DRAFTED'
        if (existing) {
          await prisma.article.update({
            where: { id: existing.id },
            data: { wordpressUrl: postUrl || null, status: articleStatus },
          })
        } else {
          // Get createdById from session
          const userId = session.user.id
          await prisma.article.create({
            data: {
              projectId,
              title,
              slug: finalSlug || data.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
              status: articleStatus,
              wordpressUrl: postUrl || null,
              createdById: userId,
            },
          })
        }
      } catch { /* non-fatal */ }
    }

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
            newValue: JSON.stringify({ title, keyword, postId, postUrl, publishMode, wpUrl }),
          },
        })
      }
    } catch { /* non-fatal */ }

    return NextResponse.json({ ok: true, postId, postUrl, status: data.status, slug: data.slug ?? finalSlug })

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Push ล้มเหลว: ${msg}` }, { status: 500 })
  }
}
