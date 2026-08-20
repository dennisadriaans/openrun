import { ArrowUpRight } from 'lucide-react'
import type { IntegrationProviderId } from '../lib/integrations/types'
import { IntegrationBrandIcon } from './IntegrationCard'

/**
 * The ticket a webhook-triggered message came from.
 *
 * The link lives here rather than in the prompt: an agent that sees a bare URL
 * tries to open it and stalls, while a human still wants one click back to the
 * board. Stays visible instead of fading in with the copy button — it is the
 * only route back to the origin.
 */
export function MessageSourceBadge({
  provider,
  url,
  label,
}: {
  provider: string
  url: string
  label: string
}) {
  if (!url) return null

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={label ? `Open ${label}` : 'Open the source ticket'}
      className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <IntegrationBrandIcon id={provider as IntegrationProviderId} className="size-3" onDark />
      <span>{label || 'Open'}</span>
      <ArrowUpRight className="size-3" />
    </a>
  )
}
