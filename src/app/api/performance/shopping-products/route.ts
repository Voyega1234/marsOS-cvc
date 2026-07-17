import { NextRequest, NextResponse } from 'next/server'
import { isMockMode } from '@/lib/google-ads/client'
import { getGoogleAdsAccessToken } from '@/lib/google-ads/auth'

export interface ProductPerformance {
  itemId: string
  title: string
  brand: string
  productType: string
  cost: number
  clicks: number
  impressions: number
  conversions: number
  conversionValue: number
  ctr: number
  cpc: number
  roas: number
}

const MOCK_PRODUCTS: Array<Omit<ProductPerformance, 'ctr' | 'cpc' | 'roas'>> = [
  { itemId: 'SKU-001', title: 'เสื้อยืด Oversize Cotton Unisex สีขาว', brand: 'BasicLab', productType: 'เสื้อผ้า > เสื้อยืด', cost: 3200, clicks: 420, impressions: 14200, conversions: 18, conversionValue: 12600 },
  { itemId: 'SKU-002', title: 'กางเกงขาสั้น Jogger ผ้า Dry-Fit', brand: 'BasicLab', productType: 'เสื้อผ้า > กางเกง', cost: 2800, clicks: 310, impressions: 11500, conversions: 12, conversionValue: 8400 },
  { itemId: 'SKU-003', title: 'หูฟัง Bluetooth In-Ear รุ่น BT-50 Pro', brand: 'SoundX', productType: 'อิเล็กทรอนิกส์ > หูฟัง', cost: 4500, clicks: 580, impressions: 22000, conversions: 22, conversionValue: 19800 },
  { itemId: 'SKU-004', title: 'นาฬิกา Smart Watch รุ่น SW-100', brand: 'TechTime', productType: 'อิเล็กทรอนิกส์ > นาฬิกา', cost: 5800, clicks: 640, impressions: 27000, conversions: 15, conversionValue: 22500 },
  { itemId: 'SKU-005', title: 'กระเป๋าเป้ Laptop 15.6" กันน้ำ', brand: 'PackPro', productType: 'กระเป๋า > กระเป๋าเป้', cost: 2100, clicks: 280, impressions: 9800, conversions: 9, conversionValue: 5400 },
  { itemId: 'SKU-006', title: 'เคสโทรศัพท์ iPhone 15 Pro TPU กันกระแทก', brand: 'CaseKing', productType: 'อุปกรณ์มือถือ > เคส', cost: 950, clicks: 210, impressions: 7200, conversions: 28, conversionValue: 5040 },
  { itemId: 'SKU-007', title: 'ที่ชาร์จไร้สาย Qi 15W Fast Charge', brand: 'ChargePad', productType: 'อิเล็กทรอนิกส์ > ชาร์จเจอร์', cost: 1800, clicks: 230, impressions: 8400, conversions: 14, conversionValue: 5600 },
  { itemId: 'SKU-008', title: 'โต๊ะทำงาน Standing Desk ปรับความสูงได้', brand: 'DeskMaster', productType: 'เฟอร์นิเจอร์ > โต๊ะ', cost: 6200, clicks: 320, impressions: 16500, conversions: 8, conversionValue: 19200 },
  { itemId: 'SKU-009', title: 'เก้าอี้ Gaming Ergonomic รุ่น EZ-500', brand: 'ComfortPro', productType: 'เฟอร์นิเจอร์ > เก้าอี้', cost: 5100, clicks: 290, impressions: 14000, conversions: 6, conversionValue: 10200 },
  { itemId: 'SKU-010', title: 'หมอน Memory Foam ปรับคอ', brand: 'SleepWell', productType: 'ของใช้ในบ้าน > หมอน', cost: 1400, clicks: 185, impressions: 6200, conversions: 11, conversionValue: 4400 },
  { itemId: 'SKU-011', title: 'ผ้าขนหนู Microfiber ชุด 3 ชิ้น', brand: 'CleanHome', productType: 'ของใช้ในบ้าน > ผ้าขนหนู', cost: 620, clicks: 95, impressions: 3800, conversions: 5, conversionValue: 750 },
  { itemId: 'SKU-012', title: 'กระติกน้ำ Stainless 1L ฝาล็อค', brand: 'HydroMax', productType: 'กีฬา > อุปกรณ์', cost: 780, clicks: 140, impressions: 5100, conversions: 8, conversionValue: 1760 },
  { itemId: 'SKU-013', title: 'รองเท้า Running น้ำหนักเบา รุ่น AirRun', brand: 'SpeedStep', productType: 'รองเท้า > กีฬา', cost: 3800, clicks: 490, impressions: 18600, conversions: 14, conversionValue: 11200 },
  { itemId: 'SKU-014', title: 'ครีมกันแดด SPF50+ PA++++ 50ml', brand: 'SunBlock', productType: 'ความงาม > ครีมกันแดด', cost: 1150, clicks: 175, impressions: 6500, conversions: 20, conversionValue: 6000 },
  { itemId: 'SKU-015', title: 'วิตามิน C 1000mg 30 เม็ด', brand: 'HealthPlus', productType: 'สุขภาพ > วิตามิน', cost: 680, clicks: 120, impressions: 4200, conversions: 9, conversionValue: 990 },
  { itemId: 'SKU-016', title: 'แก้วกาแฟ DoubleWall สแตนเลส 350ml', brand: 'CupLab', productType: 'ของใช้ในบ้าน > แก้ว', cost: 520, clicks: 88, impressions: 3100, conversions: 4, conversionValue: 480 },
  { itemId: 'SKU-017', title: 'สายชาร์จ USB-C to USB-C 100W 1.5m', brand: 'CablePro', productType: 'อิเล็กทรอนิกส์ > สาย', cost: 410, clicks: 72, impressions: 2800, conversions: 6, conversionValue: 540 },
  { itemId: 'SKU-018', title: 'ปากกา Stylus สำหรับ iPad ทุกรุ่น', brand: 'PenMaster', productType: 'อุปกรณ์มือถือ > Stylus', cost: 1900, clicks: 220, impressions: 7800, conversions: 7, conversionValue: 4200 },
]

