/**
 * One-click integration install: create local connection → register remote
 * webhook (gh / Linear API / Jira API) → optionally create a wired automation.
 *
 * Credentials are one-shot (never written to SQLite). No Open Run env vars.
 */
import {
  defaultAutomationName,
  defaultAutomationPrompt,
  defaultInstallEvents,
  githubHookEventsFromCatalog,
  jiraRemoteEventsFromCatalog,
  linearResourceTypesFromCatalog,
  parseGithubOwnerRepo,
  remoteInstallBaseUrl,
  type InstallIntegrationInput,
} from '../../lib/integrations/install.ts'
import type { IntegrationProviderId } from '../../lib/integrations/types.ts'
import { providerMeta } from '../../lib/integrations/catalog.ts'
import { checkRuntimeInstalled } from '../runtimePath.ts'
import { getDb, type RuntimeRow } from '../db.ts'
import { ghStatus } from '../git.ts'
import { listProjects } from '../workspaces.ts'
import {
  createIntegration,
  deleteIntegration,
  getIntegration,
  updateIntegration,
  webhookPathFor,
  type IntegrationPublic,
} from './connections.ts'
import {
  createGithubWebhookViaGh,
  deleteGithubWebhookViaGh,
  listGithubReposViaGh,
} from './githubInstall.ts'
import { createJiraWebhook, normalizeJiraSiteUrl } from './jiraInstall.ts'
import { createLinearWebhook } from './linearInstall.ts'

export type IntegrationConfig = {
  installMethod?: 'api' | 'manual' | 'hosted'
  publicBaseUrl?: string
  remoteWebhookId?: string
  cloudConnectionId?: string
  github?: { owner: string; repo: string }
  jira?: { siteUrl: string; jql?: string }
  linear?: { label?: string }
  installedAt?: number
}

export type InstallIntegrationResult = {
  integration: IntegrationPublic
  webhookUrl: string
  automationId: string | null
  remoteWebhookId: string
  registeredRemotely: boolean
  remoteError?: string
}

export type InstallContext = {
  suggestedPublicBaseUrl: string
  gh: { installed: boolean; authenticated: boolean }
  /** Repos inferred from Open Run projects + gh repo list. */
  githubRepos: Array<{
    owner: string
    repo: string
    nameWithOwner: string
    source: 'project' | 'gh'
  }>
  runtimes: Array<{ id: string; label: string; bin: string; installed: boolean }>
  projects: Array<{
    id: string
    name: string
    remoteUrl: string
    workspaces: Array<{ id: string; name: string; status: string; kind: string }>
  }>
}

function parseConfig(raw: string): IntegrationConfig {
  try {
    return JSON.parse(raw || '{}') as IntegrationConfig
  } catch {
    return {}
  }
}

function resolveEvents(provider: IntegrationProviderId, events: string[] | undefined): string[] {
  if (events && events.length > 0) {
    return events.filter((e) => typeof e === 'string' && e.trim())
  }
  return defaultInstallEvents(provider)
}

function assertAutomationTargets(input: InstallIntegrationInput): {
  workspaceId: string
  runtimeId: string
  create: boolean
} {
  const auto = input.automation
  const create = auto?.create === true
  if (!create) return { workspaceId: '', runtimeId: '', create: false }
  const workspaceId = auto?.workspaceId?.trim() ?? ''
  const runtimeId = auto?.runtimeId?.trim() ?? ''
  if (!workspaceId) {
    throw new Error('Pick a project workspace for the automation.')
  }
  if (!runtimeId) {
    throw new Error('Pick a runtime for the automation.')
  }
  const runtime = getDb().prepare('SELECT * FROM runtimes WHERE id = ?').get(runtimeId) as
    | RuntimeRow
    | undefined
  if (!runtime) throw new Error('Runtime not found')
  return { workspaceId, runtimeId, create: true }
}

/**
 * Snapshot used by the Install UI — gh auth, suggested repos, runtimes, workspaces.
 * Suggested public URL comes from AGENTOPS_BASE_URL when set (optional convenience only).
 */
