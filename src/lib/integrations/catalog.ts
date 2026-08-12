/**
 * Provider catalog for the UI (no Node crypto / signature code).
 */
import type { IntegrationProviderId, ProviderMeta } from './types.ts'

export const INTEGRATION_PROVIDER_IDS = ['github', 'jira', 'linear'] as const

export function isIntegrationProviderId(value: string): value is IntegrationProviderId {
  return (INTEGRATION_PROVIDER_IDS as readonly string[]).includes(value)
}

/** Card / page title — GitHub's catalog label is the longer "GitHub Issues". */
export function providerPageTitle(id: IntegrationProviderId): string {
  return id === 'github' ? 'GitHub' : (providerMeta(id)?.label ?? id)
}

export const INTEGRATION_PROVIDERS: ProviderMeta[] = [
  {
    id: 'github',
    label: 'GitHub Issues',
    description: 'Open, edit, label, assign, close, and reopen issue events from a GitHub repo.',
    docsUrl: 'https://docs.github.com/en/webhooks/webhook-events-and-payloads#issues',
    events: [
      { id: 'issues.opened', label: 'Opened', description: 'A new issue was created' },
      { id: 'issues.edited', label: 'Edited', description: 'Issue title or body changed' },
      { id: 'issues.closed', label: 'Closed' },
      { id: 'issues.reopened', label: 'Reopened' },
      { id: 'issues.assigned', label: 'Assigned' },
      { id: 'issues.unassigned', label: 'Unassigned' },
      { id: 'issues.labeled', label: 'Labeled' },
      { id: 'issues.unlabeled', label: 'Unlabeled' },
      { id: 'issues.transferred', label: 'Transferred' },
      { id: 'issues.pinned', label: 'Pinned' },
      { id: 'issues.unpinned', label: 'Unpinned' },
      { id: 'issues.locked', label: 'Locked' },
      { id: 'issues.unlocked', label: 'Unlocked' },
      { id: 'issues.milestoned', label: 'Milestoned' },
      { id: 'issues.demilestoned', label: 'Demilestoned' },
      { id: 'issues.deleted', label: 'Deleted' },
    ],
    setupSteps: [
      'Click Install — Open Run uses your local `gh` login to create the webhook (no tokens to paste).',
      'Paste a public base URL if you are on localhost (Cloudflare Tunnel / ngrok).',
      'Pick the repo and events; we create a ready automation in the same step.',
    ],
  },
  {
    id: 'jira',
    label: 'Jira',
    description: 'Jira Cloud issue webhooks — status changes, create, update, assign, and more.',
    docsUrl: 'https://developer.atlassian.com/cloud/jira/platform/webhooks/',
    events: [
      { id: 'jira:issue_created', label: 'Created' },
      { id: 'jira:issue_updated', label: 'Updated' },
      { id: 'jira:issue_deleted', label: 'Deleted' },
      {
        id: 'jira:issue_status_changed',
        label: 'Status changed',
        description: 'Derived when changelog includes status',
      },
      {
        id: 'jira:issue_assigned',
        label: 'Assigned',
        description: 'Derived when assignee changes',
      },
      { id: 'comment_created', label: 'Comment created' },
      { id: 'comment_updated', label: 'Comment updated' },
      { id: 'comment_deleted', label: 'Comment deleted' },
      { id: 'worklog_created', label: 'Worklog created' },
      { id: 'worklog_updated', label: 'Worklog updated' },
      { id: 'worklog_deleted', label: 'Worklog deleted' },
    ],
    setupSteps: [
      'Click Install and paste your Jira site, Atlassian email, and an API token (used once, not stored).',
      'Paste a public base URL if you are on localhost (Cloudflare Tunnel / ngrok).',
      'Pick events; we register the webhook in Jira and create a ready automation.',
    ],
  },
  {
    id: 'linear',
    label: 'Linear',
    description: 'Linear issue create, update, remove, and status-change events.',
    docsUrl: 'https://linear.app/developers/webhooks',
    events: [
      { id: 'Issue.create', label: 'Created' },
      { id: 'Issue.update', label: 'Updated' },
      { id: 'Issue.remove', label: 'Removed' },
      {
        id: 'Issue.status_changed',
        label: 'Status changed',
        description: 'Derived when stateId changes on update',
      },
      {
        id: 'Issue.assigned',
        label: 'Assigned',
        description: 'Derived when assigneeId changes on update',
      },
      { id: 'Comment.create', label: 'Comment created' },
      { id: 'Comment.update', label: 'Comment updated' },
      { id: 'Comment.remove', label: 'Comment removed' },
      { id: 'Project.create', label: 'Project created' },
      { id: 'Project.update', label: 'Project updated' },
      { id: 'Cycle.create', label: 'Cycle created' },
      { id: 'Cycle.update', label: 'Cycle updated' },
    ],
    setupSteps: [
      'Click Install and paste a Linear personal API key (Settings → API — used once, not stored).',
      'Paste a public base URL if you are on localhost (Cloudflare Tunnel / ngrok).',
      'Pick events; we register the webhook in Linear and create a ready automation.',
    ],
  },
]

export function providerMeta(id: string): ProviderMeta | undefined {
  return INTEGRATION_PROVIDERS.find((p) => p.id === id)
}
