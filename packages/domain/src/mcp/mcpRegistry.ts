/**
 * The MCP library Open Run curates — known-good server configs, one click to
 * install.
 *
 * An entry is not a new kind of server: installing one builds the same
 * `McpServerConfig` the manual form does and puts it in the shared registry,
 * which fans it out to every CLI's own config. The catalog is data, so moving
 * it behind the control plane later changes where the array comes from and
 * nothing else.
 *
 * Browser-safe (the `lib/` rule).
 */
import type { McpServerConfig, McpTransportKind } from './mcp.ts'

/**
 * A credential the server needs.
 *
 * `env` lands in the spawned process's environment; `header` is sent on every
 * request, `Authorization` usually as `Bearer <token>` via `template`.
 */
export type RegistrySecret = {
  key: string
  label: string
  placement: 'env' | 'header'
  /** `$` is replaced with the value; defaults to the value itself. */
  template?: string
  hint?: string
  optional?: boolean
}

export type RegistryEntry = {
  id: string
  /** The server name written into every config — bare-key safe. */
  name: string
  summary: string
  transport: McpTransportKind
  command?: string
  args?: string[]
  url?: string
  secrets?: RegistrySecret[]
  docs?: string
  /**
   * `oauth` means the endpoint is OAuth-gated: there is no token to paste.
   * Installing writes the URL, then Open Run runs the browser flow once and
   * fans the bearer token out as an Authorization header.
   */
  auth?: 'oauth'
}

/**
 * Hosted servers are listed as `http`: every CLI we drive speaks streamable
 * HTTP, and the SSE endpoints these vendors also publish are the legacy leg.
 */
export const MCP_REGISTRY: readonly RegistryEntry[] = [
  {
    id: 'github',
    name: 'github',
    summary: 'Issues, pull requests, code search and Actions on GitHub.',
    transport: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    docs: 'https://github.com/github/github-mcp-server',
    secrets: [
      {
        key: 'GITHUB_PAT',
        label: 'Personal access token',
        placement: 'header',
        template: 'Bearer $',
        hint: 'github.com/settings/tokens — repo scope',
      },
    ],
  },
  {
    id: 'linear',
    auth: 'oauth',
    name: 'linear',
    summary: 'Read and update Linear issues, projects and cycles.',
    transport: 'http',
    url: 'https://mcp.linear.app/mcp',
    docs: 'https://linear.app/docs/mcp',
  },
  {
    id: 'sentry',
    auth: 'oauth',
    name: 'sentry',
    summary: 'Look up Sentry issues and stack traces for a failing run.',
    transport: 'http',
    url: 'https://mcp.sentry.dev/mcp',
    docs: 'https://docs.sentry.io/product/sentry-mcp/',
  },
  {
    id: 'notion',
    auth: 'oauth',
    name: 'notion',
    summary: 'Search and edit Notion pages and databases.',
    transport: 'http',
    url: 'https://mcp.notion.com/mcp',
    docs: 'https://developers.notion.com/docs/mcp',
  },
  {
    id: 'stripe',
    auth: 'oauth',
    name: 'stripe',
    summary: 'Query Stripe customers, subscriptions and payments.',
    transport: 'http',
    url: 'https://mcp.stripe.com',
    docs: 'https://docs.stripe.com/mcp',
  },
  {
    id: 'context7',
    name: 'context7',
    summary: 'Up-to-date library docs, so the agent stops guessing at APIs.',
    transport: 'http',
    url: 'https://mcp.context7.com/mcp',
    docs: 'https://context7.com',
    secrets: [
      {
        key: 'CONTEXT7_API_KEY',
        label: 'API key',
        placement: 'header',
        template: 'Bearer $',
        optional: true,
        hint: 'Optional — raises the rate limit',
      },
    ],
  },
  {
    id: 'playwright',
    name: 'playwright',
    summary: 'Drive a real browser: click, type, screenshot, read the DOM.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    docs: 'https://github.com/microsoft/playwright-mcp',
  },
  {
    id: 'cloudflare-docs',
    name: 'cloudflare-docs',
    summary: 'Search Cloudflare product documentation.',
    transport: 'http',
    url: 'https://docs.mcp.cloudflare.com/mcp',
    docs: 'https://developers.cloudflare.com/agents/model-context-protocol/',
  },
]

export function registryEntryById(id: string): RegistryEntry | undefined {
  return MCP_REGISTRY.find((entry) => entry.id === id)
}

/** The header a secret is sent on. Bearer tokens ride `Authorization`. */
function headerName(secret: RegistrySecret): string {
  return secret.template?.startsWith('Bearer') ? 'Authorization' : secret.key
}

/**
 * A blank value is written as `${KEY}` rather than dropped: every CLI expands
 * an environment reference at spawn time, so the user can keep the token in
 * their shell profile instead of in a config file on disk.
 */
function secretValue(secret: RegistrySecret, typed: string): string {
  const raw = typed.trim() || `\${${secret.key}}`
  return secret.template ? secret.template.replace('$', raw) : raw
}

export function registryEntryToServer(
  entry: RegistryEntry,
  values: Record<string, string> = {},
): McpServerConfig {
  const env: Record<string, string> = {}
  const headers: Record<string, string> = {}
  for (const secret of entry.secrets ?? []) {
    const typed = values[secret.key] ?? ''
    if (secret.optional && !typed.trim()) continue
    if (secret.placement === 'env') env[secret.key] = secretValue(secret, typed)
    else headers[headerName(secret)] = secretValue(secret, typed)
  }

  if (entry.transport === 'stdio') {
    return {
      name: entry.name,
      transport: 'stdio',
      command: entry.command ?? '',
      ...(entry.args && entry.args.length > 0 ? { args: entry.args } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    }
  }
  return {
    name: entry.name,
    transport: entry.transport,
    url: entry.url ?? '',
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  }
}

/** What the user has to supply before the entry works, in one phrase. */
export function registryEntryAuthLabel(entry: RegistryEntry): string {
  if (entry.auth === 'oauth') return 'Signs in on first use'
  const required = (entry.secrets ?? []).filter((secret) => !secret.optional)
  if (required.length > 0) return required.map((secret) => secret.label).join(', ')
  if ((entry.secrets ?? []).length > 0) return 'Optional API key'
  return 'No credentials'
}

/** One-line preview of what installing writes, for the library row. */
export function registryEntrySummary(entry: RegistryEntry): string {
  return entry.transport === 'stdio'
    ? [entry.command ?? '', ...(entry.args ?? [])].join(' ').trim()
    : (entry.url ?? '')
}
