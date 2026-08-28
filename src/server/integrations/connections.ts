/**
 * CRUD for third-party integration connections.
 *
 * A connection is only ever a local pointer at a control-plane connection: the
 * vendor webhook, its secret, and the tokens all live there, and events arrive
 * over the relay already verified and normalized.
 */
import { randomBytes } from 'node:crypto'
import { INTEGRATION_PROVIDERS, providerMeta } from '../../lib/integrations/catalog.ts'
import { cloudConnectionIdFromConfig } from '../../lib/integrations/automation.ts'
import type { IntegrationProviderId } from '../../lib/integrations/types.ts'
import { getDb } from '../db.ts'

export type IntegrationRow = {
  id: string
  provider: IntegrationProviderId
  name: string
  /** Legacy column, always empty — the signing secret lives on the control plane. */
  secret: string
  /** JSON bag for provider-specific settings (site URL, account name, …). */
  config: string
  enabled: number
  createdAt: number
  updatedAt: number
}

export type IntegrationPublic = Omit<IntegrationRow, 'secret'> & {
  providerLabel: string
  cloudConnectionId?: string
}

function id(): string {
  return `int_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
}

function decorate(row: IntegrationRow): IntegrationPublic {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    config: row.config,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    providerLabel: providerMeta(row.provider)?.label ?? row.provider,
    cloudConnectionId: cloudConnectionIdFromConfig(row.config) ?? undefined,
  }
}

export function listIntegrations(): IntegrationPublic[] {
  const rows = getDb()
    .prepare('SELECT * FROM integrations ORDER BY createdAt DESC')
    .all() as IntegrationRow[]
  return rows.map((r) => decorate(r))
}

export function getIntegration(integrationId: string): IntegrationRow | undefined {
  return getDb().prepare('SELECT * FROM integrations WHERE id = ?').get(integrationId) as
    | IntegrationRow
    | undefined
}

export function findIntegrationByCloudConnection(
  cloudConnectionId: string,
): IntegrationRow | undefined {
  const id = cloudConnectionId.trim()
  if (!id) return undefined
  const rows = getDb().prepare('SELECT * FROM integrations').all() as IntegrationRow[]
  return rows.find((row) => cloudConnectionIdFromConfig(row.config) === id)
}

export function getIntegrationPublic(integrationId: string): IntegrationPublic | undefined {
  const row = getIntegration(integrationId)
  return row ? decorate(row) : undefined
}

export type CreateIntegrationInput = {
  provider: IntegrationProviderId
  name: string
  config?: Record<string, unknown>
}

export function createIntegration(input: CreateIntegrationInput): IntegrationPublic {
  const meta = providerMeta(input.provider)
  if (!meta) throw new Error(`Unknown integration provider: ${input.provider}`)
  const db = getDb()
  const now = Date.now()
  const row: IntegrationRow = {
    id: id(),
    provider: input.provider,
    name: input.name.trim() || meta.label,
    secret: '',
    config: JSON.stringify(input.config ?? {}),
    enabled: 1,
    createdAt: now,
    updatedAt: now,
  }
  db.prepare(
    `INSERT INTO integrations (id, provider, name, secret, config, enabled, createdAt, updatedAt)
     VALUES (@id, @provider, @name, @secret, @config, @enabled, @createdAt, @updatedAt)`,
  ).run(row)
  return decorate(row)
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
  const config = input.config === undefined ? existing.config : JSON.stringify(input.config)
  const updatedAt = Date.now()
  db.prepare(
    `UPDATE integrations SET name = ?, enabled = ?, config = ?, updatedAt = ? WHERE id = ?`,
  ).run(name, enabled, config, updatedAt, input.id)
  return decorate(getIntegration(input.id)!)
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

/** Every provider the UI can offer — all of them connect through the cloud. */
export function listProviderCatalog() {
  return INTEGRATION_PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    events: p.events,
    setupSteps: p.setupSteps,
    docsUrl: p.docsUrl,
  }))
}
