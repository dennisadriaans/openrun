import assert from 'node:assert/strict'
import { describe, it, test } from 'node:test'
import { INTEGRATION_PROVIDER_IDS, providerMeta } from './catalog.ts'
import { eventMatchesFilters, eventTypeMatches } from './match.ts'
import { emptyActor, emptyIssue, type CanonicalWebhookEvent } from './types.ts'
import {
  availableTriggers,
  compileTrigger,
  defaultTrigger,
  describeTrigger,
  detectTrigger,
} from './triggers.ts'

/**
 * The bug these guard against: a trigger the form offers that compiles to a
 * binding no delivery can ever match. Every assertion here is about the
 * compiled output being real — bindable event ids, and filters the dispatcher
 * actually compares against.
 */

function deliveryOf(
  provider: (typeof INTEGRATION_PROVIDER_IDS)[number],
  partial: {
    eventType: string
    status?: string
    labels?: string[]
    assignees?: string[]
  },
): CanonicalWebhookEvent {
  return {
    provider,
    eventType: partial.eventType,
    deliveryId: 'd1',
    occurredAt: 1,
    issue: emptyIssue({
      key: 'OR-1',
      status: partial.status ?? '',
      labels: partial.labels ?? [],
      assignees: partial.assignees ?? [],
    }),
    actor: emptyActor(),
    extra: {},
  }
}

describe('availableTriggers', () => {
  it('only ever compiles to ids the provider catalog lists', () => {
    for (const provider of INTEGRATION_PROVIDER_IDS) {
      const bindable = new Set(providerMeta(provider)!.events.map((event) => event.id))
      for (const option of availableTriggers(provider)) {
        assert.ok(option.events.length > 0, `${provider}/${option.kind} binds nothing`)
        for (const id of option.events) {
          assert.ok(bindable.has(id), `${provider}/${option.kind} binds unbindable ${id}`)
        }
      }
    }
  })

  it('gives every provider at least a created and a status trigger', () => {
    for (const provider of INTEGRATION_PROVIDER_IDS) {
      const kinds = availableTriggers(provider).map((option) => option.kind)
      assert.ok(kinds.includes('created'), `${provider} cannot trigger on create`)
      assert.ok(kinds.includes('status'), `${provider} cannot trigger on status`)
    }
  })

  it('does not offer a label trigger where the provider never sends labels', () => {
    // Bitbucket's parse leaves issue.labels empty, so a label filter can only
    // ever reject — the trigger must not be offered at all.
    const kinds = availableTriggers('bitbucket').map((option) => option.kind)
    assert.equal(kinds.includes('labeled'), false)
  })

  it('says so when a label trigger is really an update plus a filter', () => {
    const jira = availableTriggers('jira').find((option) => option.kind === 'labeled')!
    assert.match(jira.note ?? '', /no label event/)

    // GitHub has a real labelled event, so it makes no such caveat.
    const github = availableTriggers('github').find((option) => option.kind === 'labeled')!
    assert.equal(github.note, undefined)
  })

  it('suggests statuses only where the vocabulary is closed', () => {
    assert.deepEqual(availableTriggers('github').find((o) => o.kind === 'status')?.suggestions, [
      'open',
      'closed',
    ])
    // Jira statuses are per-project; a guessed list would be a filter that
    // never matches, so there is a placeholder instead.
    const jira = availableTriggers('jira').find((o) => o.kind === 'status')!
    assert.equal(jira.suggestions, undefined)
    assert.match(jira.placeholder ?? '', /In Progress/)
  })
})

describe('compileTrigger', () => {
  it('turns a status trigger into event plus status filter', () => {
    assert.deepEqual(compileTrigger('jira', { kind: 'status', value: 'In Progress' }), {
      events: ['jira:issue_status_changed'],
      filters: { statuses: ['In Progress'] },
    })
  })

  it('treats an empty value as "any"', () => {
    assert.deepEqual(compileTrigger('jira', { kind: 'status', value: '   ' }), {
      events: ['jira:issue_status_changed'],
      filters: {},
    })
  })

  it('maps each value kind to the filter the dispatcher reads', () => {
    assert.deepEqual(compileTrigger('github', { kind: 'labeled', value: 'agent' }).filters, {
      labels: ['agent'],
    })
    assert.deepEqual(compileTrigger('github', { kind: 'assigned', value: 'Ada' }).filters, {
      assignees: ['Ada'],
    })
    assert.deepEqual(compileTrigger('github', { kind: 'created' }).filters, {})
  })

  it('binds both ends of a GitHub open/close transition', () => {
    assert.deepEqual(compileTrigger('github', { kind: 'status', value: 'closed' }), {
      events: ['issues.closed', 'issues.reopened'],
      filters: { statuses: ['closed'] },
    })
  })

  it('passes custom event ids through, de-duplicated', () => {
    assert.deepEqual(
      compileTrigger('jira', {
        kind: 'custom',
        events: ['jira:issue_created', ' jira:issue_created ', 'comment_created', ''],
      }),
      { events: ['jira:issue_created', 'comment_created'], filters: {} },
    )
  })

  it('compiles to nothing for a kind the provider does not support', () => {
    assert.deepEqual(compileTrigger('bitbucket', { kind: 'labeled', value: 'agent' }), {
      events: [],
      filters: {},
    })
  })
})

/**
 * The point of the whole module: what the sentence promises is what the
 * dispatcher matches. These drive the real matcher with the compiled output.
 */
