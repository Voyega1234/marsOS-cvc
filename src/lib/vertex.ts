import { createVertex, type GoogleVertexProvider } from '@ai-sdk/google-vertex'
import { ExternalAccountClient } from 'google-auth-library'
import { getVercelOidcToken } from '@vercel/oidc'

const REQUIRED_ENV_VARS = [
  'GCP_PROJECT_ID',
  'GCP_PROJECT_NUMBER',
  'GCP_SERVICE_ACCOUNT_EMAIL',
  'GCP_WORKLOAD_IDENTITY_POOL_ID',
  'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID',
] as const

export const VERTEX_TEXT_MODEL = process.env.VERTEX_TEXT_MODEL || 'gemini-2.5-flash'
export const VERTEX_IMAGE_MODEL = process.env.VERTEX_IMAGE_MODEL || 'gemini-3.1-flash-image-preview'

let vertexProvider: GoogleVertexProvider | undefined

export function getMissingVertexEnvVars(): string[] {
  return REQUIRED_ENV_VARS.filter(name => !process.env[name])
}

export function hasVertexOidcConfig(): boolean {
  return getMissingVertexEnvVars().length === 0
}

export function getVertex(): GoogleVertexProvider {
  if (vertexProvider) return vertexProvider

  const missing = getMissingVertexEnvVars()
  if (missing.length > 0) {
    throw new Error(`Vertex AI OIDC configuration is incomplete: ${missing.join(', ')}`)
  }

  const projectId = process.env.GCP_PROJECT_ID!
  const projectNumber = process.env.GCP_PROJECT_NUMBER!
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL!
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID!
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID!
  const audience = `https://iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`

  const authClient = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: {
      // Invoked lazily inside the active Vercel request context.
      getSubjectToken: () => getVercelOidcToken({ audience }),
    },
  })

  if (!authClient) throw new Error('Unable to initialize the Google external account client')

  vertexProvider = createVertex({
    project: projectId,
    location: process.env.GCP_VERTEX_LOCATION || 'us-central1',
    googleAuthOptions: { authClient, projectId },
  })

  return vertexProvider
}
