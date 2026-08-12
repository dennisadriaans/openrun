/**
 * Who may drive this machine from Slack (browser-safe).
 *
 * This is the most security-relevant module in the integration. A run executes
 * real commands in a real repo with the user's own credentials, and some
 * runtimes pass `--dangerously-skip-permissions` — so a Slack message that
 * reaches `runTaskNow` is remote code execution by design.
 *
 * Therefore: **default deny**. An empty allowlist authorises nobody, not
 * everybody. Slack workspaces have guests, shared channels and apps that can
 * post on a user's behalf; "anyone in the workspace" is not an access policy.
 *
 * Same shape as the other gate modules (`lib/runNowGate.ts` and friends): it
 * returns the refusal *string*, so the settings UI can explain the lockout with
 * the exact words the server would answer with.
 */
import type { SlackSettings } from './types.ts'

export type SlackAuthInput = {
  userId: string
  /** Slack sets this on messages posted by an app rather than a person. */
  botId?: string
  channelId?: string
  settings: Pick<SlackSettings, 'allowedUserIds' | 'enabled'>
}

/**
 * Why this Slack message may not steer anything, or null when it may.
 */
export function slackAuthRefusal(input: SlackAuthInput): string | null {
  if (!input.settings.enabled) {
    return 'Slack control is turned off in Open Run → Settings.'
  }

  // Never act on something another app said. Without this a bot that echoes
  // messages into the channel could replay commands back at us.
  if (input.botId) {
    return 'Commands from apps are ignored — only people can steer runs.'
  }

  const userId = input.userId?.trim()
  if (!userId) return 'Could not tell who sent this message.'

  const allowed = normalizeUserIds(input.settings.allowedUserIds)
  if (allowed.length === 0) {
    return 'No Slack users are allowed to control runs yet. Add your Slack member ID in Open Run → Settings → Slack.'
  }
  if (!allowed.includes(userId.toUpperCase())) {
    return `${userId} is not on the Open Run allowlist.`
  }

  return null
}

export function isSlackUserAllowed(input: SlackAuthInput): boolean {
  return slackAuthRefusal(input) === null
}

/**
 * Slack member ids are case-insensitive in practice and users paste them with
 * stray `@`, angle brackets or commas. Normalize once, compare exactly.
 */
export function normalizeUserIds(ids: readonly string[] | undefined): string[] {
  if (!ids) return []
  const seen = new Set<string>()
  for (const raw of ids) {
    for (const part of String(raw).split(/[,\s]+/)) {
      const id = part
        .replace(/[<>@|]/g, '')
        .trim()
        .toUpperCase()
      // Member ids start with U (person) or W (Enterprise Grid person).
      if (/^[UW][A-Z0-9]{4,}$/.test(id)) seen.add(id)
    }
  }
  return [...seen]
}

/** Is this connection complete enough to open a Socket Mode session? */
export function slackConfigRefusal(settings: SlackSettings): string | null {
  if (!settings.botToken.trim()) return 'Add a bot token (starts with xoxb-).'
  if (!settings.botToken.trim().startsWith('xoxb-')) {
    return 'That does not look like a bot token — it should start with xoxb-.'
  }
  if (!settings.appToken.trim()) {
    return 'Add an app-level token (starts with xapp-) so Open Run can open a Socket Mode connection.'
  }
  if (!settings.appToken.trim().startsWith('xapp-')) {
    return 'That does not look like an app-level token — it should start with xapp-.'
  }
  if (normalizeUserIds(settings.allowedUserIds).length === 0) {
    return 'Add at least one Slack member ID to the allowlist — an empty allowlist blocks everyone.'
  }
  return null
}
