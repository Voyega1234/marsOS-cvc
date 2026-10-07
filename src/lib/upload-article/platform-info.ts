/**
 * ข้อมูลแพลตฟอร์มเว็บปลายทางของลูกค้า Upload Article (ฝั่ง client ใช้ได้ — อ่านจาก DTO ที่ mask แล้วเท่านั้น)
 * ใช้ร่วมกันทั้ง Connect / Push / สแกนเว็บ / สไตล์ ให้ทุกหน้าสลับตามแพลตฟอร์มที่เลือกเหมือนกัน
 * WordPress = พฤติกรรมเดิมทั้งหมด ห้ามเปลี่ยน
 */
import type { UploadClientDTO } from './types'

export type UploadPlatformId = 'wordpress' | 'webflow' | 'wix' | 'shopify' | 'custom'

export const UPLOAD_PLATFORM_LABEL: Record<UploadPlatformId, string> = {
  wordpress: 'WordPress',
  webflow: 'Webflow',
  wix: 'Wix',
  shopify: 'Shopify',
  custom: 'อื่น ๆ / Custom',
}

export function uploadPlatformOf(client: Pick<UploadClientDTO, 'websitePlatform'>): UploadPlatformId {
  const p = client.websitePlatform
  return p === 'webflow' || p === 'wix' || p === 'shopify' || p === 'custom' ? p : 'wordpress'
}

type ClientLike = Pick<UploadClientDTO, 'websitePlatform' | 'wpUrl' | 'website' | 'hasWpPassword' | 'siteConnectionMasked'>

function conn(client: ClientLike, platform: string, key: string): string {
  return client.siteConnectionMasked?.[`${platform}.${key}`] || ''
}

export function withProtocol(url: string): string {
  const u = url.trim()
  if (!u) return ''
  return /^https?:\/\//i.test(u) ? u : `https://${u}`
}

export function hostOf(url: string): string {
  try {
    return new URL(withProtocol(url)).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** URL เว็บที่บทความจะขึ้นจริง (เว็บที่ push ไป) — ใช้แสดงผล + เป็นค่าเริ่มต้นของการสแกนเว็บ */
export function pushTargetUrl(client: ClientLike): string {
  switch (uploadPlatformOf(client)) {
    case 'wordpress':
      return client.wpUrl || client.website || ''
    case 'webflow':
      return withProtocol(conn(client, 'webflow', 'siteUrl')) || client.website || ''
    case 'shopify':
      // storeDomain มักเป็น xxx.myshopify.com — เว็บจริงของลูกค้าคือ client.website ถ้าตั้งไว้
      return client.website || withProtocol(conn(client, 'shopify', 'storeDomain'))
    default:
      return client.website || ''
  }
}

/** ปลายทางย่อยในเว็บ (Collection / Blog) — แสดงคู่กับ URL */
export function pushTargetDetail(client: ClientLike): string {
  switch (uploadPlatformOf(client)) {
    case 'webflow': {
      const slug = conn(client, 'webflow', 'collectionSlug')
      return slug ? `Collection: ${slug}` : ''
    }
    case 'shopify': {
      const handle = conn(client, 'shopify', 'blogHandle')
      return handle ? `Blog: ${handle}` : 'Blog: บล็อกแรกของร้าน'
    }
    case 'wix':
      return 'Wix Blog'
    case 'custom': {
      const hook = conn(client, 'custom', 'webhookUrl')
      return hook ? `Webhook: ${hostOf(hook)}` : ''
    }
    default:
      return ''
  }
}

/** ค่าที่ยังขาดสำหรับ push ของแพลตฟอร์มนี้ (ว่าง = ตั้งครบ) */
export function missingConnectionFields(client: ClientLike): string[] {
  const missing: string[] = []
  switch (uploadPlatformOf(client)) {
    case 'wordpress':
      if (!client.wpUrl) missing.push('WordPress URL')
      if (!client.hasWpPassword) missing.push('Application Password')
      break
    case 'webflow':
      if (!conn(client, 'webflow', 'apiToken')) missing.push('Site API token')
      if (!conn(client, 'webflow', 'collectionId')) missing.push('Collection')
      break
    case 'shopify':
      if (!conn(client, 'shopify', 'storeDomain')) missing.push('Store domain')
      if (!conn(client, 'shopify', 'accessToken')) missing.push('Admin API access token')
      break
    case 'wix':
      if (!conn(client, 'wix', 'apiKey')) missing.push('API Key')
      if (!conn(client, 'wix', 'siteId')) missing.push('Site ID')
      if (!conn(client, 'wix', 'memberId')) missing.push('Member ID (ผู้เขียน)')
      break
    case 'custom':
      if (!conn(client, 'custom', 'webhookUrl')) missing.push('Webhook URL')
      break
  }
  return missing
}

/** ตัวเลือก push ที่แต่ละแพลตฟอร์มรองรับ */
export function pushCapabilities(platform: UploadPlatformId) {
  return {
    /** Post/Page */
    postType: platform === 'wordpress',
    elementor: platform === 'wordpress',
    /** push ซ้ำแก้ของเดิม (ไม่สร้างซ้ำ) */
    updatesExisting: platform !== 'custom',
    /** ระบบรู้สถานะจริงบนเว็บ (Draft ที่ตั้งเวลาไว้) */
    checksLiveStatus: platform === 'wordpress',
  }
}
