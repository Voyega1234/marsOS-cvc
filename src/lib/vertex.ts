import { getVercelOidcToken } from '@vercel/oidc'
import { ExternalAccountClient } from 'google-auth-library'
import { createVertex } from '@ai-sdk/google-vertex'
import { generateImage, generateText, Output } from 'ai'

const DEFAULT_LOCATION = 'global'

export interface VertexGenerateOptions {
  model?: string
  temperature?: number
  maxOutputTokens?: number
  responseMimeType?: string
  responseModalities?: Array<'TEXT' | 'IMAGE'>
  tools?: unknown[]
  usageOperation?: string
  usageLabels?: Record<string, string | number | boolean | null | undefined>
}

export interface VertexGenerateResult {
  data: any
  text: string
  usage: {
    promptTokenCount: number
    candidatesTokenCount: number
    totalTokenCount: number
  }
  usageLabels?: Record<string, string>
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
  const stsAudience = `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`
  const oidcAudience =
    process.env.GCP_AUDIENCE ||
    `https://iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`

  const authClient = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: stsAudience,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: {
      getSubjectToken: () => getVercelOidcToken({ audience: oidcAudience }),
    },
  } as any)

  if (!authClient) throw new Error('Unable to initialize Google external account auth client')
  return authClient
}

function getVertex() {
  const projectId = getRequiredEnv('GCP_PROJECT_ID')
  return createVertex({
    project: projectId,
    location: process.env.GCP_LOCATION || DEFAULT_LOCATION,
    googleAuthOptions: {
      authClient: getAuthClient(),
      projectId,
    } as any,
  })
}

function normalizeLabelKey(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^[^a-z]+/, '').slice(0, 63)
  return normalized || 'label'
}

function normalizeLabelValue(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 63)
  return normalized || 'unknown'
}

function buildGeminiUsageLabels(model: string, options: VertexGenerateOptions): Record<string, string> {
  const labels: Record<string, string> = {
    project: normalizeLabelValue(process.env.GEMINI_USAGE_PROJECT_LABEL || 'maros'),
    provider: 'vertex',
    model: normalizeLabelValue(model),
    operation: normalizeLabelValue(options.usageOperation || 'gemini'),
  }

  for (const [key, rawValue] of Object.entries(options.usageLabels ?? {})) {
    if (rawValue === undefined || rawValue === null || rawValue === '') continue
    labels[normalizeLabelKey(key)] = normalizeLabelValue(String(rawValue))
  }

  return labels
}

function buildProviderOptions(labels: Record<string, string>) {
  return {
    googleVertex: { labels },
    vertex: { labels },
    google: { labels },
  }
}

export async function generateVertexContent(prompt: string, options: VertexGenerateOptions = {}): Promise<VertexGenerateResult> {
  const model = options.model || process.env.GEMINI_MODEL || 'gemini-3-flash-preview'
  const vertex = getVertex()
  const usageLabels = buildGeminiUsageLabels(model, options)
  const providerOptions = buildProviderOptions(usageLabels)

  if (options.responseModalities?.includes('IMAGE')) {
    const result = await generateImage({
      model: vertex.image(model),
      prompt,
      providerOptions,
    } as any)
    const image = result.image
    const promptTokens = result.usage.inputTokens ?? 0
    const candidatesTokenCount = result.usage.outputTokens ?? 0
    const totalTokenCount = result.usage.totalTokens ?? (promptTokens + candidatesTokenCount)

    return {
      data: {
        candidates: [{
          content: {
            parts: [{ inlineData: { mimeType: image.mediaType, data: image.base64 } }],
          },
        }],
      },
      text: '',
      usageLabels,
      usage: { promptTokenCount: promptTokens, candidatesTokenCount, totalTokenCount },
    } as VertexGenerateResult
  }

  const usesGoogleSearch = options.tools?.some((tool: any) => tool?.googleSearch)
  const result = await generateText({
    model: vertex(model),
    prompt,
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
    providerOptions,
    ...(usesGoogleSearch ? { tools: { google_search: vertex.tools.googleSearch({}) } } : {}),
    ...(options.responseMimeType === 'application/json' ? { output: Output.json() } : {}),
  } as any)

  const providerMetadata = result.providerMetadata?.google as any
  const text = result.text || (result.output !== undefined ? JSON.stringify(result.output) : '')
  const promptTokenCount = result.usage.inputTokens ?? 0
  const candidatesTokenCount = result.usage.outputTokens ?? 0
  const totalTokenCount = result.usage.totalTokens ?? (promptTokenCount + candidatesTokenCount)
  const data = {
    candidates: [{
      content: { parts: [{ text }] },
      groundingMetadata: providerMetadata?.groundingMetadata ?? undefined,
    }],
    usageMetadata: providerMetadata?.usageMetadata ?? undefined,
    usageLabels,
  }

  return {
    data,
    text,
    usage: { promptTokenCount, candidatesTokenCount, totalTokenCount },
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
