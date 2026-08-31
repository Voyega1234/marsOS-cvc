/**
 * Competitor Gap — วิเคราะห์โครงสร้างบทความเทียบคู่แข่ง
 *
 * ตอบคำถามเดียว: "คู่แข่งเขาวางโครงบทความยังไง แล้วของเราขาดอะไร"
 * แยกข้อค้นพบเป็น 4 เสา
 *   SEO     — โครงหัวข้อ/ความลึก/รูปแบบที่ทำให้ติดอันดับ
 *   AEO     — รูปแบบที่เครื่องมือตอบคำถามหยิบไปตอบได้ทันที (หัวข้อคำถาม, FAQ schema, ย่อหน้านำที่ตอบตรง)
 *   GEO     — รูปแบบที่โมเดลกำเนิดข้อความหยิบไปอ้าง (บล็อกสรุป, ตาราง/ลิสต์, ตัวเลข, การอ้างแหล่ง)
 *   E-E-A-T — ผู้เขียนมีตัวตน, วันที่, การอ้างอิง, ประสบการณ์จริง
 *
 * ทุกตัวเลขมาจากหน้าที่สแกนได้จริงเท่านั้น — ไม่มีข้อมูลคืน null และตารางจะแสดง "—"
 */

import type {
  ArticleStructureReport, DomainState, PageRecord, StructureFinding, StructureProfile, StructurePillar,
} from './types'

/** ประเภทหน้าที่นับเป็น "บทความ/เนื้อหา" — หน้าบริการ/สินค้าไม่เอามาปนเพราะโครงคนละแบบ */
const CONTENT_PAGE_TYPES = new Set(['article', 'guide', 'case-study', 'glossary'])

const MIN_PAGES_FOR_PROFILE = 3

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10
}

function pct(hits: number, total: number): number | null {
  if (total === 0) return null
  return Math.round((hits / total) * 100)
}

function hasSchema(p: PageRecord, names: string[]): boolean {
  return p.schemaTypes.some(t => names.includes(t))
}

function contentPagesOf(d: DomainState): PageRecord[] {
  return d.pages.filter(p => p.indexable && CONTENT_PAGE_TYPES.has(p.pageType))
}

export function buildStructureProfile(d: DomainState): StructureProfile {
  const pages = contentPagesOf(d)
  const n = pages.length
  const num = (pick: (p: PageRecord) => number | null | undefined): number[] =>
    pages.map(pick).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const countIf = (pred: (p: PageRecord) => boolean): number => pages.filter(pred).length

  const withImages = pages.filter(p => (p.images ?? 0) > 0)
  const imageAltPct = withImages.length === 0 ? null : pct(
    withImages.filter(p => (p.imagesWithAlt ?? 0) >= (p.images ?? 0)).length,
    withImages.length,
  )

  return {
    domain: d.domain,
    isOurs: d.isOurs,
    contentPages: n,
    medianWordCount: median(num(p => p.wordCount)),
    medianH2: median(num(p => p.h2.length)),
    medianH3: median(num(p => p.h3?.length)),
    medianLeadWords: median(num(p => p.leadWordCount)),
    medianCitations: median(num(p => p.citationLinks)),
    questionHeadingPct: pct(countIf(p => (p.questionHeadings ?? 0) > 0), n),
    faqSchemaPct: pct(countIf(p => hasSchema(p, ['FAQPage', 'QAPage'])), n),
    howToSchemaPct: pct(countIf(p => hasSchema(p, ['HowTo'])), n),
    articleSchemaPct: pct(countIf(p => hasSchema(p, ['Article', 'BlogPosting', 'NewsArticle', 'TechArticle'])), n),
    authorNamedPct: pct(countIf(p => !!p.authorName), n),
    datedPct: pct(countIf(p => !!p.publishedDate || !!p.modifiedDate), n),
    summaryBlockPct: pct(countIf(p => p.hasSummaryBlock === true), n),
    answersInLeadPct: pct(countIf(p => p.answersInLead === true), n),
    listPct: pct(countIf(p => p.hasList), n),
    tablePct: pct(countIf(p => p.hasTable), n),
    imageAltPct,
  }
}

