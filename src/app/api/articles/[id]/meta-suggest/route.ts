import { NextRequest, NextResponse } from 'next/server'
import { parse } from 'node-html-parser'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { clientCanAccessProject } from '@/lib/client-access'
import { askJson } from '@/lib/competitor-gap/ai'
import { withOrClient, clientSlugForProject } from '@/lib/orClient'
import { OR_MODELS } from '@/lib/openrouter'
import { logAIJob } from '@/lib/logAIJob'
import { humanBodyRulesBlock } from '@/lib/upload-article/human-voice'
import { resolveArticleLanguage } from '@/lib/keyword-language'
import { cleanGeneratedFields, cleanSlug, tallyWarning } from '@/lib/ce-restrictions'
import { loadTitleRestrictions } from '@/lib/ce-restrictions-server'

function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** ตัด <script>/<style>/comment ทิ้งก่อนดึงข้อความล้วน — กัน JSON-LD schema และ CSS หลุดปนเข้าไปในข้อความให้ AI อ่าน */
function stripNonTextMarkup(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
}

interface MetaAiResult {
  metaTitle?: string
  metaDescription?: string
  slug?: string
}

/**
 * POST /api/articles/[id]/meta-suggest — ให้ Mars "เสนอ" meta title / description / slug ของบทความ SME
 * เสนออย่างเดียว ไม่เขียนอะไรลงตาราง Article (เขียนได้แค่ log AIJob) — ผู้ใช้กด "บันทึก SEO" เองเพื่อเขียน 4 ที่ตามเดิม
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // ลูกค้า (CLIENT) ใช้ไม่ได้ — เครื่องมือทีมงาน
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const article = await prisma.article.findFirst({
    where: { id: params.id, project: { organizationId: orgId } },
    select: {
      id: true, projectId: true, title: true, slug: true, htmlContent: true, seoTitle: true,
      metaDescription: true, status: true, wordpressUrl: true,
      project: { select: { language: true } },
    },
  })
  if (!article) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })
  if (!(await clientCanAccessProject(session, article.projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!article.htmlContent) return NextResponse.json({ error: 'ยังไม่มีเนื้อหาบทความ' }, { status: 400 })

  // ข้อจำกัดคำต้องห้ามของ CE scope เดียวกับตอนเขียนบทความ (ไม่ fallback ไป scope อื่น)
  const tr = await loadTitleRestrictions(orgId, { projectId: article.projectId })

  // บทความที่ push/เผยแพร่ขึ้นเว็บแล้ว ห้ามเปลี่ยน slug — URL จริงจะเปลี่ยนตามไปด้วย
  const alreadyPushed = Boolean(article.wordpressUrl) || ['WORDPRESS_DRAFTED', 'POSTED', 'PUBLISHED', 'PUSHED'].includes(article.status)
  const currentSlug = article.slug ?? ''

  const cleanMeta = (f: { seoTitle: string; metaDescription: string; slug: string }) => {
    const tally = new Map<string, number>()
    const c = cleanGeneratedFields(tr, { title: f.seoTitle, metaDescription: f.metaDescription, slug: alreadyPushed ? undefined : f.slug }, tally)
    if (alreadyPushed && f.slug && tr.terms.length) {
      for (const h of cleanSlug(f.slug, tr.terms).remaining) tally.set(h.term, (tally.get(h.term) ?? 0) + h.count)
    }
    return {
      seoTitle: c.title ?? f.seoTitle,
      metaDescription: c.metaDescription ?? f.metaDescription,
      slug: alreadyPushed ? f.slug : (c.slug ?? f.slug),
      warning: tallyWarning('meta', tally) ?? undefined,
    }
  }

  const html = article.htmlContent
  const root = parse(html)
  const h1 = root.querySelector('h1')?.text.trim() || article.title
  const h2List = root.querySelectorAll('h2').map((h) => h.text.trim()).filter(Boolean)
  const bodyText = parse(stripNonTextMarkup(html)).text.replace(/\s+/g, ' ').trim().slice(0, 1500)
  const language = resolveArticleLanguage({ projectLanguage: article.project.language, title: h1, keyword: h1 })
  const fallbackTitle = h1.slice(0, 60)

  const system = `คุณคือนักเขียน SEO เมตาแท็กมืออาชีพ ตอบเป็น JSON เท่านั้น ไม่มีคำอธิบายอื่น
รูปแบบ: {"metaTitle": string, "metaDescription": string, "slug": string}
กติกา:
- metaTitle: ใช้ H1 ตามเดิม ถ้า H1 ยาวเกิน 60 ตัวอักษรให้ย่อโดยคงคำเดิมของ H1 ให้มากที่สุด ความยาวไม่เกิน 60 ตัวอักษร ใส่คีย์เวิร์ดหลักไว้ต้นประโยค ห้ามเขียนแบบ clickbait ห้ามต่อท้ายชื่อแบรนด์เว้นแต่จะพอดี
- metaDescription: ความยาว 120-155 ตัวอักษร สรุปสิ่งที่ผู้อ่านจะได้รับ ใช้ภาษาเดียวกับบทความ ห้ามเสกข้อมูล/ตัวเลขที่ไม่มีในบทความ เขียนให้เหมือนคนเขียน ไม่ใช่ AI:
${humanBodyRulesBlock(language)}
- slug: คำภาษาอังกฤษล้วนจากความหมายของ H1 ตัวพิมพ์เล็ก คั่นด้วย - ความยาวไม่เกิน 60 ตัวอักษร ใช้ได้เฉพาะ a-z0-9-
ภาษาของบทความ: ${language === 'en' ? 'English' : 'ไทย'}${tr.block ? `\n\n${tr.block}` : ''}`

  const user = `H1: ${h1}\nหัวข้อย่อย (H2): ${h2List.join(' | ') || '(ไม่มี)'}\n\nเนื้อหาบางส่วน:\n${bodyText}`

  const orSlug = await clientSlugForProject(article.projectId)
  const result = await withOrClient(orSlug, () =>
    askJson<MetaAiResult>({
      trace: 'sme_article_meta',
      system,
      user,
      temperature: 0.4,
      maxTokens: 2000,
    }),
  )

  logAIJob({
    organizationId: orgId,
    projectId: article.projectId,
    articleId: article.id,
    // ห้ามใช้ UPLOAD_* — ป้ายใน AI Jobs จะขึ้นว่า Upload Article ทั้งที่เป็นงานของ SEO SME
    jobType: 'SME_ARTICLE_META',
    modelProvider: 'OPENROUTER',
    modelName: OR_MODELS.default(),
    status: result.error ? 'FAILED' : 'SUCCESS',
    tokenUsed: result.usage.totalTokens,
    estimatedCost: result.usage.costUsd,
    errorMessage: result.error ?? undefined,
    createdById: session.user.id,
    inputSummary: 'sme-article-meta-suggest',
  }).catch(() => {})

  if (result.error || !result.data) {
    // AI ล้มเหลว — ไม่เขียนอะไร ตอบค่าปัจจุบัน (title เติมจาก H1 เมื่อยังว่าง) พร้อม warning
    const seoTitle = article.seoTitle || cleanMeta({ seoTitle: fallbackTitle, metaDescription: '', slug: '' }).seoTitle
    return NextResponse.json({
      seoTitle,
      metaDescription: article.metaDescription || '',
      slug: currentSlug,
      costUsd: result.usage.costUsd,
      warning: result.error || 'Mars ไม่ตอบกลับ',
    })
  }

  const cleaned = cleanMeta({
    seoTitle: (h1.length <= 60 ? h1 : result.data.metaTitle || fallbackTitle).trim().slice(0, 60),
    metaDescription: (result.data.metaDescription || '').trim().slice(0, 155),
    slug: alreadyPushed ? currentSlug : sanitizeSlug(result.data.slug || ''),
  })

  return NextResponse.json({
    seoTitle: cleaned.seoTitle,
    metaDescription: cleaned.metaDescription,
    slug: cleaned.slug,
    costUsd: result.usage.costUsd,
    ...(cleaned.warning ? { warning: cleaned.warning } : {}),
  })
}
