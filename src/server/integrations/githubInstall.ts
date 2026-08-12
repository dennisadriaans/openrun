/**
 * Register a GitHub Issues webhook via the authenticated `gh` CLI.
 * No Open Run env vars / tokens — uses whatever `gh auth login` already has.
 */
import { spawnSync } from 'node:child_process'
import { ensureProcessPathAugmented, findOnPath } from '../userPath.ts'
import { ghStatus } from '../git.ts'

export type GhWebhookCreateResult = {
  remoteWebhookId: string
  remoteUrl: string
}

function requireGh(): void {
  ensureProcessPathAugmented()
  if (!findOnPath('gh')) {
    throw new Error('GitHub CLI (`gh`) is not on PATH. Install it, then run `gh auth login`.')
  }
  const status = ghStatus()
  if (!status.authenticated) {
    throw new Error('GitHub CLI is not authenticated. Run `gh auth login` and try again.')
  }
}

export function listGithubReposViaGh(
  limit = 40,
): Array<{ owner: string; repo: string; nameWithOwner: string }> {
  requireGh()
  const res = spawnSync(
    'gh',
    ['repo', 'list', '--limit', String(limit), '--json', 'nameWithOwner'],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  )
  if (res.status !== 0) {
    const err = `${res.stderr ?? ''}${res.stdout ?? ''}`.trim()
    throw new Error(err || 'gh repo list failed')
  }
  let parsed: Array<{ nameWithOwner?: string }> = []
  try {
    parsed = JSON.parse(res.stdout || '[]') as Array<{ nameWithOwner?: string }>
  } catch {
    throw new Error('gh repo list returned invalid JSON')
  }
  const out: Array<{ owner: string; repo: string; nameWithOwner: string }> = []
  for (const row of parsed) {
    const name = row.nameWithOwner?.trim()
    if (!name?.includes('/')) continue
    const [owner, repo] = name.split('/')
    if (!owner || !repo) continue
    out.push({ owner, repo, nameWithOwner: name })
  }
  return out
}

export function createGithubWebhookViaGh(input: {
  owner: string
  repo: string
  webhookUrl: string
  secret: string
  events: string[]
}): GhWebhookCreateResult {
  requireGh()
  const owner = input.owner.trim()
  const repo = input.repo.trim()
  if (!owner || !repo) throw new Error('Pick a GitHub owner/repo.')

  const body = {
    name: 'web',
    active: true,
    events: input.events.length ? input.events : ['issues'],
    config: {
      url: input.webhookUrl,
      content_type: 'json',
      secret: input.secret,
      insecure_ssl: '0',
    },
  }

  const res = spawnSync(
    'gh',
    ['api', `repos/${owner}/${repo}/hooks`, '--method', 'POST', '--input', '-'],
    {
      encoding: 'utf8',
      input: JSON.stringify(body),
      maxBuffer: 4 * 1024 * 1024,
    },
  )
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim()
  if (res.status !== 0) {
    throw new Error(out || `Failed to create webhook on ${owner}/${repo}`)
  }
  let parsed: { id?: number | string; config?: { url?: string } }
  try {
    parsed = JSON.parse(res.stdout || '{}') as { id?: number | string; config?: { url?: string } }
  } catch {
    throw new Error('GitHub returned an unexpected webhook response')
  }
  if (parsed.id == null) throw new Error('GitHub webhook create did not return an id')
  return {
    remoteWebhookId: String(parsed.id),
    remoteUrl: parsed.config?.url ?? input.webhookUrl,
  }
}

export function deleteGithubWebhookViaGh(input: {
  owner: string
  repo: string
  remoteWebhookId: string
}): void {
  requireGh()
  const res = spawnSync(
    'gh',
    [
      'api',
      `repos/${input.owner}/${input.repo}/hooks/${input.remoteWebhookId}`,
      '--method',
      'DELETE',
    ],
    { encoding: 'utf8' },
  )
  // 404 is fine — already gone.
  if (res.status !== 0 && !`${res.stderr ?? ''}${res.stdout ?? ''}`.includes('404')) {
    const err = `${res.stderr ?? ''}${res.stdout ?? ''}`.trim()
    throw new Error(err || 'Failed to delete GitHub webhook')
  }
}
