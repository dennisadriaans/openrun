/**
 * Slack text → typed intent (browser-safe, dependency-free).
 *
 * Parsing lives in `lib/` for the same reason the gates do: it is pure, it is
 * the part most likely to be wrong, and it can be unit-tested without a Slack
 * workspace or a spawned CLI.
 *
 * The grammar is tuned for a thumb on a phone, not for a terminal:
 *   - every verb has a one- or two-letter alias (`r`, `a`, `x`, `y`, `n`)
 *   - runs are addressable as `#1` (most recent) so nobody types `run_ma1b2c3d`
 *   - inside a run's thread, bare text is a follow-up turn — no verb at all
 *
 * That last rule is what makes the integration usable one-handed: you reply to
 * the run like a person and it lands as the next turn.
 */
import type { ParseCommandInput, RunsFilter, SlackIntent } from './types.ts'

/** Ways to name a run: `#3`, `run_ma1b2c3d`, `last`. */
const ORDINAL_REF = /^#?(\d{1,3})$/
const RUN_ID_REF = /^run_[A-Za-z0-9]+$/
const LATEST_WORDS = new Set(['last', 'latest', 'current', 'it', 'this'])

export function looksLikeRunRef(token: string): boolean {
  const t = token.trim()
  if (!t) return false
  return ORDINAL_REF.test(t) || RUN_ID_REF.test(t) || LATEST_WORDS.has(t.toLowerCase())
}

/**
 * Strip the Slack wire format back to what the user actually typed.
 *
 * Slack wraps mentions as `<@U123|name>`, channels as `<#C123|name>` and
 * auto-links URLs as `<https://x|x>`; mobile keyboards add smart quotes and
 * non-breaking spaces. All of it has to go before a verb match can work.
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/<@[UWB][A-Z0-9]*(\|[^>]*)?>/g, ' ')
    .replace(/<#[C][A-Z0-9]*(\|[^>]*)?>/g, ' ')
    .replace(/<(https?:\/\/[^|>]+)(\|[^>]*)?>/g, '$1')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[   ]/g, ' ')
    .replace(/…/g, '...')
    .trim()
}

type Verb =
  | 'help'
  | 'status'
  | 'runs'
  | 'show'
  | 'logs'
  | 'diff'
  | 'automations'
  | 'run_now'
  | 'enable'
  | 'disable'
  | 'cancel'
  | 'say'
  | 'approve'
  | 'deny'

/**
 * Aliases, longest-match-first at the call site. Kept as a flat map rather than
 * regexes so adding a synonym is one line and cannot change another verb.
 */
const VERBS: Record<string, Verb> = {
  help: 'help', h: 'help', '?': 'help', commands: 'help',

  status: 'status', s: 'status', dashboard: 'status', overview: 'status',

  runs: 'runs', r: 'runs', ls: 'runs',

  show: 'show', run: 'show', detail: 'show', details: 'show', open: 'show',

  logs: 'logs', log: 'logs', output: 'logs', tail: 'logs',

  diff: 'diff', changes: 'diff', changed: 'diff',

  automations: 'automations', automation: 'automations', tasks: 'automations',
  task: 'automations', a: 'automations', jobs: 'automations',

  start: 'run_now', trigger: 'run_now', fire: 'run_now', go: 'run_now',

  enable: 'enable', on: 'enable', resume: 'enable',
  disable: 'disable', off: 'disable', pause: 'disable',

  cancel: 'cancel', stop: 'cancel', kill: 'cancel', abort: 'cancel', x: 'cancel',

  say: 'say', msg: 'say', message: 'say', reply: 'say', tell: 'say', m: 'say',
  ask: 'say', steer: 'say', followup: 'say',

  approve: 'approve', allow: 'approve', yes: 'approve', y: 'approve', ok: 'approve',
  deny: 'deny', reject: 'deny', no: 'deny', n: 'deny', nope: 'deny',
}

const RUNS_FILTERS: Record<string, RunsFilter> = {
  active: 'active',
  running: 'active',
  live: 'active',
  all: 'all',
  recent: 'all',
  failed: 'failed',
  failing: 'failed',
  broken: 'failed',
  attention: 'failed',
}

const DEFAULT_RUN_LIMIT = 8
const MAX_RUN_LIMIT = 25

/**
 * `run now <name>` is two tokens but `run <ref>` means "show me that run".
 * Disambiguate before the verb table sees it.
 */
function takeRunNow(tokens: string[]): boolean {
  // Only `run now` — `run it` has to stay free for "show me the current run",
  // since `it` is one of the words that names the latest run.
  return tokens.length >= 2 && tokens[0].toLowerCase() === 'run' && tokens[1].toLowerCase() === 'now'
}

