import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authorize, integrations } from './integrations.ts'
import type { CliClient } from './local.ts'

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
