import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cloudJiraStartUrl, cloudLoginUrl, localCloudCallbackUrl } from './login.ts'

test('cloudLoginUrl puts PKCE fields on the query string', () => {
  const url = new URL(
    cloudLoginUrl({
      cloudUrl: 'http://127.0.0.1:8787',
      redirectUri: 'http://127.0.0.1:3000/cloud/callback',
      machineId: 'mch_1',
      codeChallenge: 'abc',
      state: 'st',
    }),
  )
  assert.equal(url.pathname, '/login')
  assert.equal(url.searchParams.get('machine_id'), 'mch_1')
  assert.equal(url.searchParams.get('code_challenge'), 'abc')
  assert.equal(url.searchParams.get('state'), 'st')
})

test('cloudJiraStartUrl carries the session token', () => {
  const url = new URL(
    cloudJiraStartUrl({
      cloudUrl: 'https://cloud.example.com',
      redirectUri: 'http://127.0.0.1:3000/cloud/callback',
      accessToken: 'tok',
      state: 'st',
    }),
  )
  assert.equal(url.pathname, '/oauth/jira/start')
  assert.equal(url.searchParams.get('access_token'), 'tok')
})

test('localCloudCallbackUrl is origin plus path', () => {
  assert.equal(
    localCloudCallbackUrl('http://127.0.0.1:3000/'),
    'http://127.0.0.1:3000/cloud/callback',
  )
})
