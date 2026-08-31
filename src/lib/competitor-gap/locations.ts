/**
 * Competitor Gap — ประเทศที่เลือกได้ในฟอร์ม → location_code / language_code ของ DataForSEO
 * ใช้ convention เดียวกับที่โปรเจกต์ใช้อยู่แล้ว (ไทย = 2764 / 'th')
 */

export interface CountryOption {
  key: string
  label: string
  locationCode: number
  languageCode: string
}

export const COUNTRIES: CountryOption[] = [
  { key: 'th', label: 'Thailand',       locationCode: 2764, languageCode: 'th' },
  { key: 'us', label: 'United States',  locationCode: 2840, languageCode: 'en' },
  { key: 'gb', label: 'United Kingdom', locationCode: 2826, languageCode: 'en' },
  { key: 'sg', label: 'Singapore',      locationCode: 2702, languageCode: 'en' },
  { key: 'my', label: 'Malaysia',       locationCode: 2458, languageCode: 'en' },
  { key: 'vn', label: 'Vietnam',        locationCode: 2704, languageCode: 'vi' },
  { key: 'id', label: 'Indonesia',      locationCode: 2360, languageCode: 'id' },
  { key: 'ph', label: 'Philippines',    locationCode: 2608, languageCode: 'en' },
  { key: 'jp', label: 'Japan',          locationCode: 2392, languageCode: 'ja' },
  { key: 'au', label: 'Australia',      locationCode: 2036, languageCode: 'en' },
  { key: 'in', label: 'India',          locationCode: 2356, languageCode: 'en' },
  { key: 'ae', label: 'UAE',            locationCode: 2784, languageCode: 'en' },
]

export const DEFAULT_COUNTRY = 'th'

export function resolveCountry(key: string): CountryOption {
  return COUNTRIES.find(c => c.key === key) ?? COUNTRIES[0]
}
