import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  INTEGRATION_PROVIDER_IDS,
  INTEGRATION_PROVIDERS,
  isHostedOnlyProvider,
  isIntegrationProviderId,
  providerMeta,
  providerPageTitle,
} from './catalog.ts'
import { DEFAULT_INSTALL_EVENTS } from './install.ts'

test('isIntegrationProviderId accepts catalog ids only', () => {
  for (const id of INTEGRATION_PROVIDER_IDS) {
    assert.equal(isIntegrationProviderId(id), true)
  }
  assert.equal(isIntegrationProviderId('github-issues'), false)
  assert.equal(isIntegrationProviderId(''), false)
})

test('providerPageTitle matches the Integrations cards', () => {
  assert.equal(providerPageTitle('github'), 'GitHub')
  assert.equal(providerPageTitle('jira'), 'Jira')
  assert.equal(providerPageTitle('linear'), 'Linear')
  assert.equal(providerMeta('github')?.label, 'GitHub Issues')
})

test('every id in the union has a catalog entry with bindable events', () => {
  assert.equal(INTEGRATION_PROVIDERS.length, INTEGRATION_PROVIDER_IDS.length)
  for (const id of INTEGRATION_PROVIDER_IDS) {
    const meta = providerMeta(id)
    assert.ok(meta, `${id} has no catalog entry`)
    assert.ok(meta.events.length > 0, `${id} offers no events to bind`)
    assert.ok(meta.setupSteps.length > 0, `${id} has no setup steps`)
  }
})

/** An automation binds a catalog id, so a default that is not one never fires. */
test('default install events are all bindable', () => {
  for (const id of INTEGRATION_PROVIDER_IDS) {
    const ids = new Set(providerMeta(id)?.events.map((e) => e.id))
    const defaults = DEFAULT_INSTALL_EVENTS[id]
    assert.ok(defaults?.length, `${id} has no default install events`)
    for (const event of defaults) {
      assert.ok(ids.has(event), `${id} default ${event} is not in the catalog`)
    }
  }
})

test('hosted-only providers are the ones with no local webhook support', () => {
  assert.deepEqual(INTEGRATION_PROVIDER_IDS.filter(isHostedOnlyProvider), [
    'gitlab',
    'bitbucket',
    'azure-devops',
  ])
})
