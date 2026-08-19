/**
 * Schema JSON-LD generator — สร้าง @graph จากข้อมูลจริงของบทความแบบ deterministic
 * (ไม่ให้ AI เขียน schema เอง — กัน URL/ข้อมูลมั่ว และ FAQPage ตรงกับ FAQ ในบทความ
 * 100% เพราะ parse จาก .mars-faq__item ใน HTML ที่ generate แล้วโดยตรง)
 *
 * โครง output ของบทความ: <script ld+json> → <style> → <div class="mars-article">
 */

export interface ArticleSchemaOptions {
  /** HTML สุดท้ายของบทความ (ใช้ parse FAQ) */
  html: string
  title: string
  metaDescription?: string
  slug?: string
  /** เว็บของ client เช่น https://example.com */
  siteUrl?: string
  siteName?: string
  authorName?: string
  authorTitle?: string
  contact?: { phones?: string[]; email?: string }
  /** ประเภทธุรกิจ/บริการของ client — มีเมื่อไรจะได้ Service node เพิ่ม */
  serviceName?: string
  serviceDescription?: string
  /** YYYY-MM-DD — default วันนี้ (เวลาไทย) */
  datePublished?: string
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** ดึงคู่คำถาม-คำตอบจาก FAQ มาตรฐาน mars-faq__item */
export function parseFaqFromHtml(html: string): Array<{ q: string; a: string }> {
  const out: Array<{ q: string; a: string }> = []
  const re = /<details[^>]*class="[^"]*mars-faq__item[^"]*"[^>]*>([\s\S]*?)<\/details>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const block = m[1]
    const q = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ?? ''
    const a = block.match(/<div[^>]*class="[^"]*mars-faq__answer[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1]
      ?? block.replace(/<summary[\s\S]*?<\/summary>/i, '')
    const question = stripTags(q)
    const answer = stripTags(a)
    if (question && answer) out.push({ q: question, a: answer })
  }
  return out
}

/** ตัด ld+json เดิมออก (ของ AI หรือของรอบก่อน) — schema ต้องมาจาก generator เท่านั้น */
export function stripSchemaScripts(html: string): string {
  return html.replace(/<script\s+type="application\/ld\+json"[\s\S]*?<\/script>\s*/gi, '')
}

export function buildArticleSchema(opts: ArticleSchemaOptions): string {
  const siteUrl = (opts.siteUrl ?? '').trim().replace(/\/$/, '')
  const articleUrl = siteUrl && opts.slug ? `${siteUrl}/${opts.slug.replace(/^\//, '')}` : siteUrl || undefined
  const today = opts.datePublished
    ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
  const orgId = siteUrl ? `${siteUrl}/#organization` : undefined
  const faqs = parseFaqFromHtml(opts.html)
  const phones = (opts.contact?.phones ?? []).filter(Boolean)

  const graph: Array<Record<string, unknown>> = []

  // Article
  graph.push({
    '@type': 'Article',
    ...(articleUrl ? { '@id': `${articleUrl}#article` } : {}),
    headline: opts.title,
    ...(opts.metaDescription ? { description: opts.metaDescription } : {}),
    ...(articleUrl ? { url: articleUrl, mainEntityOfPage: { '@type': 'WebPage', '@id': articleUrl } } : {}),
    datePublished: today,
    dateModified: today,
    inLanguage: 'th-TH',
    ...(opts.authorName
      ? {
          author: {
            '@type': 'Person',
            name: opts.authorName,
            ...(opts.authorTitle ? { jobTitle: opts.authorTitle } : {}),
          },
        }
      : opts.siteName
        ? { author: { '@type': 'Organization', name: opts.siteName } }
        : {}),
    ...(orgId ? { publisher: { '@id': orgId } } : opts.siteName ? { publisher: { '@type': 'Organization', name: opts.siteName } } : {}),
  })

  // BreadcrumbList — หน้าแรกเว็บ → บทความ
  if (siteUrl && articleUrl && articleUrl !== siteUrl) {
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': `${articleUrl}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: opts.siteName || siteUrl, item: `${siteUrl}/` },
        { '@type': 'ListItem', position: 2, name: opts.title, item: articleUrl },
      ],
    })
  }

  // FAQPage — เฉพาะเมื่อบทความมี FAQ จริง
  if (faqs.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      ...(articleUrl ? { '@id': `${articleUrl}#faq` } : {}),
      mainEntity: faqs.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    })
  }

  // Service — บริการของ client (จาก businessType ของโปรเจกต์)
  if (opts.serviceName && (opts.siteName || siteUrl)) {
    graph.push({
      '@type': 'Service',
      ...(articleUrl ? { '@id': `${articleUrl}#service` } : {}),
      name: opts.serviceName,
      ...(opts.serviceDescription ? { description: opts.serviceDescription } : {}),
      ...(orgId ? { provider: { '@id': orgId } } : { provider: { '@type': 'Organization', name: opts.siteName } }),
      areaServed: { '@type': 'Country', name: 'Thailand' },
      ...(siteUrl ? { url: siteUrl } : {}),
    })
  }

  // LocalBusiness / Organization ของ client — เมื่อมีข้อมูลพอ
  if (opts.siteName || siteUrl) {
    graph.push({
      '@type': phones.length > 0 ? 'LocalBusiness' : 'Organization',
      ...(orgId ? { '@id': orgId } : {}),
      ...(opts.siteName ? { name: opts.siteName } : {}),
      ...(siteUrl ? { url: siteUrl } : {}),
      ...(phones.length > 0 ? { telephone: phones.length === 1 ? phones[0] : phones } : {}),
      ...(opts.contact?.email ? { email: opts.contact.email } : {}),
      address: { '@type': 'PostalAddress', addressCountry: 'TH' },
    })
  }

  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2)
  return `<script type="application/ld+json">\n${json}\n</script>`
}