export function parseCommand(input: ParseCommandInput): SlackIntent {
  const text = normalizeText(input.text ?? '')
  const threadRunId = input.threadRunId?.trim() ?? ''

  if (!text) {
    // An empty slash command shows help; an empty thread reply is just noise.
    return threadRunId ? { kind: 'unknown', input: '' } : { kind: 'help' }
  }

  const tokens = text.split(/\s+/)

  if (takeRunNow(tokens)) {
    const ref = tokens.slice(2).join(' ').trim()
    return ref
      ? { kind: 'run_now', ref }
      : { kind: 'needs_ref', verb: 'run now', hint: 'run now <automation name>' }
  }

  const head = tokens[0].toLowerCase().replace(/[:,]$/, '')
  const verb = VERBS[head]
  const rest = tokens.slice(1)

  // No recognised verb. Inside a run thread that is the common case — the user
  // is talking to the agent, not to us — so it becomes the next turn.
  if (!verb) {
    if (threadRunId) return { kind: 'say', ref: threadRunId, text }
    return { kind: 'unknown', input: text }
  }

  switch (verb) {
    case 'help':
      return { kind: 'help' }

    case 'status':
      return { kind: 'status' }

    case 'runs': {
      let filter: RunsFilter = 'active'
      let limit = DEFAULT_RUN_LIMIT
      for (const token of rest) {
        const lower = token.toLowerCase()
        if (RUNS_FILTERS[lower]) filter = RUNS_FILTERS[lower]
        else if (/^\d{1,3}$/.test(lower)) {
          limit = Math.min(MAX_RUN_LIMIT, Math.max(1, Number(lower)))
        }
      }
      return { kind: 'runs', filter, limit }
    }

    case 'automations':
      return { kind: 'automations' }

    case 'run_now': {
      const ref = rest.join(' ').trim()
      return ref
        ? { kind: 'run_now', ref }
        : { kind: 'needs_ref', verb: 'start', hint: 'start <automation name>' }
    }

    case 'enable':
    case 'disable': {
      const ref = rest.join(' ').trim()
      return ref
        ? { kind: 'set_enabled', ref, enabled: verb === 'enable' }
        : { kind: 'needs_ref', verb, hint: `${verb} <automation name>` }
    }

    case 'show':
    case 'logs':
    case 'diff': {
      const ref = resolveRef(rest, threadRunId)
      if (!ref) return { kind: 'needs_ref', verb, hint: `${verb} #1` }
      if (verb === 'logs') return { kind: 'logs', ref }
      if (verb === 'diff') return { kind: 'diff', ref }
      return { kind: 'run_detail', ref }
    }

    case 'cancel': {
      const ref = resolveRef(rest, threadRunId)
      return ref
        ? { kind: 'cancel', ref }
        : { kind: 'needs_ref', verb: 'cancel', hint: 'cancel #1' }
    }

    case 'approve':
    case 'deny': {
      const decision = verb === 'approve' ? 'allow' : 'deny'
      const ref = resolveRef(rest, threadRunId)
      return ref
        ? { kind: 'approve', ref, decision }
        : { kind: 'needs_ref', verb, hint: `${verb} #1` }
    }

    case 'say': {
      // `say #2 keep going` targets a run; `say keep going` uses the thread's.
      let ref = threadRunId
      let words = rest
      if (rest.length > 0 && looksLikeRunRef(rest[0])) {
        ref = rest[0]
        words = rest.slice(1)
      }
      const message = words.join(' ').trim()
      if (!ref) return { kind: 'needs_ref', verb: 'say', hint: 'say #1 <message>' }
      if (!message) {
        return { kind: 'needs_ref', verb: 'say', hint: 'say #1 <message>' }
      }
      return { kind: 'say', ref, text: message }
    }
  }
}

/**
 * A run target from the leading tokens, falling back to the thread's run.
 * Anything that is not ref-shaped is ignored rather than guessed at — steering
 * the wrong run is worse than asking again.
 */
function resolveRef(tokens: string[], threadRunId: string): string {
  const first = tokens[0]?.trim()
  if (first && looksLikeRunRef(first)) return first
  return threadRunId
}

/** The help card's body — also what an unrecognised command gets told. */
export const SLACK_HELP_LINES: ReadonlyArray<[string, string]> = [
  ['status', 'what is running right now'],
  ['runs [active|all|failed] [n]', 'recent runs, newest first'],
  ['show #1', 'one run: status, checks, last reply'],
  ['logs #1', 'tail of that run’s output'],
  ['diff #1', 'files the run changed'],
  ['automations', 'every automation and its schedule'],
  ['start <name>', 'run an automation now'],
  ['enable <name> / disable <name>', 'arm or pause a schedule'],
  ['say #1 <message>', 'send the run another turn'],
  ['approve #1 / deny #1', 'answer a supervised tool prompt'],
  ['cancel #1', 'stop a run'],
]
