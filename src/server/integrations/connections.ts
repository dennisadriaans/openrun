/**
 * CRUD for third-party integration connections (webhook endpoints + secrets).
 */
import { randomBytes } from 'node:crypto'
import { cloudConnectionIdFromConfig } from '../../lib/integrations/install.ts'
import type { IntegrationProviderId } from '../../lib/integrations/types.ts'
import { getDb } from '../db.ts'
import { generateWebhookSecret } from './crypto.ts'
import { assertIntegrationProvider, listIntegrationProviders } from './registry.ts'

export type IntegrationRow = {
  id: string
  provider: IntegrationProviderId
  name: string
  secret: string
  /** JSON bag for provider-specific settings (repo, project keys, …). */
  config: string
  enabled: number
  createdAt: number
  updatedAt: number
}

export type IntegrationPublic = Omit<IntegrationRow, 'secret'> & {
  /** Present only right after create/rotate. */
  secret?: string
  webhookPath: string
  providerLabel: string
  /** True when the webhook lives on the control plane, not this machine. */
  hosted: boolean
  cloudConnectionId?: string
}

function id(): string {
  return `int_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
}

export function webhookPathFor(integrationId: string): string {
  return `/api/webhooks/${integrationId}`
}

function parseConfigBag(raw: string): { installMethod?: string; cloudConnectionId?: string } {
  try {
    return JSON.parse(raw || '{}') as { installMethod?: string; cloudConnectionId?: string }
  } catch {
    return {}
  }
}

function decorate(row: IntegrationRow, revealSecret = false): IntegrationPublic {
  const provider = assertIntegrationProvider(row.provider)
  const config = parseConfigBag(row.config)
  const hosted = config.installMethod === 'hosted'
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    config: row.config,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    webhookPath: webhookPathFor(row.id),
    providerLabel: provider.label,
    hosted,
    cloudConnectionId: config.cloudConnectionId,
    ...(revealSecret && !hosted ? { secret: row.secret } : {}),
  }
}

export function listIntegrations(): IntegrationPublic[] {
  const rows = getDb()
    .prepare('SELECT * FROM integrations ORDER BY createdAt DESC')
    .all() as IntegrationRow[]
  return rows.map((r) => decorate(r))
}

export function getIntegration(integrationId: string): IntegrationRow | undefined {
  return getDb()
    .prepare('SELECT * FROM integrations WHERE id = ?')
    .get(integrationId) as IntegrationRow | undefined
}

export function findIntegrationByCloudConnection(
  cloudConnectionId: string,
): IntegrationRow | undefined {
  const id = cloudConnectionId.trim()
  if (!id) return undefined
  const rows = getDb().prepare('SELECT * FROM integrations').all() as IntegrationRow[]
  return rows.find((row) => cloudConnectionIdFromConfig(row.config) === id)
}

export function getIntegrationPublic(
  integrationId: string,
  revealSecret = false,
): IntegrationPublic | undefined {
  const row = getIntegration(integrationId)
  return row ? decorate(row, revealSecret) : undefined
}

export type CreateIntegrationInput = {
  provider: IntegrationProviderId
  name: string
  config?: Record<string, unknown>
}

export function createIntegration(input: CreateIntegrationInput): IntegrationPublic {
  assertIntegrationProvider(input.provider)
  const db = getDb()
  const now = Date.now()
  const hosted = input.config?.installMethod === 'hosted'
  const row: IntegrationRow = {
    id: id(),
    provider: input.provider,
    name: input.name.trim() || assertIntegrationProvider(input.provider).label,
    secret: hosted ? '' : generateWebhookSecret(),
    config: JSON.stringify(input.config ?? {}),
    enabled: 1,
    createdAt: now,
    updatedAt: now,
  }
  db.prepare(
    `INSERT INTO integrations (id, provider, name, secret, config, enabled, createdAt, updatedAt)
     VALUES (@id, @provider, @name, @secret, @config, @enabled, @createdAt, @updatedAt)`,
  ).run(row)
  return decorate(row, true)
}

export type UpdateIntegrationInput = {
  id: string
  name?: string
  enabled?: boolean
  config?: Record<string, unknown>
}

export function updateIntegration(input: UpdateIntegrationInput): IntegrationPublic {
  const db = getDb()
  const existing = getIntegration(input.id)
  if (!existing) throw new Error('Integration not found')
  const name = input.name?.trim() || existing.name
  const enabled = input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0
  const config =
    input.config === undefined ? existing.config : JSON.stringify(input.config)
  const updatedAt = Date.now()
  db.prepare(
    `UPDATE integrations SET name = ?, enabled = ?, config = ?, updatedAt = ? WHERE id = ?`,
  ).run(name, enabled, config, updatedAt, input.id)
  return decorate(getIntegration(input.id)!, false)
}

export function rotateIntegrationSecret(integrationId: string): IntegrationPublic {
  const db = getDb()
  const existing = getIntegration(integrationId)
  if (!existing) throw new Error('Integration not found')
  if (parseConfigBag(existing.config).installMethod === 'hosted') {
    throw new Error('Hosted connections have no local signing secret.')
  }
  const secret = generateWebhookSecret()
  db.prepare(`UPDATE integrations SET secret = ?, updatedAt = ? WHERE id = ?`).run(
    secret,
    Date.now(),
    integrationId,
  )
  return decorate(getIntegration(integrationId)!, true)
}

export function deleteIntegration(integrationId: string) {
  const db = getDb()
  // Detach automations that pointed at this connection.
  db.prepare(
    `UPDATE tasks
     SET webhookIntegrationId = '', webhookEvents = '[]', webhookFilters = '{}', updatedAt = ?
     WHERE webhookIntegrationId = ?`,
  ).run(Date.now(), integrationId)
  db.prepare('DELETE FROM webhook_deliveries WHERE integrationId = ?').run(integrationId)
  db.prepare('DELETE FROM integrations WHERE id = ?').run(integrationId)
}

export function listProviderCatalog() {
  return listIntegrationProviders().map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    events: p.events,
    setupSteps: p.setupSteps,
    docsUrl: p.docsUrl,
  }))
}
