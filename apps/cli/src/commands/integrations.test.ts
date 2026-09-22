import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authorize, integrations } from './integrations.ts'
import type { CliClient } from '../runtime/local.ts'

test('CLI OAuth rejects stray callbacks and completes the matching provider flow', async () => {
  const calls: Array<{ operation: string; input: unknown }> = []
  const errors: unknown[] = []
  const original = console.error
  console.error = () => {}
  const client: CliClient = {
    async call(operation, input) {
      calls.push({ operation, input })
      if (operation === 'cloud.startHostedConnect') {
        const { origin } = input as { origin: string }
        setTimeout(() => {
          void (async () => {
            const bad = await fetch(`${origin}/cloud/callback?state=wrong&connection_id=forged`)
            assert.equal(bad.status, 400)
            const good = await fetch(
              `${origin}/cloud/callback?state=expected&connection_id=connected&account=Fixture`,
            )
            assert.equal(good.status, 200)
          })().catch((error) => errors.push(error))
        }, 10)
        return { url: 'https://provider.example/authorize?state=expected' }
      }
      if (operation === 'cloud.completeHostedConnect') return { id: 'int_fixture' }
      throw new Error(`Unexpected call: ${operation}`)
    },
  }
  try {
    assert.deepEqual(await authorize(client, 'github'), { id: 'int_fixture' })
    assert.deepEqual(calls[1], {
      operation: 'cloud.completeHostedConnect',
      input: {
        provider: 'github',
        cloudConnectionId: 'connected',
        state: 'expected',
        siteUrl: '',
        accountName: 'Fixture',
      },
    })
    assert.equal(calls.length, 2)
    assert.deepEqual(errors, [])
  } finally {
    console.error = original
  }
})

test('integration commands do not pretend a failed disconnect succeeded', async () => {
  const client: CliClient = {
    async call(operation) {
      if (operation === 'integrations.listProviders') return []
      if (operation === 'integrations.list') return [{ id: 'int_fixture', name: 'Fixture' }]
      if (operation === 'integrations.disconnectHosted')
        return { ok: false, remoteError: 'Relay unavailable' }
      throw new Error(`Unexpected call: ${operation}`)
    },
  }
  await assert.rejects(
    integrations(client, ['disconnect', 'int_fixture'], true),
    /Relay unavailable/,
  )
})

test('integration setup uses the current workspace, installed runtime and default prompt', async () => {
  let saved: unknown
  const client: CliClient = {
    async call(operation, input) {
      if (operation === 'integrations.listProviders')
        return [
          {
            id: 'github',
            label: 'GitHub',
            events: [{ id: 'issues.opened', label: 'Issue opened' }],
          },
        ]
      if (operation === 'integrations.list')
        return [{ id: 'int_fixture', provider: 'github', name: 'Fixture', enabled: 1 }]
      if (operation === 'runtimes.list')
        return [
          { id: 'rt_missing', bin: 'missing', label: 'Missing', installed: false, enabled: 1 },
          { id: 'rt_fixture', bin: 'fixture', label: 'Fixture', installed: true, enabled: 1 },
        ]
      if (operation === 'workspaces.list')
        return [
          {
            id: 'ws_fixture',
            path: process.cwd(),
            name: 'Fixture',
            branch: 'main',
            status: 'ready',
          },
        ]
      if (operation === 'integrations.createAutomation') {
        saved = input
        return { taskId: 'task_fixture' }
      }
      throw new Error(`Unexpected call: ${operation}`)
    },
  }
  const original = console.log
  console.log = () => {}
  try {
    await integrations(client, ['configure'], true)
    assert.deepEqual(saved, {
      integrationId: 'int_fixture',
      workspaceId: 'ws_fixture',
      runtimeId: 'rt_fixture',
      events: ['issues.opened'],
      enabled: true,
    })
    saved = undefined
    await assert.rejects(
      integrations(client, ['configure', '--event', '--prompt', 'work'], true),
      /missing integration option/,
    )
    assert.equal(saved, undefined)
  } finally {
    console.log = original
  }
})