/** median ของคู่แข่งรายค่า — คิดจากเว็บที่มีหน้าเนื้อหาพอให้เชื่อถือได้เท่านั้น */
function medianProfile(profiles: StructureProfile[]): StructureProfile | null {
  const usable = profiles.filter(p => p.contentPages >= MIN_PAGES_FOR_PROFILE)
  if (usable.length === 0) return null
  const pick = (f: (p: StructureProfile) => number | null): number | null =>
    median(usable.map(f).filter((v): v is number => v !== null))

  return {
    domain: `median ของคู่แข่ง ${usable.length} เว็บ`,
    isOurs: false,
    contentPages: Math.round(usable.reduce((sum, p) => sum + p.contentPages, 0) / usable.length),
    medianWordCount: pick(p => p.medianWordCount),
    medianH2: pick(p => p.medianH2),
    medianH3: pick(p => p.medianH3),
    medianLeadWords: pick(p => p.medianLeadWords),
    medianCitations: pick(p => p.medianCitations),
    questionHeadingPct: pick(p => p.questionHeadingPct),
    faqSchemaPct: pick(p => p.faqSchemaPct),
    howToSchemaPct: pick(p => p.howToSchemaPct),
    articleSchemaPct: pick(p => p.articleSchemaPct),
    authorNamedPct: pick(p => p.authorNamedPct),
    datedPct: pick(p => p.datedPct),
    summaryBlockPct: pick(p => p.summaryBlockPct),
    answersInLeadPct: pick(p => p.answersInLeadPct),
    listPct: pick(p => p.listPct),
    tablePct: pick(p => p.tablePct),
    imageAltPct: pick(p => p.imageAltPct),
  }
}

interface FindingDef {
  pillar: StructurePillar
  label: string
  unit: StructureFinding['unit']
  pick: (p: StructureProfile) => number | null
  /** ต่ำกว่ามาตรฐานเท่าไหร่ถึงเรียกว่าขาด (หน่วยเดียวกับค่า) */
  tolerance: number
  competitorLine: (median: number) => string
  fix: (median: number, ours: number | null) => string
}

