import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { McpServerConfig } from './mcp.ts'
import {
  TOKEN_REFRESH_SKEW_MS,
  authServerMetadataUrls,
  findAuthHeader,
  maskToken,
  mcpOAuthRedirectUri,
  mcpOAuthRefusal,
  mcpOAuthStateLabel,
  needsRefresh,
  protectedResourceUrls,
  withAuthHeader,
} from './mcpOAuth.ts'

const http = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({
  name: 'stripe',
  transport: 'http',
  url: 'https://mcp.stripe.com',
  ...over,
})

describe('protectedResourceUrls', () => {
  it('inserts the well-known segment before Linear /mcp (RFC 9728)', () => {
    assert.deepEqual(protectedResourceUrls('https://mcp.linear.app/mcp'), [
      'https://mcp.linear.app/.well-known/oauth-protected-resource/mcp',
      'https://mcp.linear.app/.well-known/oauth-protected-resource',
    ])
  })

  it('keeps a root-mounted server (Stripe) on the bare well-known path', () => {
    assert.deepEqual(protectedResourceUrls('https://mcp.stripe.com'), [
      'https://mcp.stripe.com/.well-known/oauth-protected-resource',
    ])
  })

  it('strips a trailing slash so /mcp/ matches /mcp', () => {
    assert.deepEqual(
      protectedResourceUrls('https://mcp.linear.app/mcp/'),
      protectedResourceUrls('https://mcp.linear.app/mcp'),
    )
  })

  it('returns nothing for a non-URL', () => {
    assert.deepEqual(protectedResourceUrls('not a url'), [])
    assert.deepEqual(protectedResourceUrls(''), [])
  })
})

describe('authServerMetadataUrls', () => {
  it('puts Stripe /mcp issuer on the RFC 8414 path-aware URL first', () => {
    assert.deepEqual(authServerMetadataUrls('https://mcp.stripe.com/mcp'), [
      'https://mcp.stripe.com/.well-known/oauth-authorization-server/mcp',
      'https://mcp.stripe.com/.well-known/openid-configuration/mcp',
      'https://mcp.stripe.com/mcp/.well-known/oauth-authorization-server',
      'https://mcp.stripe.com/mcp/.well-known/openid-configuration',
      'https://mcp.stripe.com/.well-known/oauth-authorization-server',
    ])
  })

  it('does not invent a path for an origin-only issuer', () => {
    assert.deepEqual(authServerMetadataUrls('https://mcp.stripe.com'), [
      'https://mcp.stripe.com/.well-known/oauth-authorization-server',
      'https://mcp.stripe.com/.well-known/openid-configuration',
    ])
  })

  it('returns nothing for a non-URL', () => {
    assert.deepEqual(authServerMetadataUrls('://bad'), [])
  })
})

describe('needsRefresh', () => {
  const now = 1_700_000_000_000

  it('leaves a token with no stated lifetime alone', () => {
    assert.equal(needsRefresh(0, now), false)
    assert.equal(needsRefresh(-1, now), false)
  })

  it('refreshes inside the skew window and not before', () => {
    assert.equal(needsRefresh(now + TOKEN_REFRESH_SKEW_MS, now), true)
    assert.equal(needsRefresh(now + TOKEN_REFRESH_SKEW_MS + 1, now), false)
    assert.equal(needsRefresh(now - 1, now), true)
  })
})

describe('withAuthHeader', () => {
  it('writes Authorization: Bearer and drops any previous casing of that header', () => {
    const next = withAuthHeader(
      http({ headers: { authorization: 'Bearer old', 'X-Extra': '1' } }),
      'fresh',
    )
    assert.deepEqual(next.headers, { 'X-Extra': '1', Authorization: 'Bearer fresh' })
  })

  it('strips a managed header when the token is cleared', () => {
    const next = withAuthHeader(http({ headers: { Authorization: 'Bearer x' } }), '')
    assert.equal(next.headers, undefined)
  })
})

describe('findAuthHeader', () => {
  it('matches Authorization regardless of casing', () => {
    assert.equal(findAuthHeader(http({ headers: { AUTHORIZATION: 'Bearer x' } })), 'Bearer x')
    assert.equal(findAuthHeader(http()), '')
  })
})

describe('mcpOAuthRefusal', () => {
  it('refuses a stdio server', () => {
    assert.match(
      mcpOAuthRefusal({ name: 'playwright', transport: 'stdio', command: 'npx' }, false) ?? '',
      /stdio/,
    )
  })

  it('refuses a hosted server with no URL', () => {
    assert.match(mcpOAuthRefusal(http({ url: '' }), false) ?? '', /no URL/)
    assert.match(mcpOAuthRefusal(http({ url: '   ' }), false) ?? '', /no URL/)
  })

  it('refuses a handwritten Authorization header unless Open Run already owns it', () => {
    const handwritten = http({ headers: { Authorization: 'Bearer pat' } })
    assert.match(mcpOAuthRefusal(handwritten, false) ?? '', /by hand/)
    assert.equal(mcpOAuthRefusal(handwritten, true), null)
  })

  it('allows a clean hosted server', () => {
    assert.equal(mcpOAuthRefusal(http(), false), null)
  })
})

describe('mcpOAuthRedirectUri', () => {
  it('lands on the callback route and strips a trailing slash on the origin', () => {
    assert.equal(
      mcpOAuthRedirectUri('http://127.0.0.1:3000/'),
      'http://127.0.0.1:3000/api/mcp/oauth/callback',
    )
  })
})

describe('mcpOAuthStateLabel', () => {
  it('names each stored state for the chip', () => {
    const base = { name: 'stripe', issuer: '', scope: '', expiresAt: 0 }
    assert.equal(mcpOAuthStateLabel({ ...base, state: 'connected' }), 'Connected')
    assert.equal(mcpOAuthStateLabel({ ...base, state: 'expired' }), 'Session expired')
    assert.equal(mcpOAuthStateLabel({ ...base, state: 'pending' }), 'Waiting for the browser…')
    assert.equal(mcpOAuthStateLabel({ ...base, state: 'none' }), 'Not connected')
  })
})

describe('maskToken', () => {
  it('keeps the ends and hides the middle', () => {
    assert.equal(maskToken(''), '')
    assert.equal(maskToken('sk_live_abcdefghij'), 'sk_liv…ghij')
  })
})
