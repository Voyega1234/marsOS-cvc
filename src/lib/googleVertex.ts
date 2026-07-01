import { getVercelOidcToken } from '@vercel/oidc'
import { BaseExternalAccountClient, ExternalAccountClient } from 'google-auth-library'

type VertexPart = {
  text?: string
  inlineData?: { mimeType?: string; data?: string }
  inline_data?: { mime_type?: string; data?: string }
}

export type VertexGenerateContentResponse = {
  candidates?: Array<{
    content?: { parts?: VertexPart[] }
    groundingMetadata?: {
      webSearchQueries?: string[]
      groundingChunks?: Array<{ web?: { uri?: string } }>
    }
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

const REQUIRED_VERTEX_ENV = [
  'GCP_PROJECT_ID',
  'GCP_PROJECT_NUMBER',
  'GCP_SERVICE_ACCOUNT_EMAIL',
  'GCP_WORKLOAD_IDENTITY_POOL_ID',
  'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID',
] as const

let authClient: BaseExternalAccountClient | null = null

export function isVertexOidcConfigured(): boolean {
  return REQUIRED_VERTEX_ENV.every(key => !!process.env[key])
}

export function assertVertexOidcConfigured() {
  const missing = REQUIRED_VERTEX_ENV.filter(key => !process.env[key])
  if (missing.length > 0) {
    throw new Error(`Vertex OIDC is not configured. Missing env: ${missing.join(', ')}`)
  }
}

function getVertexLocation(): string {
  return process.env.GCP_LOCATION || process.env.VERTEX_LOCATION || 'us-central1'
}

function getAuthClient(): BaseExternalAccountClient {
  assertVertexOidcConfigured()
  if (authClient) return authClient

  const projectNumber = process.env.GCP_PROJECT_NUMBER!
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID!
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID!
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL!

  const client = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: {
      getSubjectToken: getVercelOidcToken,
    },
  } as any)

  if (!client) throw new Error('Failed to initialize Google external account client')
  authClient = client

  return authClient
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers = await getAuthClient().getRequestHeaders()
  const authHeader = headers.get('authorization')

  if (!authHeader) throw new Error('Failed to obtain Vertex authorization header from Vercel OIDC')
  return { Authorization: authHeader, 'Content-Type': 'application/json' }
}

function getGenerateContentUrl(model: string): string {
  const projectId = process.env.GCP_PROJECT_ID!
  const location = getVertexLocation()
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`
}

export async function generateVertexContent(opts: {
  model: string
  prompt: string
  generationConfig?: Record<string, unknown>
  tools?: Array<Record<string, unknown>>
}): Promise<VertexGenerateContentResponse> {
  const res = await fetch(getGenerateContentUrl(opts.model), {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
      ...(opts.generationConfig ? { generationConfig: opts.generationConfig } : {}),
      ...(opts.tools ? { tools: opts.tools } : {}),
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Vertex Gemini error ${res.status}: ${errText.slice(0, 500)}`)
  }

  return res.json()
}

export function getVertexText(response: VertexGenerateContentResponse): string {
  return response.candidates?.[0]?.content?.parts
    ?.map(part => part.text ?? '')
    .join('') ?? ''
}

export function getVertexInlineImage(response: VertexGenerateContentResponse): { data: string; mimeType: string } | null {
  const parts = response.candidates?.[0]?.content?.parts ?? []
  for (const part of parts) {
    if (part.inlineData?.data) {
      return { data: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' }
    }
    if (part.inline_data?.data) {
      return { data: part.inline_data.data, mimeType: part.inline_data.mime_type || 'image/png' }
    }
  }
  return null
}
