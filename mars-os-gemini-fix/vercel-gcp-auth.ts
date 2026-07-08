import { getVercelOidcToken } from '@vercel/oidc'
import { ExternalAccountClient } from 'google-auth-library'

export async function getGeminiTokenViaOidc(): Promise<string> {
  const projectNumber = process.env.GCP_PROJECT_NUMBER
  const poolId        = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID
  const providerId    = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID
  const saEmail       = process.env.GCP_SERVICE_ACCOUNT_EMAIL

  if (!projectNumber || !poolId || !providerId || !saEmail) {
    throw new Error('Missing GCP_PROJECT_NUMBER / GCP_WORKLOAD_IDENTITY_POOL_ID / GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID / GCP_SERVICE_ACCOUNT_EMAIL')
  }

  const client = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${saEmail}:generateAccessToken`,
    subject_token_supplier: { getSubjectToken: getVercelOidcToken },
    scopes: ['https://www.googleapis.com/auth/generative-language'],
  })

  const token = await client!.getAccessToken()
  if (!token.token) throw new Error('Vercel OIDC → GCP token exchange failed')
  return token.token
}
