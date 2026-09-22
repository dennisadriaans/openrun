import test from 'node:test'
import assert from 'node:assert/strict'

import { allowRemoteRequest, isLoopbackAddress, isMobileApiPath } from './loopback.ts'

test('the usual loopback forms are recognised', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('::1'), true)
})

test('the IPv4-mapped IPv6 form counts as loopback', () => {
  // What a dual-stack listener reports for a local connection — missing this
  // would lock the desktop browser out of its own app.
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
})

test('the whole 127.0.0.0/8 block is loopback', () => {
  assert.equal(isLoopbackAddress('127.0.0.53'), true)
  assert.equal(isLoopbackAddress('127.1.2.3'), true)
})

test('LAN and public addresses are not loopback', () => {
  for (const addr of ['192.168.1.24', '10.0.0.5', '172.16.0.1', '8.8.8.8', '::ffff:192.168.1.24']) {
    assert.equal(isLoopbackAddress(addr), false, addr)
  }
})

test('a missing address is not loopback', () => {
  assert.equal(isLoopbackAddress(undefined), false)
  assert.equal(isLoopbackAddress(null), false)
  assert.equal(isLoopbackAddress(''), false)
})

test('only the mobile API prefix matches', () => {
  assert.equal(isMobileApiPath('/api/mobile/me'), true)
  assert.equal(isMobileApiPath('/api/mobile/runs/run_1/stream'), true)
  assert.equal(isMobileApiPath('/api/mobile/me?x=1'), true)
  assert.equal(isMobileApiPath('/api/activity/stream'), false)
  assert.equal(isMobileApiPath('/'), false)
  assert.equal(isMobileApiPath('/api/mobile'), false, 'prefix must be a path segment')
})

test('dot-dot and encoded traversal are not the mobile API', () => {
  assert.equal(isMobileApiPath('/api/mobile/../api/runs/run_1/stream'), false)
  assert.equal(isMobileApiPath('/api/mobile/%2e%2e/api/runs/run_1/stream'), false)
  assert.equal(isMobileApiPath('/api/mobile/%2e%2e/%2e%2e/_serverFn/x'), false)
  assert.equal(isMobileApiPath('//api/mobile/me'), false)
})

test('a path that merely mentions the prefix later does not match', () => {
  assert.equal(isMobileApiPath('/_serverFn/x?next=/api/mobile/me'), false)
})

test('loopback is allowed regardless of feature state or path', () => {
  for (const mobileEnabled of [true, false]) {
    assert.equal(allowRemoteRequest({ address: '127.0.0.1', url: '/', mobileEnabled }), true)
    assert.equal(
      allowRemoteRequest({ address: '::1', url: '/_serverFn/writeWorkspaceFile', mobileEnabled }),
      true,
    )
  }
})

test('with the feature off, nothing remote gets through', () => {
  for (const url of ['/', '/api/mobile/me', '/_serverFn/addProject']) {
    assert.equal(
      allowRemoteRequest({ address: '192.168.1.50', url, mobileEnabled: false }),
      false,
      url,
    )
  }
})

test('with the feature on, a remote caller reaches only the mobile API', () => {
  const remote = '192.168.1.50'
  assert.equal(
    allowRemoteRequest({ address: remote, url: '/api/mobile/me', mobileEnabled: true }),
    true,
  )
  // The unauthenticated surfaces stay refused — this is the whole point.
  for (const url of [
    '/',
    '/devices',
    '/api/activity/stream',
    '/_serverFn/writeWorkspaceFile',
    '/_serverFn/addProject',
  ]) {
    assert.equal(allowRemoteRequest({ address: remote, url, mobileEnabled: true }), false, url)
  }
})
