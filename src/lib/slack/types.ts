/**
 * Shared Slack control-surface types (browser-safe).
 *
 * Slack is not a webhook *source* like GitHub / Jira / Linear — nothing here
 * normalizes into `CanonicalWebhookEvent`. It is a two-way control surface: a
 * phone asks the desktop what is running and steers it. So it gets its own
 * vocabulary — an intent parsed from text, and a result rendered back as
 * Block Kit — instead of being bent into the `IntegrationProvider` shape.
 */

/** What the user asked for, parsed out of Slack text. */
export type SlackIntent =
  | { kind: 'help' }
  | { kind: 'status' }
  | { kind: 'runs'; filter: RunsFilter; limit: number }
  | { kind: 'run_detail'; ref: string }
  | { kind: 'logs'; ref: string }
  | { kind: 'diff'; ref: string }
  | { kind: 'automations' }
  | { kind: 'run_now'; ref: string }
  | { kind: 'set_enabled'; ref: string; enabled: boolean }
  | { kind: 'cancel'; ref: string }
  | { kind: 'say'; ref: string; text: string }
  | { kind: 'approve'; ref: string; decision: 'allow' | 'deny' }
  /** Text arrived with no verb and no run thread to attach it to. */
  | { kind: 'unknown'; input: string }
  /** A verb that needs a target got none (e.g. bare `cancel`). */
  | { kind: 'needs_ref'; verb: string; hint: string }

export type RunsFilter = 'active' | 'all' | 'failed'

/** Where a piece of Slack text came from. */
export type SlackSource = 'slash' | 'mention' | 'dm' | 'thread'

export type ParseCommandInput = {
  text: string
  /**
   * Run this thread is bound to, when the message landed in a run thread.
   * Makes a bare "keep going, but skip the tests" a follow-up turn — the
   * whole point of steering from a phone.
   */
  threadRunId?: string
  source?: SlackSource
}

/** Interactive component ids, kept in one place so button ↔ handler can't drift. */
export const SLACK_ACTIONS = {
  cancelRun: 'agentops_cancel_run',
  approve: 'agentops_approve',
  deny: 'agentops_deny',
  runNow: 'agentops_run_now',
  refreshRun: 'agentops_refresh_run',
} as const

export type SlackActionId = (typeof SLACK_ACTIONS)[keyof typeof SLACK_ACTIONS]

/** Connection settings the gate and the transport both read. */
export type SlackSettings = {
  /** `xoxb-…` bot token — every Web API call. */
  botToken: string
  /** `xapp-…` app-level token — opens the Socket Mode websocket. */
  appToken: string
  /** Signing secret — only used by the HTTP fallback route. */
  signingSecret: string
  /** Channel that receives unsolicited run announcements. */
  channelId: string
  /** Slack user ids allowed to drive runs. Empty = nobody (default deny). */
  allowedUserIds: string[]
  /** Announce runs when they finish. */
  notifyOnFinish: boolean
  /** Announce supervised tool approvals (they auto-deny in 5 minutes). */
  notifyOnApproval: boolean
  /** Master switch for the Socket Mode connection. */
  enabled: boolean
}

export function emptySlackSettings(partial?: Partial<SlackSettings>): SlackSettings {
  return {
    botToken: '',
    appToken: '',
    signingSecret: '',
    channelId: '',
    allowedUserIds: [],
    notifyOnFinish: true,
    notifyOnApproval: true,
    enabled: false,
    ...partial,
  }
}

/** Connection state surfaced on the settings page. */
export type SlackConnectionStatus = {
  configured: boolean
  enabled: boolean
  connected: boolean
  /** `socket` once the websocket is up; `http` when only the fallback exists. */
  transport: 'socket' | 'http' | 'none'
  teamName: string
  botUserId: string
  lastError: string
  lastConnectedAt: number | null
  allowedUserCount: number
}
