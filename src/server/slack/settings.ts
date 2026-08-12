/**
 * Slack connection settings.
 *
 * Unlike integrations — one row per repo/webhook — Slack is a *singleton*
 * connection for the whole machine, so it lives as one JSON blob in `app_meta`
 * rather than earning a table.
 *
 * Tokens are stored as the user pasted them, consistent with how integration
 * webhook secrets are already held: this is a local-first app whose SQLite file
 * is git-ignored and sits under the user's own home directory. What we do *not*
 * do is let them back out — `publicSettings()` redacts, and that is the only
 * shape the server functions return to the browser.
 */
import { emptySlackSettings, type SlackSettings } from '../../lib/slack/types.ts'
import { normalizeUserIds } from '../../lib/slack/gate.ts'
import { getDb } from '../db.ts'

const META_KEY = 'slack_settings_v1'

export function getSlackSettings(): SlackSettings {
  const row = getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(META_KEY) as
    | { value: string }
    | undefined
  if (!row?.value) return emptySlackSettings()
  try {
    const parsed = JSON.parse(row.value) as Partial<SlackSettings>
    return emptySlackSettings({
      ...parsed,
      allowedUserIds: normalizeUserIds(parsed.allowedUserIds),
    })
  } catch {
    // A hand-edited or truncated blob must not brick startup.
    return emptySlackSettings()
  }
}

export type SlackSettingsInput = Partial<
  Omit<SlackSettings, 'allowedUserIds'> & { allowedUserIds: string[] | string }
>

/**
 * Merge a patch over the stored settings.
 *
 * A token field that arrives empty is treated as "unchanged", so the settings
 * form can render a redacted placeholder and still save the other fields
 * without wiping the credential behind it.
 */
export function saveSlackSettings(input: SlackSettingsInput): SlackSettings {
  const current = getSlackSettings()
  const next: SlackSettings = {
    ...current,
    botToken: keepSecret(input.botToken, current.botToken),
    appToken: keepSecret(input.appToken, current.appToken),
    signingSecret: keepSecret(input.signingSecret, current.signingSecret),
    channelId: input.channelId?.trim() ?? current.channelId,
    allowedUserIds:
      input.allowedUserIds === undefined
        ? current.allowedUserIds
        : normalizeUserIds(
            Array.isArray(input.allowedUserIds) ? input.allowedUserIds : [input.allowedUserIds],
          ),
    notifyOnFinish: input.notifyOnFinish ?? current.notifyOnFinish,
    notifyOnApproval: input.notifyOnApproval ?? current.notifyOnApproval,
    enabled: input.enabled ?? current.enabled,
  }

  getDb()
    .prepare(
      `INSERT INTO app_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(META_KEY, JSON.stringify(next))

  return next
}

function keepSecret(incoming: string | undefined, current: string): string {
  const trimmed = incoming?.trim()
  if (trimmed === undefined) return current
  if (trimmed === '') return current
  // Explicit clear, so a rotated-out token can still be removed on purpose.
  if (trimmed === CLEAR_SENTINEL) return ''
  return trimmed
}

/** Type this into a token field to actually blank it. */
export const CLEAR_SENTINEL = '-'

export type SlackSettingsPublic = {
  hasBotToken: boolean
  hasAppToken: boolean
  hasSigningSecret: boolean
  channelId: string
  allowedUserIds: string[]
  notifyOnFinish: boolean
  notifyOnApproval: boolean
  enabled: boolean
}

/** The only settings shape that may cross into the browser. */
export function publicSettings(settings = getSlackSettings()): SlackSettingsPublic {
  return {
    hasBotToken: settings.botToken.length > 0,
    hasAppToken: settings.appToken.length > 0,
    hasSigningSecret: settings.signingSecret.length > 0,
    channelId: settings.channelId,
    allowedUserIds: settings.allowedUserIds,
    notifyOnFinish: settings.notifyOnFinish,
    notifyOnApproval: settings.notifyOnApproval,
    enabled: settings.enabled,
  }
}

/** Where run links in Slack messages point. Same env var the notifiers use. */
export function appBaseUrl(): string {
  return process.env.AGENTOPS_BASE_URL || 'http://localhost:3000'
}
