import { getVercelOidcToken } from '@vercel/oidc'
import { ExternalAccountClient } from 'google-auth-library'

const DEFAULT_LOCATION = 'us-central1'

export interface VertexGenerateOptions {
  model?: string
  temperature?: number
  maxOutputTokens?: number
  responseMimeType?: string
  responseModalities?: Array<'TEXT' | 'IMAGE'>
  tools?: unknown[]
}

export interface VertexGenerateResult {
  data: any
  text: string
  usage: {
    promptTokenCount: number
    candidatesTokenCount: number
    totalTokenCount: number
  }
}

export function isVertexOidcConfigured(): boolean {
  return Boolean(
    process.env.GCP_PROJECT_ID &&
    process.env.GCP_PROJECT_NUMBER &&
    process.env.GCP_SERVICE_ACCOUNT_EMAIL &&
    process.env.GCP_WORKLOAD_IDENTITY_POOL_ID &&
    process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID
  )
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} not configured`)
  return value
}

function getAuthClient() {
  const projectNumber = getRequiredEnv('GCP_PROJECT_NUMBER')
  const serviceAccountEmail = getRequiredEnv('GCP_SERVICE_ACCOUNT_EMAIL')
  const poolId = getRequiredEnv('GCP_WORKLOAD_IDENTITY_POOL_ID')
  const providerId = getRequiredEnv('GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID')
  const audience = `https://iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`

  const authClient = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: {
      getSubjectToken: () => getVercelOidcToken({ audience }),
    },
  } as any)

  if (!authClient) throw new Error('Unable to initialize Google external account auth client')
  return authClient
}

async function getAccessToken(): Promise<string> {
  const token = await getAuthClient().getAccessToken()
  const value = typeof token === 'string' ? token : token?.token
  if (!value) throw new Error('Unable to get Google access token from Vercel OIDC')
  return value
}

export async function generateVertexContent(prompt: string, options: VertexGenerateOptions = {}): Promise<VertexGenerateResult> {
  const projectId = getRequiredEnv('GCP_PROJECT_ID')
  const location = process.env.GCP_LOCATION || DEFAULT_LOCATION
  const model = options.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const token = await getAccessToken()
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`

  const generationConfig: Record<string, unknown> = {}
  if (options.temperature !== undefined) generationConfig.temperature = options.temperature
  if (options.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = options.maxOutputTokens
  if (options.responseMimeType) generationConfig.responseMimeType = options.responseMimeType
  if (options.responseModalities) generationConfig.responseModalities = options.responseModalities

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
      ...(options.tools?.length ? { tools: options.tools } : {}),
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Vertex Gemini error ${res.status}: ${errText.slice(0, 500)}`)
  }

  const data = await res.json()
  const parts = data?.candidates?.[0]?.content?.parts ?? []
  const text = parts.map((part: any) => part.text).filter(Boolean).join('')
  const usage = data?.usageMetadata ?? {}

  return {
    data,
    text,
    usage: {
      promptTokenCount: usage.promptTokenCount ?? 0,
      candidatesTokenCount: usage.candidatesTokenCount ?? 0,
      totalTokenCount: usage.totalTokenCount ?? ((usage.promptTokenCount ?? 0) + (usage.candidatesTokenCount ?? 0)),
    },
  }
}

export function getVertexInlineImage(data: any): { mimeType: string; data: string } | null {
  const parts: Array<{ inlineData?: { mimeType?: string; data?: string }; inline_data?: { mimeType?: string; data?: string } }> =
    data?.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find(part => part.inlineData?.data || part.inline_data?.data)
  const inlineData = imagePart?.inlineData ?? imagePart?.inline_data
  if (!inlineData?.data) return null
  return { mimeType: inlineData.mimeType || 'image/jpeg', data: inlineData.data }
}
