/**
 * Triggers in the user's words, compiled to the storage model.
 *
 * People think "when a ticket moves to In Progress". The dispatcher thinks
 * `webhookEvents: ['jira:issue_status_changed']` plus
 * `webhookFilters: { statuses: ['In Progress'] }`. Nothing bridged the two, so
 * a status trigger — the single most-asked-for shape — was not expressible from
 * the setup form at all: binding the event alone fires on *every* transition.
 *
 * Browser-safe and dependency-free like the other rule modules, because the
 * same compile runs in the form that previews the sentence and on the server
 * write path. A trigger the UI offers therefore cannot compile to a binding the
 * server would store differently.
 *
 * A kind is offered for a provider only when that provider both emits the event
 * *and* populates the field the filter compares against. Bitbucket never fills
 * `issue.labels`, so it has no "labelled" trigger — offering one would bind an
 * automation that looks armed and can never match.
 */
import type { IntegrationProviderId, WebhookFilters } from './types.ts'

export type TriggerKind =
  | 'created'
  | 'status'
  | 'labeled'
  | 'assigned'
  | 'commented'
  | 'updated'
  /** Escape hatch: raw catalog event ids, no filter. */
  | 'custom'

/** What the trigger's value box collects, and which filter it becomes. */
export type TriggerValueKind = 'none' | 'status' | 'label' | 'assignee'

export type IntegrationTrigger = {
  kind: TriggerKind
  /** The status / label / assignee to narrow on. Empty means "any". */
  value?: string
  /** `custom` only: catalog event ids to bind directly. */
  events?: string[]
}

export type TriggerOption = {
  kind: Exclude<TriggerKind, 'custom'>
  /** Sentence fragment completing "…". */
  label: string
  value: TriggerValueKind
  /** Catalog event ids this compiles to. */
  events: string[]
  /** Hints for the value box. Never a closed list — vocabularies are per-project. */
  suggestions?: string[]
  placeholder?: string
  /** Said out loud when the binding is broader than the label implies. */
  note?: string
}

/** What this provider calls the thing. */
const NOUN: Record<IntegrationProviderId, string> = {
  github: 'issue',
  gitlab: 'issue',
  bitbucket: 'issue',
  jira: 'issue',
  linear: 'issue',
  'azure-devops': 'work item',
}

/** What this provider calls the thing, for copy that has to name it. */
export function providerNoun(provider: IntegrationProviderId): string {
  return NOUN[provider]
}

