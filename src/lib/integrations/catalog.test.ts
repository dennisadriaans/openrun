import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  INTEGRATION_PROVIDER_IDS,
  isIntegrationProviderId,
  providerMeta,
  providerPageTitle,
} from './catalog.ts'

test('isIntegrationProviderId accepts catalog ids only', () => {
  for (const id of INTEGRATION_PROVIDER_IDS) {
    assert.equal(isIntegrationProviderId(id), true)
  }
  assert.equal(isIntegrationProviderId('slack'), false)
  assert.equal(isIntegrationProviderId('github-issues'), false)
  assert.equal(isIntegrationProviderId(''), false)
})

test('providerPageTitle matches the Integrations cards', () => {
  assert.equal(providerPageTitle('github'), 'GitHub')
  assert.equal(providerPageTitle('jira'), 'Jira')
  assert.equal(providerPageTitle('linear'), 'Linear')
  assert.equal(providerMeta('github')?.label, 'GitHub Issues')
})
