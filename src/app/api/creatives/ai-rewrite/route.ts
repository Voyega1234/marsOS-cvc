import { NextRequest, NextResponse } from 'next/server'
import { safeCallAI } from '@/lib/ai/provider'
import { EXECUTIVE_GROWTH_SKILL, AD_COPY_CONTEXT } from '@/lib/ai/prompts'
import { AdCopy, RsaAdCopy, PMaxAssetGroup, DisplayAdCopy } from '@/types'

interface RewriteBody {
  campaignType: string
  campaignName: string
  currentCopy: AdCopy
  businessContext: {
    businessName: string
    productService: string
    objective: string
    brandTone?: string
  }
  instruction?: string
}

// ─── Mock fallback ─────────────────────────────────────────────────────────────

function mockRewrite(body: RewriteBody): AdCopy {
  const { currentCopy, campaignType } = body
  const copy = structuredClone(currentCopy) as AdCopy

  // Append a mock improvement marker to first headline
  copy.headline1 = copy.headline1 ? `${copy.headline1} ดีที่สุด`.slice(0, 30) : 'สินค้าดีที่สุด'

  if (campaignType === 'SEARCH' && copy.rsa) {
    const rsa = { ...copy.rsa }
    rsa.headlines = rsa.headlines.map((h, i) =>
      i === 0 ? `${h} ดีที่สุด`.slice(0, 30) : h
    )
    rsa.descriptions = rsa.descriptions.map((d, i) =>
      i === 0 ? `${d} — สั่งซื้อวันนี้`.slice(0, 90) : d
    )
    copy.rsa = rsa
  }

  if (campaignType === 'PERFORMANCE_MAX' && copy.pmax) {
    const pmax = { ...copy.pmax }
    pmax.headlines = pmax.headlines.map((h, i) =>
      i === 0 ? `${h} ดีที่สุด`.slice(0, 30) : h
    )
    pmax.descriptions = pmax.descriptions.map((d, i) =>
      i === 0 ? `${d} — โปรโมชั่นวันนี้`.slice(0, 90) : d
    )
    copy.pmax = pmax
  }

  if (campaignType === 'DISPLAY' && copy.display) {
    const display = { ...copy.display }
    display.headlines = display.headlines.map((h, i) =>
      i === 0 ? `${h} ดีที่สุด`.slice(0, 30) : h
    )
    display.descriptions = display.descriptions.map((d, i) =>
      i === 0 ? `${d} — คลิกเลย!`.slice(0, 90) : d
    )
    copy.display = display
  }

  return copy
}

// ─── Build AI prompt ──────────────────────────────────────────────────────────

function buildPrompt(body: RewriteBody): string {
  const { campaignType, campaignName, currentCopy, businessContext, instruction } = body

  // นับจำนวนเป้าหมายตรงตาม max ที่ Google Ads กำหนดต่อ campaignType (ตรงกับ Zod schema ที่ campaign-adjustments/route.ts ใช้ตอน push จริง)
  // ต้อง "EXACTLY" ไม่ใช่ช่วง — prompt แบบช่วง (เดิม "3–15 items") ทำให้ AI หยุดที่จำนวนเดิมของ ad แทนที่จะเขียนเพิ่มให้เต็ม
  const charLimits: Record<string, string> = {
    SEARCH: 'Headlines: EXACTLY 15 items, max 30 chars each. Descriptions: EXACTLY 4 items, max 90 chars each. DisplayPath: max 15 chars each.',
    PERFORMANCE_MAX: 'Headlines: EXACTLY 15 items, max 30 chars each. LongHeadlines: EXACTLY 5 items, max 90 chars each. Descriptions: EXACTLY 4 items, max 90 chars each. BusinessName: max 25 chars.',
    DISPLAY: 'Headlines: EXACTLY 5 items, max 30 chars each. LongHeadline: exactly 1 item, max 90 chars. Descriptions: EXACTLY 5 items, max 90 chars each. BusinessName: max 25 chars.',
    VIDEO: 'Headline: max 15 chars. CTA: max 10 chars. Description: max 35 chars.',
    DEMAND_GEN: 'Headlines: EXACTLY 5 items, max 30 chars each. Descriptions: EXACTLY 5 items, max 90 chars each.',
    APP_CAMPAIGN: 'Headline: max 30 chars. Description: max 90 chars.',
  }

  return `You are a senior Google Ads copywriter with 10+ years of experience writing high-converting ads for the Thai market. You write like the best direct-response copywriters — every word earns its place, the message is complete within the limit, and the reader always knows what to do next.

Campaign: "${campaignName}" (${campaignType})
Business: ${businessContext.businessName}
Product/Service: ${businessContext.productService}
Objective: ${businessContext.objective}
Tone: ${businessContext.brandTone ?? 'professional'}

ABSOLUTE CHARACTER LIMITS (count every character — do NOT exceed):
${charLimits[campaignType] ?? 'Headlines: max 30 chars each. Descriptions: max 90 chars each.'}

STRICT WRITING RULES:
1. Every headline must be a complete, meaningful phrase — no truncated mid-word text
2. Every description must deliver a full message with a clear benefit and CTA — never cut off mid-sentence
3. No emoji, symbols, exclamation marks used as decoration, or ALL CAPS words
4. No trademark symbols (™ ®), no pipes (|) unless Google explicitly allows them in that field
5. No promotional language that violates Google Ads policies (no "guaranteed", "best in the world", superlatives without proof)
6. Headlines should be keyword-rich but read naturally — not keyword-stuffed
7. Descriptions: state the core benefit in the first half, CTA in the second half
8. Count characters carefully — a 30-char headline with 31 chars will be rejected by Google
9. The item counts above (headlines/descriptions/longHeadlines) are EXACT, not a maximum — if the current copy's array has fewer items than required, WRITE NEW additional ones to fill it up to the exact count (never just leave the original short array as-is). If it has more, trim to the exact count.

${instruction ? `Additional instruction: ${instruction}` : ''}

Current copy (JSON):
${JSON.stringify(currentCopy, null, 2)}

Rewrite ONLY the text fields (headlines, descriptions, businessName, longHeadlines, displayPath1, displayPath2).
Do NOT modify: finalUrl, imageAssets, videoAssets, adType, or any non-text field.
Return ONLY valid JSON with the exact same structure as the input. No explanation, no markdown, just the JSON.`
}

// ─── Validator ─────────────────────────────────────────────────────────────────

function validateCopy(raw: unknown): AdCopy | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  // Minimal check: must have at least headline1 or rsa
  if (typeof r.finalUrl !== 'string') return null
  return raw as AdCopy
}

// ─── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RewriteBody

    if (!body.campaignType || !body.currentCopy) {
      return NextResponse.json({ error: 'Missing required fields: campaignType, currentCopy' }, { status: 400 })
    }

    const copy = await safeCallAI<AdCopy>(
      buildPrompt(body),
      validateCopy,
      () => mockRewrite(body),
      { temperature: 0.7, maxTokens: 65536, tier: 'quality', systemPrompt: `${EXECUTIVE_GROWTH_SKILL}\n\n${AD_COPY_CONTEXT}` }
    )

    return NextResponse.json({ copy })
  } catch (err) {
    console.error('[creatives/ai-rewrite] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