function computeDerived(p: Omit<ProductPerformance, 'ctr' | 'cpc' | 'roas'>): ProductPerformance {
  return {
    ...p,
    ctr:  p.impressions > 0 ? parseFloat(((p.clicks / p.impressions) * 100).toFixed(2)) : 0,
    cpc:  p.clicks > 0 ? parseFloat((p.cost / p.clicks).toFixed(2)) : 0,
    roas: p.cost > 0 ? parseFloat((p.conversionValue / p.cost).toFixed(2)) : 0,
  }
}

async function getMockProducts(
  _campaignId: string,
  _days: number
): Promise<ProductPerformance[]> {
  await new Promise((r) => setTimeout(r, 400))
  return MOCK_PRODUCTS.map(computeDerived).sort((a, b) => b.cost - a.cost)
}

function buildDateCondition(params: URLSearchParams): string {
  const dateRange = params.get('dateRange')
  if (dateRange) return `segments.date DURING ${dateRange}`
  const startDate = params.get('startDate')
  const endDate   = params.get('endDate')
  if (startDate && endDate) return `segments.date BETWEEN '${startDate}' AND '${endDate}'`
  const days = parseInt(params.get('days') ?? '30', 10)
  const map: Record<number, string> = { 1: 'TODAY', 7: 'LAST_7_DAYS', 14: 'LAST_14_DAYS', 30: 'LAST_30_DAYS' }
  return `segments.date DURING ${map[days] ?? 'LAST_30_DAYS'}`
}

async function getRealProducts(
  customerId: string,
  campaignId: string,
  params: URLSearchParams
): Promise<ProductPerformance[]> {
  const devToken        = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? ''
  const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? '').replace(/-/g, '')
  if (!devToken) throw new Error('No developer token')

  const token = await getGoogleAdsAccessToken()
  const dateCondition = buildDateCondition(params)

  const headers: Record<string, string> = {
    Authorization:     `Bearer ${token}`,
    'developer-token': devToken,
    'Content-Type':    'application/json',
  }
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId

  const campaignCondition = campaignId ? ` AND campaign.id = '${campaignId}'` : ''
  const query = `SELECT segments.product_item_id, segments.product_title, segments.product_brand, segments.product_type_l1, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM shopping_performance_view WHERE ${dateCondition}${campaignCondition} ORDER BY metrics.cost_micros DESC LIMIT 200`

  const res = await fetch(
    `https://googleads.googleapis.com/v21/customers/${customerId.replace(/-/g, '')}/googleAds:search`,
    { method: 'POST', headers, body: JSON.stringify({ query }) }
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Google Ads API ${res.status}: ${err.slice(0, 200)}`)
  }

  const data = await res.json() as {
    results?: Array<{
      segments: { productItemId: string; productTitle: string; productBrand: string; productTypeL1: string }
      metrics: { costMicros: string; clicks: string; impressions: string; conversions: string; conversionsValue: string }
    }>
  }

  return (data.results ?? []).map((r) => {
    const cost  = Number(r.metrics.costMicros ?? 0) / 1e6
    const clicks = Number(r.metrics.clicks ?? 0)
    const impr  = Number(r.metrics.impressions ?? 0)
    const conv  = Number(r.metrics.conversions ?? 0)
    const value = Number(r.metrics.conversionsValue ?? 0)
    return {
      itemId:          r.segments.productItemId ?? '',
      title:           r.segments.productTitle ?? '',
      brand:           r.segments.productBrand ?? '',
      productType:     r.segments.productTypeL1 ?? '',
      cost, clicks, impressions: impr, conversions: conv, conversionValue: value,
      ctr:  impr > 0 ? parseFloat(((clicks / impr) * 100).toFixed(2)) : 0,
      cpc:  clicks > 0 ? parseFloat((cost / clicks).toFixed(2)) : 0,
      roas: cost > 0 && value > 0 ? parseFloat((value / cost).toFixed(2)) : 0,
    }
  })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const customerId = searchParams.get('customerId') ?? ''
  const campaignId = searchParams.get('campaignId') ?? ''  // empty = all campaigns
  const days       = parseInt(searchParams.get('days') ?? '30', 10)

  try {
    const products = isMockMode()
      ? await getMockProducts(campaignId, days)
      : await getRealProducts(customerId, campaignId, searchParams)

    const totalCost  = products.reduce((a, p) => a + p.cost, 0)
    const totalConv  = products.reduce((a, p) => a + p.conversions, 0)
    const totalValue = products.reduce((a, p) => a + p.conversionValue, 0)
    const totalClicks = products.reduce((a, p) => a + p.clicks, 0)

    return NextResponse.json({
      customerId,
      campaignId,
      days,
      products,
      totals: {
        productCount:    products.length,
        cost:            totalCost,
        clicks:          totalClicks,
        conversions:     totalConv,
        conversionValue: totalValue,
        roas:            totalCost > 0 ? parseFloat((totalValue / totalCost).toFixed(2)) : 0,
        avgCpc:          totalClicks > 0 ? parseFloat((totalCost / totalClicks).toFixed(2)) : 0,
      },
      source: isMockMode() ? 'mock' : 'google_ads_api',
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch product performance' },
      { status: 500 }
    )
  }
}
