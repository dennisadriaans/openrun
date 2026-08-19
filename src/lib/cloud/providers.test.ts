import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  cloudProvider,
  parseCloudProviderCatalog,
  planIntegrationConnect,
  UNREACHABLE_CATALOG,
  type CloudProviderCatalog,
} from './providers.ts'

/**
 * The failure this covers is the one that made hosted integrations feel broken:
 * the app offered Connect for a provider the control plane had no OAuth app
 * for, and the click ended on a raw 501 body in a browser tab.
 */

const CATALOG: CloudProviderCatalog = {
  reachable: true,
  providers: [
    { id: 'jira', label: 'Jira', authKind: 'oauth', configured: true, picksTarget: false },
    { id: 'gitlab', label: 'GitLab', authKind: 'oauth', configured: true, picksTarget: true },
    { id: 'linear', label: 'Linear', authKind: 'oauth', configured: false, picksTarget: false },
  ],
}

function plan(overrides: Partial<Parameters<typeof planIntegrationConnect>[0]> = {}) {
  return planIntegrationConnect({
    label: 'Jira',
    cloudUrl: 'https://openrun.sh',
    signedIn: true,
    catalog: CATALOG,
    provider: 'jira',
    supportsLocalInstall: true,
    ...overrides,
  })
}

describe('parseCloudProviderCatalog', () => {
  it('reads the control plane answer', () => {
    const parsed = parseCloudProviderCatalog({
      providers: [{ id: 'jira', label: 'Jira', authKind: 'oauth', configured: true }],
    })
    assert.equal(parsed.reachable, true)
    assert.deepEqual(parsed.providers, [
      { id: 'jira', label: 'Jira', authKind: 'oauth', configured: true, picksTarget: false },
    ])
  })

  it('treats a shape it does not recognise as unreachable', () => {
    assert.deepEqual(parseCloudProviderCatalog(null), UNREACHABLE_CATALOG)
    assert.deepEqual(parseCloudProviderCatalog({}), UNREACHABLE_CATALOG)
    assert.deepEqual(parseCloudProviderCatalog({ providers: 'jira' }), UNREACHABLE_CATALOG)
  })

  it('drops unusable rows but keeps a reachable verdict', () => {
    const parsed = parseCloudProviderCatalog({
      providers: [null, { label: 'no id' }, { id: '  ' }, { id: 'jira' }],
    })
    assert.equal(parsed.reachable, true)
    assert.deepEqual(
      parsed.providers.map((p) => p.id),
      ['jira'],
    )
  })

  it('never infers configured from a missing field', () => {
    const parsed = parseCloudProviderCatalog({ providers: [{ id: 'jira' }] })
    assert.equal(parsed.providers[0]?.configured, false)
  })
})

describe('cloudProvider', () => {
  it('finds a provider and tolerates a missing catalog', () => {
    assert.equal(cloudProvider(CATALOG, 'gitlab')?.label, 'GitLab')
    assert.equal(cloudProvider(CATALOG, 'bitbucket'), null)
    assert.equal(cloudProvider(null, 'jira'), null)
  })
})

describe('planIntegrationConnect', () => {
  it('offers Connect for a configured provider on a signed-in machine', () => {
    const result = plan()
    assert.equal(result.kind, 'connect')
    assert.equal(result.reason, '')
  })

  it('flags the providers that stop at a project picker', () => {
    assert.equal(plan({ provider: 'gitlab', label: 'GitLab' }).picksTarget, true)
    assert.equal(plan().picksTarget, false)
  })

  it('asks for sign-in only once the provider is known to be connectable', () => {
    const result = plan({ signedIn: false })
    assert.equal(result.kind, 'sign-in')
    assert.match(result.reason, /nothing to paste/)
  })

  it('reports a provider the deployment never registered, signed in or not', () => {
    for (const signedIn of [true, false]) {
      const result = plan({ provider: 'linear', label: 'Linear', signedIn })
      assert.equal(result.kind, 'unsupported')
      assert.match(result.reason, /not available/)
    }
  })

  it('reports a provider the control plane does not list at all', () => {
    assert.equal(plan({ provider: 'bitbucket', label: 'Bitbucket' }).kind, 'unsupported')
  })

  it('says nothing while the catalog is still loading', () => {
    const result = plan({ catalog: null })
    assert.equal(result.kind, 'loading')
    assert.equal(result.reason, '')
    // Nothing is offered yet — a flash of "unavailable" would be a lie.
    assert.equal(result.offerLocal, false)
  })

  it('falls back to the self-managed path when the cloud is turned off', () => {
    const result = plan({ cloudUrl: null })
    assert.equal(result.kind, 'cloud-off')
    assert.equal(result.offerLocal, true)
  })

  it('does not promise a local path a provider cannot do', () => {
    const result = plan({ cloudUrl: null, supportsLocalInstall: false })
    assert.equal(result.offerLocal, false)
    assert.match(result.reason, /Turn it back on/)
  })

  it('distinguishes an unreachable control plane from an unsupported provider', () => {
    const result = plan({ catalog: UNREACHABLE_CATALOG })
    assert.equal(result.kind, 'unreachable')
    assert.match(result.reason, /Could not reach/)
    // Still offered: a self-hoster whose plane is down can wire the hook itself.
    assert.equal(result.offerLocal, true)
  })
})