export function getInstallContext(): InstallContext {
  const suggestedPublicBaseUrl = (process.env.AGENTOPS_BASE_URL || '').trim().replace(/\/+$/, '')
  const gh = ghStatus()

  const projectRepos: InstallContext['githubRepos'] = []
  const seen = new Set<string>()
  const projectsRaw = listProjects()
  const projects: InstallContext['projects'] = projectsRaw.map((p) => {
    const parsed = parseGithubOwnerRepo(p.remoteUrl)
    if (parsed) {
      const key = `${parsed.owner}/${parsed.repo}`.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        projectRepos.push({
          ...parsed,
          nameWithOwner: `${parsed.owner}/${parsed.repo}`,
          source: 'project',
        })
      }
    }
    const workspaces = getDb()
      .prepare(
        `SELECT id, name, status, kind FROM workspaces
         WHERE projectId = ? AND status != 'archived'
         ORDER BY kind = 'main' DESC, createdAt ASC`,
      )
      .all(p.id) as Array<{ id: string; name: string; status: string; kind: string }>
    return {
      id: p.id,
      name: p.name,
      remoteUrl: p.remoteUrl,
      workspaces,
    }
  })

  let ghRepos: InstallContext['githubRepos'] = []
  if (gh.installed && gh.authenticated) {
    try {
      ghRepos = listGithubReposViaGh(30)
        .filter((r) => {
          const key = r.nameWithOwner.toLowerCase()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .map((r) => ({ ...r, source: 'gh' as const }))
    } catch {
      ghRepos = []
    }
  }

  const runtimes = (
    getDb().prepare('SELECT * FROM runtimes ORDER BY createdAt ASC').all() as RuntimeRow[]
  ).map((r) => ({
    id: r.id,
    label: r.label,
    bin: r.bin,
    installed: checkRuntimeInstalled(r.bin).installed,
  }))

  return {
    suggestedPublicBaseUrl,
    gh,
    githubRepos: [...projectRepos, ...ghRepos],
    runtimes,
    projects,
  }
}

export type InstallAutomationWriter = (input: {
  name: string
  description: string
  runtimeId: string
  prompt: string
  workspaceId: string
  enabled: boolean
  webhookIntegrationId: string
  webhookEvents: string[]
}) => { id: string }

export async function installIntegration(
  input: InstallIntegrationInput,
  deps: { createAutomation: InstallAutomationWriter },
): Promise<InstallIntegrationResult> {
  const provider = input.provider
  const meta = providerMeta(provider)
  if (!meta) throw new Error(`Unknown provider: ${provider}`)

  const events = resolveEvents(provider, input.events)
  const autoTargets = assertAutomationTargets(input)
  const remoteBase = remoteInstallBaseUrl(input.publicBaseUrl)

  const parsedGithub =
    provider === 'github'
      ? (parseGithubOwnerRepo(input.github ? `${input.github.owner}/${input.github.repo}` : '') ??
        (input.github?.owner && input.github?.repo
          ? { owner: input.github.owner.trim(), repo: input.github.repo.trim() }
          : null))
      : null

  const connectionName =
    input.name?.trim() ||
    (parsedGithub ? `${parsedGithub.owner}/${parsedGithub.repo}` : '') ||
    meta.label

  // Create local connection first so we have id + secret even when the
  // provider cannot reach us yet (localhost, missing credentials).
  const created = createIntegration({
    provider,
    name: connectionName,
    config: {
      installMethod: remoteBase ? 'api' : 'manual',
      ...(remoteBase ? { publicBaseUrl: remoteBase } : {}),
      installedAt: Date.now(),
    },
  })
  const secret = created.secret
  if (!secret) {
    deleteIntegration(created.id)
    throw new Error('Failed to generate webhook secret')
  }

  const webhookUrl = remoteBase ? `${remoteBase}${webhookPathFor(created.id)}` : created.webhookPath

  let remoteWebhookId = ''
  let remoteError: string | undefined
  const config: IntegrationConfig = {
    installMethod: 'manual',
    installedAt: Date.now(),
    ...(remoteBase ? { publicBaseUrl: remoteBase } : {}),
  }

  const canRemote =
    Boolean(remoteBase) &&
    ((provider === 'github' && Boolean(parsedGithub)) ||
      (provider === 'linear' && Boolean(input.linear?.apiKey?.trim())) ||
      (provider === 'jira' &&
        Boolean(
          input.jira?.siteUrl?.trim() && input.jira?.email?.trim() && input.jira?.apiToken?.trim(),
        )))

  if (canRemote && remoteBase) {
    try {
      if (provider === 'github' && parsedGithub) {
        const remote = createGithubWebhookViaGh({
          owner: parsedGithub.owner,
          repo: parsedGithub.repo,
          webhookUrl,
          secret,
          events: githubHookEventsFromCatalog(events),
        })
        remoteWebhookId = remote.remoteWebhookId
        config.installMethod = 'api'
        config.remoteWebhookId = remoteWebhookId
        config.github = parsedGithub
      } else if (provider === 'linear') {
        const remote = await createLinearWebhook({
          apiKey: input.linear!.apiKey,
          webhookUrl,
          secret,
          resourceTypes: linearResourceTypesFromCatalog(events),
          label: connectionName,
        })
        remoteWebhookId = remote.remoteWebhookId
        config.installMethod = 'api'
        config.remoteWebhookId = remoteWebhookId
        config.linear = { label: connectionName }
      } else if (provider === 'jira' && input.jira) {
        const siteUrl = normalizeJiraSiteUrl(input.jira.siteUrl)
        const remote = await createJiraWebhook({
          siteUrl,
          email: input.jira.email,
          apiToken: input.jira.apiToken,
          webhookUrl,
          secret,
          name: connectionName,
          events: jiraRemoteEventsFromCatalog(events),
          jql: input.jira.jql,
        })
        remoteWebhookId = remote.remoteWebhookId
        config.installMethod = 'api'
        config.remoteWebhookId = remoteWebhookId
        config.jira = {
          siteUrl,
          ...(input.jira.jql?.trim() ? { jql: input.jira.jql.trim() } : {}),
        }
      }
    } catch (err) {
      remoteError = err instanceof Error ? err.message : String(err)
    }
  }

  updateIntegration({ id: created.id, config: config as Record<string, unknown> })

  let automationId: string | null = null
  if (autoTargets.create) {
    const prompt = input.automation?.prompt?.trim() || defaultAutomationPrompt(provider)
    const name = input.automation?.name?.trim() || defaultAutomationName(provider, connectionName)
    const enabled = input.automation?.enabled !== false
    try {
      const task = deps.createAutomation({
        name,
        description: `Installed with ${meta.label} — fires on ${events.join(', ')}.`,
        runtimeId: autoTargets.runtimeId,
        prompt,
        workspaceId: autoTargets.workspaceId,
        enabled,
        webhookIntegrationId: created.id,
        webhookEvents: events,
      })
      automationId = task.id
    } catch (err) {
      // Connection + remote webhook already exist — keep them and surface the automation error.
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Integration installed, but automation was not created: ${message}. Open Integrations and attach a webhook trigger manually.`,
      )
    }
  }

  const integration = {
    ...created,
    config: JSON.stringify(config),
    secret,
  }

  return {
    integration,
    webhookUrl,
    automationId,
    remoteWebhookId,
    registeredRemotely: Boolean(remoteWebhookId),
    remoteError,
  }
}

/**
 * Best-effort remote webhook cleanup when deleting a connection.
 * GitHub can use `gh` (no stored token). Linear/Jira need credentials again —
 * those are not stored, so we only clean up GitHub automatically.
 */
export function cleanupRemoteWebhook(integrationId: string): void {
  const row = getIntegration(integrationId)
  if (!row) return
  const config = parseConfig(row.config)
  if (!config.remoteWebhookId) return
  if (row.provider === 'github' && config.github) {
    try {
      deleteGithubWebhookViaGh({
        owner: config.github.owner,
        repo: config.github.repo,
        remoteWebhookId: config.remoteWebhookId,
      })
    } catch {
      // Best-effort — local delete still proceeds.
    }
  }
}
