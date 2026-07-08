import { getVercelOidcToken } from '@vercel/oidc'
import { ExternalAccountClient } from 'google-auth-library'
import { createVertex } from '@ai-sdk/google-vertex'
import { generateImage, generateText, Output } from 'ai'

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
  const audience = `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`

  const authClient = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: {
      getSubjectToken: () => getVercelOidcToken(),
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

export async function generateVertexContent(prompt: string, options: VertexGenerateOptions = {}): Promise<VertexGenerateResult> {
  const model = options.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const vertex = getVertex()

  if (options.responseModalities?.includes('IMAGE')) {
    const result = await generateImage({
      model: vertex.image(model),
      prompt,
    })
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
      usage: { promptTokenCount: promptTokens, candidatesTokenCount, totalTokenCount },
    }
  }

  const usesGoogleSearch = options.tools?.some((tool: any) => tool?.googleSearch)
  const result = await generateText({
    model: vertex(model),
    prompt,
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
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