const FINDINGS: FindingDef[] = [
  {
    pillar: 'SEO',
    label: 'ความยาวบทความ (median)',
    unit: 'คำ',
    pick: p => p.medianWordCount,
    tolerance: 150,
    competitorLine: m => `บทความคู่แข่งยาว median ${m.toLocaleString()} คำ`,
    fix: (m, o) => o === null
      ? `ตั้งเป้าความยาวบทความใหม่ที่ ${m.toLocaleString()} คำขึ้นไป`
      : `เพิ่มความลึกอีกราว ${Math.max(0, Math.round(m - o)).toLocaleString()} คำต่อบทความ โดยเพิ่มหัวข้อย่อยที่ยังไม่ได้ตอบ ไม่ใช่ยืดความ`,
  },
  {
    pillar: 'SEO',
    label: 'จำนวนหัวข้อ H2 ต่อบทความ (median)',
    unit: 'หัวข้อ',
    pick: p => p.medianH2,
    tolerance: 1,
    competitorLine: m => `คู่แข่งแบ่งบทความเป็น median ${m} หัวข้อหลัก`,
    fix: (m, o) => `แตกโครงเป็นอย่างน้อย ${Math.ceil(m)} หัวข้อหลัก (ตอนนี้ ${o === null ? 'ไม่มีข้อมูล' : o}) แต่ละหัวข้อตอบหนึ่งคำถามของผู้อ่าน`,
  },
  {
    pillar: 'SEO',
    label: 'หัวข้อย่อย H3 ต่อบทความ (median)',
    unit: 'หัวข้อ',
    pick: p => p.medianH3,
    tolerance: 1,
    competitorLine: m => `คู่แข่งซอยหัวข้อย่อย median ${m} หัวข้อ ทำให้กวาดคีย์เวิร์ดหางยาวได้มากกว่า`,
    fix: (m, o) => `เพิ่ม H3 ใต้หัวข้อหลักให้ได้ราว ${Math.ceil(m)} หัวข้อ (ตอนนี้ ${o === null ? 'ไม่มีข้อมูล' : o}) แต่ละ H3 = หนึ่งคำถามย่อย`,
  },
  {
    pillar: 'AEO',
    label: 'บทความที่มีหัวข้อเป็นคำถาม',
    unit: '%',
    pick: p => p.questionHeadingPct,
    tolerance: 10,
    competitorLine: m => `${m}% ของบทความคู่แข่งตั้งหัวข้อเป็นคำถาม`,
    fix: (m, o) => `เขียนหัวข้อเป็นคำถามที่คนค้นจริง ("… คืออะไร", "… ราคาเท่าไหร่") ให้ครอบคลุมอย่างน้อย ${m}% ของบทความ (ตอนนี้ ${o === null ? 'ไม่มีข้อมูล' : `${o}%`})`,
  },
  {
    pillar: 'AEO',
    label: 'ย่อหน้านำที่ตอบคำถามทันที',
    unit: '%',
    pick: p => p.answersInLeadPct,
    tolerance: 10,
    competitorLine: m => `${m}% ของบทความคู่แข่งตอบคำถามหลักตั้งแต่ย่อหน้าแรก`,
    fix: (m, o) => `ขึ้นต้นบทความด้วยคำตอบตรง ๆ 2–3 ประโยค แล้วค่อยขยาย ให้ครบอย่างน้อย ${m}% ของบทความ (ตอนนี้ ${o === null ? 'ไม่มีข้อมูล' : `${o}%`})`,
  },
  {
    pillar: 'AEO',
    label: 'บทความที่ติด FAQ / QA schema',
    unit: '%',
    pick: p => p.faqSchemaPct,
    tolerance: 10,
    competitorLine: m => `${m}% ของบทความคู่แข่งติด FAQPage/QAPage schema`,
    fix: (m, o) => `ใส่ FAQ schema ในบทความที่มีคำถามท้ายเรื่อง เป้าหมาย ${m}% ของบทความ (ตอนนี้ ${o === null ? 'ไม่มีข้อมูล' : `${o}%`})`,
  },
  {
    pillar: 'GEO',
    label: 'บทความที่มีบล็อกสรุป / TL;DR',
    unit: '%',
    pick: p => p.summaryBlockPct,
    tolerance: 10,
    competitorLine: m => `${m}% ของบทความคู่แข่งมีหัวข้อสรุปให้หยิบไปตอบได้ทั้งก้อน`,
    fix: (m, o) => `เพิ่มหัวข้อ "สรุป" ที่กินใจความทั้งบทความใน 3–5 บรรทัด ให้ครบ ${m}% ของบทความ (ตอนนี้ ${o === null ? 'ไม่มีข้อมูล' : `${o}%`})`,
  },
  {
    pillar: 'GEO',
    label: 'บทความที่มีตาราง',
    unit: '%',
    pick: p => p.tablePct,
    tolerance: 10,
    competitorLine: m => `${m}% ของบทความคู่แข่งมีตารางเปรียบเทียบ/ราคา ซึ่งโมเดลหยิบไปอ้างง่ายที่สุด`,
    fix: (m, o) => `เพิ่มตารางเปรียบเทียบหรือราคาในบทความที่เหมาะ เป้าหมาย ${m}% (ตอนนี้ ${o === null ? 'ไม่มีข้อมูล' : `${o}%`})`,
  },
  {
    pillar: 'GEO',
    label: 'บทความที่มีลิสต์เป็นขั้นตอน',
    unit: '%',
    pick: p => p.listPct,
    tolerance: 10,
    competitorLine: m => `${m}% ของบทความคู่แข่งจัดเนื้อหาเป็นลิสต์/ขั้นตอน`,
    fix: (m, o) => `แปลงเนื้อหาที่เป็นลำดับให้เป็นลิสต์แบบมีข้อ เป้าหมาย ${m}% (ตอนนี้ ${o === null ? 'ไม่มีข้อมูล' : `${o}%`})`,
  },
  {
    pillar: 'E-E-A-T',
    label: 'บทความที่ระบุชื่อผู้เขียน',
    unit: '%',
    pick: p => p.authorNamedPct,
    tolerance: 10,
    competitorLine: m => `${m}% ของบทความคู่แข่งระบุชื่อผู้เขียนชัดเจน`,
    fix: (m, o) => `ใส่ชื่อผู้เขียนจริงพร้อมประวัติสั้น และผูก author schema ให้ครบ ${m}% ของบทความ (ตอนนี้ ${o === null ? 'ไม่มีข้อมูล' : `${o}%`})`,
  },
  {
    pillar: 'E-E-A-T',
    label: 'บทความที่มีวันที่เผยแพร่/อัปเดต',
    unit: '%',
    pick: p => p.datedPct,
    tolerance: 10,
    competitorLine: m => `${m}% ของบทความคู่แข่งแสดงวันที่เผยแพร่หรืออัปเดต`,
    fix: (m, o) => `แสดงวันที่เผยแพร่และวันที่อัปเดตล่าสุดในหน้าและใน schema ให้ครบ ${m}% (ตอนนี้ ${o === null ? 'ไม่มีข้อมูล' : `${o}%`})`,
  },
  {
    pillar: 'E-E-A-T',
    label: 'ลิงก์อ้างอิงแหล่งข้อมูลภายนอก (median ต่อบทความ)',
    unit: 'ลิงก์',
    pick: p => p.medianCitations,
    tolerance: 1,
    competitorLine: m => `บทความคู่แข่งอ้างแหล่งข้อมูลภายนอก median ${m} แหล่งต่อบทความ`,
    fix: (m, o) => `อ้างแหล่งข้อมูลที่ตรวจสอบได้อย่างน้อย ${Math.ceil(m)} แหล่งต่อบทความ (ตอนนี้ ${o === null ? 'ไม่มีข้อมูล' : o}) เช่น งานวิจัย ข้อมูลราชการ เอกสารผู้ผลิต`,
  },
  {
    pillar: 'SEO',
    label: 'บทความที่ติด Article schema',
    unit: '%',
    pick: p => p.articleSchemaPct,
    tolerance: 10,
    competitorLine: m => `${m}% ของบทความคู่แข่งติด Article/BlogPosting schema`,
    fix: (m, o) => `ติด Article schema พร้อม author และ datePublished/dateModified ให้ครบ ${m}% (ตอนนี้ ${o === null ? 'ไม่มีข้อมูล' : `${o}%`})`,
  },
]