describe('compiled triggers match the deliveries they claim to', () => {
  it('fires on the named status and not on another', () => {
    const { events, filters } = compileTrigger('jira', { kind: 'status', value: 'In Progress' })
    const inProgress = deliveryOf('jira', {
      eventType: 'jira:issue_status_changed',
      status: 'In Progress',
    })
    const done = deliveryOf('jira', { eventType: 'jira:issue_status_changed', status: 'Done' })

    assert.equal(eventTypeMatches(inProgress.eventType, events), true)
    assert.equal(eventMatchesFilters(inProgress, filters), true)
    assert.equal(eventMatchesFilters(done, filters), false)
  })

  it('is case-insensitive on the status, the way people type it', () => {
    const { filters } = compileTrigger('jira', { kind: 'status', value: 'in progress' })
    const event = deliveryOf('jira', {
      eventType: 'jira:issue_status_changed',
      status: 'In Progress',
    })
    assert.equal(eventMatchesFilters(event, filters), true)
  })

  it('fires on a labelled ticket and not an unlabelled one', () => {
    const { events, filters } = compileTrigger('github', { kind: 'labeled', value: 'agent' })
    const labelled = deliveryOf('github', { eventType: 'issues.labeled', labels: ['agent', 'bug'] })
    const other = deliveryOf('github', { eventType: 'issues.labeled', labels: ['bug'] })

    assert.equal(eventTypeMatches(labelled.eventType, events), true)
    assert.equal(eventMatchesFilters(labelled, filters), true)
    assert.equal(eventMatchesFilters(other, filters), false)
  })

  /**
   * Labelling a ticket as you file it is the ordinary way to use a label, and
   * it produces a create — not an update, and on most vendors not a label event
   * either. Every provider's label trigger has to cover it or the flagship
   * recipe ignores exactly the tickets it was set up for.
   */
  it('fires on a ticket that arrives already labelled', () => {
    for (const provider of INTEGRATION_PROVIDER_IDS) {
      const labelTrigger = availableTriggers(provider).find((o) => o.kind === 'labeled')
      if (!labelTrigger) continue

      const createdId = availableTriggers(provider).find((o) => o.kind === 'created')!.events[0]!
      assert.ok(
        labelTrigger.events.includes(createdId),
        `${provider} label trigger misses ${createdId}`,
      )

      const { events, filters } = compileTrigger(provider, { kind: 'labeled', value: 'agent' })
      const born = deliveryOf(provider, { eventType: createdId, labels: ['agent'] })
      assert.equal(eventTypeMatches(born.eventType, events), true, `${provider} event`)
      assert.equal(eventMatchesFilters(born, filters), true, `${provider} filter`)
    }
  })

  it('an empty status trigger fires on any transition', () => {
    const { filters } = compileTrigger('linear', { kind: 'status', value: '' })
    for (const status of ['Todo', 'In Progress', 'Done']) {
      const event = deliveryOf('linear', { eventType: 'Issue.status_changed', status })
      assert.equal(eventMatchesFilters(event, filters), true)
    }
  })
})

describe('describeTrigger', () => {
  it('reads as a sentence about the ticket, not the event id', () => {
    assert.equal(
      describeTrigger('jira', { kind: 'status', value: 'In Progress' }),
      'Runs when an issue moves to In Progress.',
    )
    assert.equal(describeTrigger('jira', { kind: 'created' }), 'Runs when a new issue is created.')
    assert.equal(
      describeTrigger('github', { kind: 'assigned', value: 'Ada' }),
      'Runs when an issue is assigned to Ada.',
    )
  })

  it('uses the provider’s own noun', () => {
    assert.match(describeTrigger('azure-devops', { kind: 'created' }), /work item/)
  })

  it('describes an unnarrowed trigger without inventing a value', () => {
    assert.equal(
      describeTrigger('jira', { kind: 'status', value: '' }),
      'Runs when an issue moves to a status.',
    )
  })

  it('falls back to the raw ids for a custom trigger', () => {
    assert.equal(
      describeTrigger('jira', { kind: 'custom', events: ['comment_created'] }),
      'Runs on comment_created.',
    )
  })
})

describe('detectTrigger', () => {
  it('round-trips every offered trigger', () => {
    for (const provider of INTEGRATION_PROVIDER_IDS) {
      for (const option of availableTriggers(provider)) {
        const value = option.value === 'none' ? '' : 'Something'
        const compiled = compileTrigger(provider, { kind: option.kind, value })
        const detected = detectTrigger(provider, compiled.events, compiled.filters)
        assert.equal(detected.kind, option.kind, `${provider}/${option.kind} did not round-trip`)
        assert.equal(detected.value, value)
      }
    }
  })

  it('reports a shape the builder cannot express as custom', () => {
    // Two statuses, and a filter combination the builder never produces.
    const detected = detectTrigger('jira', ['jira:issue_status_changed'], {
      statuses: ['In Progress', 'In Review'],
    })
    assert.equal(detected.kind, 'custom')

    const mixed = detectTrigger('jira', ['jira:issue_status_changed'], {
      statuses: ['In Progress'],
      labels: ['agent'],
    })
    assert.equal(mixed.kind, 'custom')
  })

  it('keeps the original ids when it falls back to custom', () => {
    const detected = detectTrigger('jira', ['jira:issue_created', 'comment_created'], {})
    assert.equal(detected.kind, 'custom')
    assert.deepEqual(detected.events, ['jira:issue_created', 'comment_created'])
  })
})

test('defaultTrigger starts somewhere the provider supports', () => {
  for (const provider of INTEGRATION_PROVIDER_IDS) {
    const trigger = defaultTrigger(provider)
    const { events } = compileTrigger(provider, trigger)
    assert.ok(events.length > 0, `${provider} default compiles to nothing`)
  }
})
