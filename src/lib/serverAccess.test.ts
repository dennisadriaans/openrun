import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ACCESS_TOKEN_COOKIE,
  accessCookieHeader,
  DEFAULT_HOST,
  hostHeaderRefusal,
  hostnameFromHostHeader,
  insecureHostWarning,
  isDocumentRequest,
  isLoopbackHost,
  parseAllowedHosts,
  serverBindRefusal,
  tokenRequiredForRequests,
  tokensMatch,
  unauthorizedMessage,
  urlWithoutAccessToken,
} from './serverAccess.ts'

test('loopback addresses are recognized in every spelling', () => {
  for (const host of [
    '127.0.0.1',
    '127.0.0.53',
    '127.255.255.254',
    'localhost',
    'LOCALHOST',
    '  127.0.0.1  ',
    'app.localhost',
    '::1',
    '[::1]',
    '0:0:0:0:0:0:0:1',
    '::ffff:127.0.0.1',
    '',
    DEFAULT_HOST,
  ]) {
    assert.equal(isLoopbackHost(host), true, `${host} should be loopback`)
  }
})

test('wildcard and routable addresses are not loopback', () => {
  for (const host of [
    '0.0.0.0',
    '::',
    '[::]',
    '192.168.1.10',
    '10.0.0.4',
    '128.0.0.1',
    '126.0.0.1',
    'example.com',
    '::ffff:192.168.1.10',
    '[bad',
  ]) {
    assert.equal(isLoopbackHost(host), false, `${host} should not be loopback`)
  }
})

test('malformed IPv4 is not mistaken for loopback', () => {
  for (const host of ['127.0.0.256', '127.0.0', '127.0.0.1.1', '127.a.b.c']) {
    assert.equal(isLoopbackHost(host), false, `${host} should not be loopback`)
  }
})

test('loopback binds without a token', () => {
  assert.equal(
    serverBindRefusal({ host: '127.0.0.1', hasToken: false, allowInsecureHost: false }),
    null,
  )
})

test('a non-loopback bind with no token is refused', () => {
  const refusal = serverBindRefusal({
    host: '0.0.0.0',
    hasToken: false,
    allowInsecureHost: false,
  })
  assert.ok(refusal, 'expected a refusal')
  assert.match(refusal, /0\.0\.0\.0/)
  assert.match(refusal, /OPENRUN_ACCESS_TOKEN/)
})

test('a token, or the explicit override, unblocks a non-loopback bind', () => {
  assert.equal(
    serverBindRefusal({ host: '0.0.0.0', hasToken: true, allowInsecureHost: false }),
    null,
  )
  assert.equal(
    serverBindRefusal({ host: '0.0.0.0', hasToken: false, allowInsecureHost: true }),
    null,
  )
})

test('a loopback bind never warns', () => {
  assert.equal(
    insecureHostWarning({ host: '127.0.0.1', hasToken: false, allowInsecureHost: false }),
    null,
  )
  assert.equal(
    insecureHostWarning({ host: 'localhost', hasToken: true, allowInsecureHost: false }),
    null,
  )
})

test('the override warns loudly that there is no token', () => {
  const warning = insecureHostWarning({
    host: '0.0.0.0',
    hasToken: false,
    allowInsecureHost: true,
  })
  assert.ok(warning)
  assert.match(warning, /NO access token/)
})

test('a token-protected non-loopback bind still warns', () => {
  const warning = insecureHostWarning({
    host: '10.0.0.4',
    hasToken: true,
    allowInsecureHost: false,
  })
  assert.ok(warning)
  assert.match(warning, /access token/)
})

test('requests are checked exactly when a token is configured', () => {
  assert.equal(
    tokenRequiredForRequests({ host: '127.0.0.1', hasToken: true, allowInsecureHost: false }),
    true,
    'a token set on loopback is still enforced',
  )
  assert.equal(
    tokenRequiredForRequests({ host: '127.0.0.1', hasToken: false, allowInsecureHost: false }),
    false,
  )
  assert.equal(
    tokenRequiredForRequests({ host: '0.0.0.0', hasToken: false, allowInsecureHost: true }),
    false,
    'the override deliberately leaves requests unchecked',
  )
})

test('tokens match only when identical', () => {
  assert.equal(tokensMatch('s3cret', 's3cret'), true)
  assert.equal(tokensMatch('s3cret', 's3creT'), false)
  assert.equal(tokensMatch('s3cret', 's3cre'), false)
  assert.equal(tokensMatch('s3cret', 's3cret '), false)
})

test('an empty or missing token never matches', () => {
  assert.equal(tokensMatch('', ''), false, 'an unset token must not admit an empty header')
  assert.equal(tokensMatch('s3cret', null), false)
  assert.equal(tokensMatch('s3cret', undefined), false)
  assert.equal(tokensMatch('s3cret', ''), false)
})