function buildFindings(ours: StructureProfile | null, med: StructureProfile | null): StructureFinding[] {
  if (!med) return []
  const out: StructureFinding[] = []
  for (const def of FINDINGS) {
    const m = def.pick(med)
    if (m === null) continue
    // ตลาดไม่ทำเลย = ไม่มีมาตรฐานให้ไล่ตาม ไม่ต้องขึ้นเป็นข้อค้นพบ
    if (m <= 0) continue
    const o = ours ? def.pick(ours) : null
    const status: StructureFinding['status'] =
      o === null ? 'ไม่มีข้อมูล'
      : o + def.tolerance < m ? 'ต่ำกว่ามาตรฐาน'
      : 'ตามมาตรฐาน'
    out.push({
      pillar: def.pillar,
      label: def.label,
      ours: o,
      median: m,
      lowerIsBetter: false,
      unit: def.unit,
      status,
      whatCompetitorsDo: def.competitorLine(m),
      fix: def.fix(m, o),
    })
  }
  // เรียงให้ช่องว่างที่ห่างมาตรฐานมากที่สุดอยู่บน
  return out.sort((a, b) => {
    const rank = (f: StructureFinding) => f.status === 'ต่ำกว่ามาตรฐาน' ? 0 : f.status === 'ไม่มีข้อมูล' ? 1 : 2
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    const gap = (f: StructureFinding) => f.ours === null || f.median === null ? 0 : (f.median - f.ours) / Math.max(1, f.median)
    return gap(b) - gap(a)
  })
}

