import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { securityHeaders, shouldSendSecurityHeaders } from './securityHeaders.ts'

function csp(dev: boolean): string {
  return securityHeaders({ dev })['content-security-policy'] ?? ''
}

describe('securityHeaders', () => {
  it('sends the four headers every response should carry', () => {
    const headers = securityHeaders({ dev: false })
    assert.equal(headers['x-content-type-options'], 'nosniff')
    assert.equal(headers['referrer-policy'], 'no-referrer')
    assert.equal(headers['x-frame-options'], 'DENY')
    assert.ok(headers['content-security-policy'])
  })

  it('never sends HSTS, which would break every other localhost dev server', () => {
    assert.equal(securityHeaders({ dev: false })['strict-transport-security'], undefined)
  })
})

describe('content security policy', () => {
  it('confines the page to its own origin', () => {
    assert.match(csp(false), /default-src 'self'/)
  })

  it('stops injected script from reaching another host', () => {
    // The one directive that still helps when escaping has already failed.
    assert.match(csp(false), /connect-src 'self'/)
  })

  it('closes the classic escapes', () => {
    const policy = csp(false)
    assert.match(policy, /object-src 'none'/)
    assert.match(policy, /base-uri 'self'/)
    assert.match(policy, /frame-ancestors 'none'/)
    assert.match(policy, /form-action 'self'/)
  })

  it('allows the data and blob URLs the app builds itself', () => {
    // QR codes for device pairing, composer image attachments.
    assert.match(csp(false), /img-src 'self' data: blob:/)
  })

  it('keeps the framework hydration payload working', () => {
    assert.match(csp(false), /script-src [^;]*'unsafe-inline'/)
  })

  it('never ships the dev-only allowances to production', () => {
    const production = csp(false)
    assert.doesNotMatch(production, /unsafe-eval/)
    assert.doesNotMatch(production, /ws:/)
  })

  it('lets the vite dev client work in development', () => {
    const development = csp(true)
    assert.match(development, /script-src [^;]*'unsafe-eval'/)
    assert.match(development, /connect-src [^;]*ws:/)
  })
})

describe('shouldSendSecurityHeaders', () => {
  it('skips a live event stream', () => {
    assert.equal(shouldSendSecurityHeaders('text/event-stream'), false)
    assert.equal(shouldSendSecurityHeaders('text/event-stream; charset=utf-8'), false)
  })

  it('covers documents, json and everything without a type', () => {
    assert.equal(shouldSendSecurityHeaders('text/html'), true)
    assert.equal(shouldSendSecurityHeaders('application/json'), true)
    assert.equal(shouldSendSecurityHeaders(null), true)
    assert.equal(shouldSendSecurityHeaders(undefined), true)
  })
})
