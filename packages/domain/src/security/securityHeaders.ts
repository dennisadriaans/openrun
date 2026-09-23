/**
 * Response headers sent in front of every page and API route.
 *
 * Open Run renders a great deal of text it did not write: assistant prose,
 * command output, tool results, file diffs, branch and PR titles pulled from
 * `gh`. React escapes it, but "we escape everything correctly, everywhere,
 * forever" is not a security boundary — a content policy is the second lock,
 * and the one that turns a missed escape from "runs arbitrary script in a page
 * that can spawn CLIs as you" into a blocked console message.
 *
 * The policy that earns its keep here is `connect-src 'self'`: even if
 * something did execute, it cannot post your source code to another host.
 * `object-src`, `base-uri` and `frame-ancestors` close the other classic
 * escapes. `script-src` still needs `'unsafe-inline'` — the framework inlines
 * the hydration payload — so this is defence in depth, not a claim that XSS is
 * impossible.
 *
 * Pure and browser-safe: the rule lives here, `src/start.ts` applies it.
 */

/**
 * Dev needs two extra allowances that must never reach production: Vite's HMR
 * client evaluates code, and it talks to the dev server over a websocket.
 */
export type SecurityHeaderOptions = {
  dev: boolean
}

function contentSecurityPolicy(options: SecurityHeaderOptions): string {
  const scriptSrc = ["'self'", "'unsafe-inline'"]
  const connectSrc = ["'self'"]

  if (options.dev) {
    // Vite's HMR client. Both are development-only on purpose.
    scriptSrc.push("'unsafe-eval'")
    connectSrc.push('ws:', 'wss:')
  }

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    // Tailwind and the theme tokens set inline styles.
    "style-src 'self' 'unsafe-inline'",
    // Icons are bundled; QR codes and composer attachments are data/blob URLs.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(' ')}`,
    // Nothing in the app embeds or is embedded.
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

/**
 * The headers to add to a response.
 *
 * Deliberately does not include HSTS: Open Run is served over plain HTTP on
 * loopback by default, and an HSTS header pinned to `localhost` would break
 * every other local development server on the machine.
 */
export function securityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  return {
    'content-security-policy': contentSecurityPolicy(options),
    // The attachment route serves bytes from inside a workspace; never let a
    // browser decide those are something more exciting than their declared type.
    'x-content-type-options': 'nosniff',
    // The access token can ride in a URL for one request before the redirect
    // strips it. It must not leave in a Referer.
    'referrer-policy': 'no-referrer',
    // Belt and braces with frame-ancestors, for anything that predates CSP.
    'x-frame-options': 'DENY',
  }
}

/**
 * Whether this response should carry them.
 *
 * Server-sent events are long-lived and never parsed as a document, and adding
 * headers to a stream that is already flowing is pointless work per event.
 */
export function shouldSendSecurityHeaders(contentType: string | null | undefined): boolean {
  return !(contentType ?? '').toLowerCase().includes('text/event-stream')
}