/** หน้าเนื้อหาของคู่แข่งที่โครงสร้างครบที่สุด — ให้ผู้ใช้เปิดดูของจริงได้ */
function pickExemplars(competitors: DomainState[]): ArticleStructureReport['exemplars'] {
  const scored: { domain: string; url: string; title: string; why: string; score: number }[] = []
  for (const d of competitors) {
    for (const p of contentPagesOf(d)) {
      const marks: string[] = []
      let score = 0
      if ((p.questionHeadings ?? 0) > 0) { score += 2; marks.push(`หัวข้อคำถาม ${p.questionHeadings} จุด`) }
      if (hasSchema(p, ['FAQPage', 'QAPage'])) { score += 2; marks.push('FAQ schema') }
      if (p.hasSummaryBlock) { score += 2; marks.push('มีบล็อกสรุป') }
      if (p.hasTable) { score += 1; marks.push('มีตาราง') }
      if (p.hasList) { score += 1; marks.push('มีลิสต์') }
      if (p.authorName) { score += 2; marks.push(`ระบุผู้เขียน (${p.authorName})`) }
      if ((p.citationLinks ?? 0) > 0) { score += 1; marks.push(`อ้างแหล่งนอก ${p.citationLinks} แห่ง`) }
      if (p.modifiedDate || p.publishedDate) { score += 1; marks.push('มีวันที่') }
      if (score < 5) continue
      scored.push({ domain: d.domain, url: p.url, title: p.title || p.path, why: marks.join(' · '), score })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  const out: ArticleStructureReport['exemplars'] = []
  const perDomain = new Map<string, number>()
  for (const s of scored) {
    const used = perDomain.get(s.domain) ?? 0
    if (used >= 2) continue                       // ไม่ให้เว็บเดียวยึดตัวอย่างทั้งหมด
    perDomain.set(s.domain, used + 1)
    out.push({ domain: s.domain, url: s.url, title: s.title, why: s.why })
    if (out.length >= 6) break
  }
  return out
}

export function buildArticleStructure(domains: DomainState[]): ArticleStructureReport {
  const ourState = domains.find(d => d.isOurs) ?? null
  // ใช้เฉพาะคู่แข่งที่เทียบเคียงได้ เหมือนกับ baseline ส่วนอื่นของรายงาน
  const competitorStates = domains.filter(d => !d.isOurs && d.comparable)

  const ours = ourState ? buildStructureProfile(ourState) : null
  const competitors = competitorStates.map(buildStructureProfile)
  const med = medianProfile(competitors)

  const empty: ArticleStructureReport = {
    available: false,
    note: null,
    ours,
    competitors,
    median: med,
    findings: [],
    exemplars: [],
    summary: null,
    aiNotes: [],
  }

  if (!med) {
    return { ...empty, note: `คู่แข่งที่สแกนได้ยังมีหน้าเนื้อหาไม่ถึง ${MIN_PAGES_FOR_PROFILE} หน้าต่อเว็บ — ยังเทียบโครงสร้างบทความไม่ได้` }
  }

  const findings = buildFindings(ours, med)
  const note = ours && ours.contentPages === 0
    ? 'เว็บเรายังไม่มีหน้าบทความที่สแกนเจอ — ตารางนี้จึงเป็นมาตรฐานของตลาดล้วน ๆ ให้ใช้เป็นแบบตอนสร้างบทความแรก'
    : null

  return {
    available: true,
    note,
    ours,
    competitors,
    median: med,
    findings,
    exemplars: pickExemplars(competitorStates),
    summary: null,
    aiNotes: [],
  }
}
