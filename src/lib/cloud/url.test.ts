import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cloudWsUrl, DEFAULT_CLOUD_URL, resolveCloudUrl } from './url.ts'

test('unset raw uses the baked-in default', () => {
  assert.equal(resolveCloudUrl(), DEFAULT_CLOUD_URL)
  assert.equal(resolveCloudUrl(undefined), DEFAULT_CLOUD_URL)
  assert.equal(resolveCloudUrl(null), DEFAULT_CLOUD_URL)
  assert.equal(resolveCloudUrl(''), DEFAULT_CLOUD_URL)
  assert.equal(resolveCloudUrl('   '), DEFAULT_CLOUD_URL)
})

test('off disables the cloud client', () => {
  assert.equal(resolveCloudUrl('off'), null)
  assert.equal(resolveCloudUrl('0'), null)
})

test('an explicit URL wins and strips a trailing slash', () => {
  assert.equal(resolveCloudUrl('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787')
  assert.equal(resolveCloudUrl('https://cloud.example.com'), 'https://cloud.example.com')
})

test('malformed URLs disable rather than half-attach', () => {
  assert.equal(resolveCloudUrl('not a url'), null)
  assert.equal(resolveCloudUrl('ftp://x.example'), null)
})

test('cloudWsUrl switches protocol and path', () => {
  assert.equal(
    cloudWsUrl('https://cloud.example.com'),
    'wss://cloud.example.com/api/machine/relay',
  )
  assert.equal(cloudWsUrl('http://127.0.0.1:3000'), 'ws://127.0.0.1:3000/api/machine/relay')
})