/** "an issue", "a work item" — these strings are read by users, not parsed. */
function an(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`
}

type KindShape = {
  label: (noun: string) => string
  value: TriggerValueKind
  placeholder?: string
  note?: string
}

const KIND_SHAPE: Record<Exclude<TriggerKind, 'custom'>, KindShape> = {
  created: {
    label: (noun) => `a new ${noun} is created`,
    value: 'none',
  },
  status: {
    label: (noun) => `${an(noun)} moves to a status`,
    value: 'status',
    placeholder: 'In Progress — leave empty for any status',
  },
  labeled: {
    label: (noun) => `${an(noun)} carries a label`,
    value: 'label',
    placeholder: 'agent — leave empty for any label',
  },
  assigned: {
    label: (noun) => `${an(noun)} is assigned`,
    value: 'assignee',
    placeholder: 'Ada Lovelace — leave empty for anyone',
  },
  commented: {
    label: () => 'someone comments',
    value: 'none',
  },
  updated: {
    label: (noun) => `${an(noun)} changes in any way`,
    value: 'none',
    note: 'Fires often. Narrow it with a label or status trigger if the agent should not run on every edit.',
  },
}

/**
 * Which catalog events each kind binds. A kind missing from a provider is not
 * offered at all.
 *
 * Where a vendor has no dedicated event, the closest one is paired with the
 * filter that makes it mean the right thing — Jira has no "labelled" webhook,
 * so `labeled` binds the update event and narrows on the label. That reads as
 * "changed while carrying this label" rather than "the moment it was
 * labelled", which is why those entries carry a `note`.
 *
 * `labeled` also binds the *create* event everywhere. Labelling a ticket as you
 * file it is the ordinary way to use a label, and it produces a create — not an
 * update, and on most vendors not a label event either. Without this the
 * flagship "label it and the agent picks it up" recipe silently ignored every
 * ticket that arrived already labelled.
 */
const BROADER_LABEL_NOTE =
  'This provider has no label event, so it fires whenever a ticket is created or changed while carrying the label.'

const KIND_EVENTS: Record<
  IntegrationProviderId,
  Partial<Record<Exclude<TriggerKind, 'custom'>, string[]>>
> = {
  github: {
    created: ['issues.opened'],
    status: ['issues.closed', 'issues.reopened'],
    labeled: ['issues.opened', 'issues.labeled'],
    assigned: ['issues.assigned'],
    commented: ['issue_comment.created'],
    updated: ['issues.edited'],
  },
  gitlab: {
    created: ['issue.open'],
    status: ['issue.status_changed'],
    labeled: ['issue.open', 'issue.update'],
    assigned: ['issue.assigned'],
    commented: ['note.create'],
    updated: ['issue.update'],
  },
  bitbucket: {
    created: ['issue:created'],
    status: ['issue:status_changed'],
    // No `labeled`: this provider never populates issue.labels.
    assigned: ['issue:assigned'],
    commented: ['issue:comment_created'],
    updated: ['issue:updated'],
  },
  jira: {
    created: ['jira:issue_created'],
    status: ['jira:issue_status_changed'],
    labeled: ['jira:issue_created', 'jira:issue_updated'],
    assigned: ['jira:issue_assigned'],
    commented: ['comment_created'],
    updated: ['jira:issue_updated'],
  },
  linear: {
    created: ['Issue.create'],
    status: ['Issue.status_changed'],
    labeled: ['Issue.create', 'Issue.update'],
    assigned: ['Issue.assigned'],
    commented: ['Comment.create'],
    updated: ['Issue.update'],
  },
  'azure-devops': {
    created: ['workitem.created'],
    status: ['workitem.status_changed'],
    labeled: ['workitem.created', 'workitem.updated'],
    assigned: ['workitem.assigned'],
    // No comment event in the canonical vocabulary.
    updated: ['workitem.updated'],
  },
}

/**
 * Status hints, only where the vendor's vocabulary is genuinely closed. Jira,
 * Linear and Azure DevOps statuses are per-project strings we cannot know until
 * we can ask the vendor, so those get a placeholder instead of a wrong list.
 */
const STATUS_SUGGESTIONS: Partial<Record<IntegrationProviderId, string[]>> = {
  github: ['open', 'closed'],
  gitlab: ['opened', 'closed'],
}

/** Providers whose `labeled` binding is an update event plus a label filter. */
function labelIsBroad(provider: IntegrationProviderId): boolean {
  const events = KIND_EVENTS[provider].labeled ?? []
  return !events.some((id) => id.toLowerCase().includes('label'))
}

export function availableTriggers(provider: IntegrationProviderId): TriggerOption[] {
  const noun = NOUN[provider]
  const byKind = KIND_EVENTS[provider]
  const out: TriggerOption[] = []

  for (const kind of Object.keys(KIND_SHAPE) as Array<Exclude<TriggerKind, 'custom'>>) {
    const events = byKind[kind]
    if (!events?.length) continue
    const shape = KIND_SHAPE[kind]
    const note = kind === 'labeled' && labelIsBroad(provider) ? BROADER_LABEL_NOTE : shape.note
    out.push({
      kind,
      label: shape.label(noun),
      value: shape.value,
      events: [...events],
      ...(shape.placeholder ? { placeholder: shape.placeholder } : {}),
      ...(note ? { note } : {}),
      ...(shape.value === 'status' && STATUS_SUGGESTIONS[provider]
        ? { suggestions: [...STATUS_SUGGESTIONS[provider]!] }
        : {}),
    })
  }
  return out
}

export function triggerOption(
  provider: IntegrationProviderId,
  kind: TriggerKind,
): TriggerOption | null {
  if (kind === 'custom') return null
  return availableTriggers(provider).find((option) => option.kind === kind) ?? null
}

/** The trigger a provider starts on: a new ticket is the least surprising. */
export function defaultTrigger(provider: IntegrationProviderId): IntegrationTrigger {
  const first = availableTriggers(provider)[0]
  return { kind: first?.kind ?? 'created', value: '' }
}

function filtersFor(value: TriggerValueKind, raw: string): WebhookFilters {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  if (value === 'status') return { statuses: [trimmed] }
  if (value === 'label') return { labels: [trimmed] }
  if (value === 'assignee') return { assignees: [trimmed] }
  return {}
}

/**
 * The storage model this trigger means. Both the preview and the write path
 * call this, so what the form promises is what the dispatcher matches on.
 */
export function compileTrigger(
  provider: IntegrationProviderId,
  trigger: IntegrationTrigger,
): { events: string[]; filters: WebhookFilters } {
  if (trigger.kind === 'custom') {
    const events = (trigger.events ?? []).map((id) => id.trim()).filter(Boolean)
    return { events: [...new Set(events)], filters: {} }
  }

  const option = triggerOption(provider, trigger.kind)
  if (!option) return { events: [], filters: {} }
  return {
    events: [...option.events],
    filters: filtersFor(option.value, trigger.value ?? ''),
  }
}

/** One sentence for the preview, and for the automation's description. */
export function describeTrigger(
  provider: IntegrationProviderId,
  trigger: IntegrationTrigger,
): string {
  if (trigger.kind === 'custom') {
    const events = (trigger.events ?? []).filter(Boolean)
    return events.length
      ? `Runs on ${events.join(', ')}.`
      : 'Runs on every event from this connection.'
  }

  const option = triggerOption(provider, trigger.kind)
  if (!option) return 'Runs when this connection delivers a matching event.'

  const value = (trigger.value ?? '').trim()
  const noun = NOUN[provider]
  if (!value) return `Runs when ${option.label}.`

  switch (option.value) {
    case 'status':
      return `Runs when ${an(noun)} moves to ${value}.`
    case 'label':
      return `Runs when ${an(noun)} labelled ${value} changes.`
    case 'assignee':
      return `Runs when ${an(noun)} is assigned to ${value}.`
    default:
      return `Runs when ${option.label}.`
  }
}

/**
 * Recover the trigger behind a stored binding, so an automation created here
 * can be reopened without collapsing to "custom". Anything that does not match
 * a known shape exactly is reported as `custom` rather than guessed at — a
 * wrong guess would silently rewrite the user's binding on the next save.
 */
export function detectTrigger(
  provider: IntegrationProviderId,
  events: string[],
  filters: WebhookFilters,
): IntegrationTrigger {
  const set = new Set(events)
  const sameEvents = availableTriggers(provider).filter(
    (option) => option.events.length === set.size && option.events.every((id) => set.has(id)),
  )

  // No filter at all: read it as the plainest kind that binds these events.
  // Several kinds can share an event id — where a provider has no dedicated
  // label event, "carries a label" and "changes in any way" compile
  // identically, and with no label to match they *are* the same binding.
  if (countFilters(filters) === 0) {
    const plain = sameEvents.find((option) => option.value === 'none') ?? sameEvents[0]
    return plain ? { kind: plain.kind, value: '' } : { kind: 'custom', events: [...events] }
  }

  if (countFilters(filters) === 1) {
    for (const option of sameEvents) {
      const owned = ownedFilter(option.value, filters)
      // Exactly one value, in the filter this kind owns: the builder made it.
      if (owned?.length === 1) return { kind: option.kind, value: owned[0]! }
    }
  }

  // Several filters, several values, or a filter no offered kind owns. The
  // builder cannot round-trip it, and guessing would silently rewrite the
  // user's binding on the next save.
  return { kind: 'custom', events: [...events] }
}

function ownedFilter(value: TriggerValueKind, filters: WebhookFilters): string[] | null {
  if (value === 'status') return filters.statuses ?? null
  if (value === 'label') return filters.labels ?? null
  if (value === 'assignee') return filters.assignees ?? null
  return null
}

function countFilters(filters: WebhookFilters): number {
  return [
    filters.labels,
    filters.projects,
    filters.statuses,
    filters.previousStatuses,
    filters.assignees,
  ].filter((list) => (list?.length ?? 0) > 0).length
}
