// Pure helpers for the lead change log (no prisma, no next imports).

export const LEAD_CONTACT_FIELDS = ['fullName', 'phone', 'salesOwner', 'value'] as const
export type LeadChangeField = 'status' | (typeof LEAD_CONTACT_FIELDS)[number]

export type LeadActor = { type: 'client' | 'staff'; name: string }

export type LeadContact = {
  fullName: string | null
  phone: string | null
  salesOwner: string | null
  value: number
}

export type LeadFieldChange = { field: LeadChangeField; oldValue: string | null; newValue: string | null }

const MAX_VALUE = 1_000_000_000_000

function cleanText(x: unknown, max: number): string | null {
  const s = String(x ?? '').trim()
  return s ? s.slice(0, max) : null
}

/** Trim, cut and range-check the contact fields a lead edit form posts. */
export function parseLeadContactInput(raw: {
  fullName: unknown
  phone: unknown
  salesOwner: unknown
  value: unknown
}): LeadContact {
  const value = Number(raw.value || 0)
  if (!Number.isFinite(value) || value < 0 || value > MAX_VALUE) throw new Error('มูลค่าไม่ถูกต้อง')
  return {
    fullName: cleanText(raw.fullName, 200),
    phone: cleanText(raw.phone, 50),
    salesOwner: cleanText(raw.salesOwner, 200),
    value,
  }
}

/** The fields that differ between two contact snapshots (value compared as a number). */
export function diffLeadFields(before: LeadContact, after: LeadContact): LeadFieldChange[] {
  const out: LeadFieldChange[] = []
  if (before.fullName !== after.fullName) out.push({ field: 'fullName', oldValue: before.fullName, newValue: after.fullName })
  if (before.phone !== after.phone) out.push({ field: 'phone', oldValue: before.phone, newValue: after.phone })
  if (before.salesOwner !== after.salesOwner) out.push({ field: 'salesOwner', oldValue: before.salesOwner, newValue: after.salesOwner })
  if (before.value !== after.value) out.push({ field: 'value', oldValue: String(before.value), newValue: String(after.value) })
  return out
}

/** A contact-field change can be put back only while nothing has changed that field since. */
export function canRevert(change: { field: string; newValue: string | null }, current: LeadContact): boolean {
  if (!(LEAD_CONTACT_FIELDS as readonly string[]).includes(change.field)) return false
  const field = change.field as (typeof LEAD_CONTACT_FIELDS)[number]
  if (field === 'value') return String(current.value) === change.newValue
  return current[field] === change.newValue
}

export function changedByLabel(actor: LeadActor): string {
  return actor.type === 'client' ? `Client (dashboard): ${actor.name}` : 'Agency Admin (dashboard)'
}