test('a Host header is reduced to its hostname', () => {
  assert.equal(hostnameFromHostHeader('localhost:3000'), 'localhost')
  assert.equal(hostnameFromHostHeader('127.0.0.1:3000'), '127.0.0.1')
  assert.equal(hostnameFromHostHeader('127.0.0.1'), '127.0.0.1')
  assert.equal(hostnameFromHostHeader('  Evil.Example:8080 '), 'evil.example')
  assert.equal(hostnameFromHostHeader('[::1]:3000'), '::1')
  assert.equal(hostnameFromHostHeader('[::1]'), '::1')

  // A bare IPv6 literal is not a hostname with a port.
  assert.equal(hostnameFromHostHeader('::1'), '::1')

  assert.equal(hostnameFromHostHeader(''), null)
  assert.equal(hostnameFromHostHeader(null), null)
  assert.equal(hostnameFromHostHeader(undefined), null)
  assert.equal(hostnameFromHostHeader('[::1'), null)
})

const loopbackBind = { host: '127.0.0.1', hasToken: false, allowInsecureHost: false }

test('a loopback bind answers only to loopback names', () => {
  for (const header of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'app.localhost']) {
    assert.equal(hostHeaderRefusal(loopbackBind, header), null, `${header} should be allowed`)
  }
})

test('a rebound hostname is refused even with no token configured', () => {
  const refusal = hostHeaderRefusal(loopbackBind, 'evil.example:3000')
  assert.ok(refusal, 'expected a refusal')
  assert.match(refusal, /evil\.example/)
  assert.match(refusal, /OPENRUN_ALLOWED_HOSTS/)

  // A token does not change the answer: the guard runs before it.
  assert.ok(hostHeaderRefusal({ ...loopbackBind, hasToken: true }, 'evil.example'))
})

test('a request with no Host header is refused', () => {
  assert.ok(hostHeaderRefusal(loopbackBind, null))
  assert.ok(hostHeaderRefusal(loopbackBind, ''))
})

test('explicitly allowed hostnames pass the rebinding guard', () => {
  const config = {
    ...loopbackBind,
    allowedHosts: parseAllowedHosts('tunnel.example, Other.Test:443'),
  }
  assert.equal(hostHeaderRefusal(config, 'tunnel.example:3000'), null)
  assert.equal(hostHeaderRefusal(config, 'other.test'), null)
  assert.ok(hostHeaderRefusal(config, 'evil.example'))
})

test('allowed-host lists are parsed leniently', () => {
  assert.deepEqual(parseAllowedHosts('a.test, b.test:8080 ,,'), ['a.test', 'b.test'])
  assert.deepEqual(parseAllowedHosts(''), [])
  assert.deepEqual(parseAllowedHosts(undefined), [])
})

test('a published bind is not host-checked — it has names we cannot enumerate', () => {
  assert.equal(
    hostHeaderRefusal({ host: '0.0.0.0', hasToken: true, allowInsecureHost: false }, 'laptop.lan'),
    null,
    'a token already protects a published bind against a rebound page',
  )
  assert.equal(
    hostHeaderRefusal(
      { host: '127.0.0.1', hasToken: false, allowInsecureHost: true },
      'evil.example',
    ),
    null,
    'the explicit override opts out of this guard too',
  )
})

test('the token cookie is scoped to the whole app and hidden from scripts', () => {
  const cookie = accessCookieHeader('abc123', false)

  assert.match(cookie, new RegExp(`^${ACCESS_TOKEN_COOKIE}=abc123;`))
  assert.match(cookie, /Path=\//)
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Lax/)
  assert.match(cookie, /Max-Age=\d+/)

  // No `Secure` over plain HTTP: loopback is http, and a Secure cookie there
  // is one the browser silently refuses to store.
  assert.doesNotMatch(cookie, /Secure/)
  assert.match(accessCookieHeader('abc123', true), /; Secure$/)
})

test('a token with cookie-hostile characters survives the round trip', () => {
  assert.match(accessCookieHeader('a b;c', false), /^openrun_token=a%20b%3Bc;/)
})

test('the token is stripped from a URL without disturbing the rest of it', () => {
  assert.equal(
    urlWithoutAccessToken('http://127.0.0.1:3000/runs/1?openrun_token=abc&tab=diff#top'),
    '/runs/1?tab=diff#top',
  )
  assert.equal(urlWithoutAccessToken('http://127.0.0.1:3000/?openrun_token=abc'), '/')
  assert.equal(urlWithoutAccessToken('http://127.0.0.1:3000/?agentops_token=abc'), '/')
})

test('a URL carrying no token needs no redirect', () => {
  assert.equal(urlWithoutAccessToken('http://127.0.0.1:3000/runs/1?tab=diff'), null)
  assert.equal(urlWithoutAccessToken('not a url'), null)
})

test('only a page load is redirected to a clean URL', () => {
  assert.equal(isDocumentRequest('GET', 'text/html,application/xhtml+xml'), true)
  assert.equal(isDocumentRequest('get', 'text/html'), true)

  // An EventSource reconnect carries the same query parameter and must be
  // answered rather than bounced — a 303 is not a stream.
  assert.equal(isDocumentRequest('GET', 'text/event-stream'), false)
  assert.equal(isDocumentRequest('POST', 'text/html'), false)
  assert.equal(isDocumentRequest('GET', null), false)
})

test('the 401 tells the caller how to authenticate', () => {
  const message = unauthorizedMessage()

  assert.match(message, /pnpm token:print/)
  assert.match(message, /openrun_token=/)
  assert.match(message, /x-openrun-token/)
})
