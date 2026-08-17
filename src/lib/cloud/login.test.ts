import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cloudIntegrationStartUrl, cloudLoginUrl, localCloudCallbackUrl } from './login.ts'

test('cloudLoginUrl puts PKCE fields on the query string', () => {
  const url = new URL(
    cloudLoginUrl({
      cloudUrl: 'http://127.0.0.1:3000',
      redirectUri: 'http://127.0.0.1:3000/cloud/callback',
      machineId: 'mch_1',
      codeChallenge: 'abc',
      state: 'st',
    }),
  )
  assert.equal(url.pathname, '/connect')
  assert.equal(url.searchParams.get('machine_id'), 'mch_1')
  assert.equal(url.searchParams.get('code_challenge'), 'abc')
  assert.equal(url.searchParams.get('state'), 'st')
})

test('cloudIntegrationStartUrl never carries a token', () => {
  const url = new URL(
    cloudIntegrationStartUrl({
      cloudUrl: 'https://cloud.example.com',
      provider: 'jira',
      redirectUri: 'http://127.0.0.1:3000/cloud/callback',
      state: 'st',
    }),
  )
  assert.equal(url.pathname, '/api/integrations/jira/start')
  assert.equal(url.searchParams.get('state'), 'st')
  assert.equal(url.searchParams.get('access_token'), null)
})

test('cloudIntegrationStartUrl addresses each provider', () => {
  for (const provider of ['github', 'gitlab', 'bitbucket', 'linear', 'azure-devops']) {
    const url = new URL(
      cloudIntegrationStartUrl({
        cloudUrl: 'https://cloud.example.com',
        provider,
        redirectUri: 'http://127.0.0.1:3000/cloud/callback',
        state: 'st',
      }),
    )
    assert.equal(url.pathname, `/api/integrations/${provider}/start`)
  }
})

test('localCloudCallbackUrl is origin plus path', () => {
  assert.equal(
    localCloudCallbackUrl('http://127.0.0.1:3000/'),
    'http://127.0.0.1:3000/cloud/callback',
  )
})
