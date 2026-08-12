/**
 * Shared shell for Slack and webhook provider pages — same width, header, and
 * status banner so install/detail does not fork per integration.
 */
import type { ReactNode } from 'react'
import { PageHeader } from './ui'

export function IntegrationPage({
  title,
  actions,
  children,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <PageHeader title={title} actions={actions} />
      {children}
    </div>
  )
}

export function IntegrationStatusBanner({
  tone,
  text,
}: {
  tone: 'good' | 'bad' | 'idle'
  text: string
}) {
  return (
    <div
      className={`mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-ui-sm ${
        tone === 'bad' ? 'border-danger text-danger' : 'border-[var(--border-quaternary)] text-tier-secondary'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          tone === 'good' ? 'bg-success' : tone === 'bad' ? 'bg-danger' : 'bg-[var(--border-strong)]'
        }`}
      />
      <span>{text}</span>
    </div>
  )
}
