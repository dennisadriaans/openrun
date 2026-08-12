import type {
  CanonicalWebhookEvent,
  IntegrationProviderId,
  ProviderMeta,
} from '../../lib/integrations/types.ts'

export type WebhookVerifyInput = {
  rawBody: Buffer
  headers: Headers
  secret: string
  /** Parsed JSON when available (Linear timestamp checks). */
  payload?: unknown
}

export type WebhookParseInput = {
  rawBody: string
  headers: Headers
  payload: unknown
}

/**
 * Pluggable third-party webhook provider.
 *
 * Adding a new integration = implement this interface and register it in
 * `registry.ts`. The HTTP route and dispatcher stay unchanged.
 */
export type IntegrationProvider = ProviderMeta & {
  id: IntegrationProviderId
  verify(input: WebhookVerifyInput): boolean
  /**
   * Normalize a verified delivery into zero or more canonical events.
   * Return [] to acknowledge without acting (e.g. ping / unsupported type).
   */
  parse(input: WebhookParseInput): CanonicalWebhookEvent[]
}
