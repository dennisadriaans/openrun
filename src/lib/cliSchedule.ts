/**
 * Turn a spoken-shape command line into an automation.
 *
 *     openrun schedule task for claude at 16:40 "build the homepage" \
 *       push and open a pull request when done
 *
 * has to become a `tasks.save` payload with no model in the loop. Open Run
 * drives CLIs the user is already logged into and holds no API keys, so a
 * hosted natural-language parser is not available to it — see the open-core
 * rule in AGENTS.md. What makes a deterministic parse tractable is that the
 * shell has already done the hard part: a quoted prompt arrives as a single
 * argv element with spaces in it, and everything around it is a short keyword
 * phrase from a closed vocabulary.
 *
 * So this module reads argv left to right, consumes the phrases it recognises,
 * and treats whatever is left as the prompt. Recognising nothing is not a
 * failure — `openrun schedule "fix the flaky test"` is a valid line that only
 * needs a time.
 *
 * Hints are resolved to ids in `cliResolve.ts`; the schedule is normalised to
 * exactly what `upsertTask` stores — a cron expression, plus an absolute
 * timestamp when the automation fires once.
 *
 * Pure and browser-safe. No `node:` imports, no cron library: a one-shot time
 * is plain `Date` arithmetic, and the cron string is assembled from its fields.
 */

/** What the scheduler is being asked for, in the shape `upsertTask` stores. */
export type CliSchedule =
  /** Run immediately; nothing is armed. */
  | { kind: 'now' }
  /** Fire once at an absolute time, then pause. `cron` is the daily fallback. */
  | { kind: 'once'; cron: string; at: number }
  /** Arm a recurring cron schedule. */
  | { kind: 'recurring'; cron: string }

/** Everything the command line said, before any of it is resolved to an id. */
export type CliIntent = {
  /** What the agent is asked to do. Never empty in a successful parse. */
  prompt: string
  schedule: CliSchedule
  /** Runtime as typed (`claude`, `codex`); empty when the line did not say. */
  runtimeHint: string
  /** Model slug as typed; empty when the line did not say. */
  modelHint: string
  /** Workspace as a path, project name or branch; empty when not stated. */
  workspaceHint: string
  /**
   * The agent should land its work — branch, commit, push, open a pull
   * request. Set by `pull request`, a standalone `pr`, or `push`, because all
   * three need the same thing of the machine: a usable `gh` login.
   */
  openPr: boolean
  /** Automation name from `--name`; empty means derive one from the prompt. */
  name: string
}

export type CliParse = { ok: true; intent: CliIntent } | { ok: false; error: string }

/** Words that introduce the runtime: `for claude`, `with codex`, `using grok`. */
const RUNTIME_LEAD = new Set(['for', 'with', 'using'])

/** Dropped from an unquoted prompt — they name the thing, not the work. */
const NOISE = new Set([
  'task',
  'automation',
  'job',
  'a',
  'an',
  'the',
  'and',
  'then',
  'to',
  'please',
])

/** Filler around a "land the work" phrase: `… when done`, `… afterwards`. */
const PR_FILLER = new Set(['when', 'once', 'after', 'done', 'finished', 'afterwards', 'it', 'its'])

const DOW: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
}

const MINUTE_UNITS = new Set(['minute', 'minutes', 'min', 'mins', 'm'])
const HOUR_UNITS = new Set(['hour', 'hours', 'hr', 'hrs', 'h'])
const DAY_UNITS = new Set(['day', 'days', 'd'])

/** `16:40`, `4:40pm`, `4pm`, `09.30`, `16h40`, and a bare `9` after `at`. */
export function parseClockTime(raw: string): { hour: number; minute: number } | null {
  const token = raw.trim().toLowerCase()
  if (!token) return null

  const match = /^(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm)?$/.exec(token)
  if (!match) return null

  let hour = Number(match[1])
  const minute = match[2] === undefined ? 0 : Number(match[2])
  const meridiem = match[3]

  if (minute > 59) return null
  if (meridiem) {
    if (hour < 1 || hour > 12) return null
    if (meridiem === 'pm' && hour !== 12) hour += 12
    if (meridiem === 'am' && hour === 12) hour = 0
  } else if (hour > 23) return null

  return { hour, minute }
}

/** A cron expression that fires daily at `hour`:`minute`. */
export function dailyCron(hour: number, minute: number): string {
  return `${minute} ${hour} * * *`
}

/**
 * The next time today or tomorrow reads `hour`:`minute`.
 *
 * Local time throughout — the scheduler arms node-cron in the machine
 * timezone, so a CLI that resolved `16:40` in UTC would fire at the wrong
 * moment. `dayOffset` is how `tomorrow at 9` skips today's occurrence.
 */
export function nextClockOccurrence(
  hour: number,
  minute: number,
  now: Date,
  dayOffset = 0,
): number {
  const at = new Date(now.getTime())
  at.setHours(hour, minute, 0, 0)
  at.setDate(at.getDate() + dayOffset)
  if (dayOffset === 0 && at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1)
  return at.getTime()
}

/** A one-shot schedule for an absolute instant, with its daily cron fallback. */
function onceAt(at: number): CliSchedule {
  const date = new Date(at)
  return { kind: 'once', cron: dailyCron(date.getHours(), date.getMinutes()), at }
}

/** `20 minutes` / `2h` / `1 day` as milliseconds; null when it is not a span. */
function parseDuration(amount: string, unit: string | undefined): number | null {
  if (!/^\d+$/.test(amount)) return null
  const n = Number(amount)
  if (n <= 0) return null
  const u = (unit ?? 'minutes').toLowerCase()
  if (MINUTE_UNITS.has(u)) return n * 60_000
  if (HOUR_UNITS.has(u)) return n * 3_600_000
  if (DAY_UNITS.has(u)) return n * 86_400_000
  return null
}

/** A recurring `every N minutes/hours` step, as a cron expression. */
function intervalCron(amount: string, unit: string | undefined): string | null {
  if (!/^\d+$/.test(amount)) return null
  const n = Number(amount)
  const u = (unit ?? '').toLowerCase()
  if (MINUTE_UNITS.has(u) && n >= 1 && n <= 59) return `*/${n} * * * *`
  if (HOUR_UNITS.has(u) && n >= 1 && n <= 23) return `0 */${n} * * *`
  return null
}

/** True for a token that starts a phrase, so it cannot also be a phrase's value. */
function isKeyword(token: string): boolean {
  const t = token.toLowerCase()
  return (
    RUNTIME_LEAD.has(t) ||
    t === 'at' ||
    t === 'every' ||
    t === 'in' ||
    t === 'on' ||
    t === 'cron' ||
    t.startsWith('--')
  )
}

/**
 * A scanner position that may consume a clock time spread over two tokens
 * (`at 4 pm`) as well as one (`at 16:40`).
 */
function readClock(
  tokens: string[],
  index: number,
): { hour: number; minute: number; next: number } | null {
  const first = tokens[index]
  if (first === undefined) return null

  const joined = tokens[index + 1] !== undefined ? `${first}${tokens[index + 1]}` : null
  if (joined) {
    const meridiem = /^(am|pm)$/i.test(tokens[index + 1] ?? '')
    const two = meridiem ? parseClockTime(joined) : null
    if (two) return { ...two, next: index + 2 }
  }

  const one = parseClockTime(first)
  return one ? { ...one, next: index + 1 } : null
}

/**
 * Parse the words after `openrun schedule` (or `openrun run`).
 *
 * `now` seeds every relative time, so a test can pin the clock. When the line
 * names no schedule the result is `{ kind: 'now' }` and the caller decides
 * whether that is a refusal (`schedule`) or the point (`run`).
 */
export function parseCliSchedule(argv: readonly string[], now = new Date()): CliParse {
  const tokens = argv.filter((t) => t.length > 0)
  if (tokens.length === 0) return { ok: false, error: 'Nothing to schedule.' }

  let schedule: CliSchedule | null = null
  let runtimeHint = ''
  let modelHint = ''
  let workspaceHint = ''
  let name = ''
  let explicitNow = false
  const leftover: string[] = []

  /** `--flag value` and `--flag=value` both reach the same assignment. */
  function flagValue(token: string, index: number): { value: string; next: number } | null {
    const eq = token.indexOf('=')
    if (eq !== -1) return { value: token.slice(eq + 1), next: index + 1 }
    const next = tokens[index + 1]
    if (next === undefined) return null
    return { value: next, next: index + 2 }
  }

  let i = 0
  while (i < tokens.length) {
    const raw = tokens[i]!
    const token = raw.toLowerCase()

    if (token.startsWith('--')) {
      const flag = token.split('=')[0]!
      const taken = flagValue(raw, i)
      if (!taken) return { ok: false, error: `"${flag}" needs a value.` }
      if (flag === '--runtime') runtimeHint = taken.value
      else if (flag === '--model') modelHint = taken.value
      else if (flag === '--workspace' || flag === '--in') workspaceHint = taken.value
      else if (flag === '--name') name = taken.value
      else if (flag === '--cron') schedule = { kind: 'recurring', cron: taken.value }
      else return { ok: false, error: `Unknown option "${flag}".` }
      i = taken.next
      continue
    }

    if (RUNTIME_LEAD.has(token)) {
      const value = tokens[i + 1]
      // `with` also reads naturally inside a prompt ("homepage with a contact
      // form"), so only claim it when the next word could actually name a
      // runtime: not a keyword, not quoted, not an article, and not a second
      // runtime after one was already given.
      if (
        value !== undefined &&
        !isKeyword(value) &&
        !runtimeHint &&
        !value.includes(' ') &&
        !NOISE.has(value.toLowerCase())
      ) {
        runtimeHint = value
        i += 2
        continue
      }
      leftover.push(raw)
      i += 1
      continue
    }

    if (token === 'cron') {
      const value = tokens[i + 1]
      if (value === undefined) return { ok: false, error: '"cron" needs an expression.' }
      schedule = { kind: 'recurring', cron: value }
      i += 2
      continue
    }

    if (token === 'now' || token === 'immediately') {
      explicitNow = true
      i += 1
      continue
    }

    if (token === 'at') {
      const clock = readClock(tokens, i + 1)
      if (!clock) {
        return {
          ok: false,
          error: `"at ${tokens[i + 1] ?? ''}" is not a time. Try "at 16:40" or "at 4:40pm".`,
        }
      }
      // `every day at 9` already chose recurring; `at 9` on its own is a
      // one-shot, which is what "run this at 16:40" means to a person.
      if (schedule?.kind === 'recurring') {
        schedule = { kind: 'recurring', cron: withClock(schedule.cron, clock.hour, clock.minute) }
      } else if (schedule?.kind === 'once') {
        const day = new Date(schedule.at)
        day.setHours(clock.hour, clock.minute, 0, 0)
        schedule = onceAt(day.getTime())
      } else {
        schedule = onceAt(nextClockOccurrence(clock.hour, clock.minute, now))
      }
      i = clock.next
      continue
    }

    if (token === 'tomorrow') {
      schedule = onceAt(nextClockOccurrence(9, 0, now, 1))
      i += 1
      continue
    }

    if (token === 'today' || token === 'tonight') {
      const hour = token === 'tonight' ? 20 : 9
      schedule = onceAt(nextClockOccurrence(hour, 0, now))
      i += 1
      continue
    }

    if (token === 'in') {
      const span = parseDuration(tokens[i + 1] ?? '', tokens[i + 2])
      if (span !== null) {
        schedule = onceAt(now.getTime() + span)
        i += 3
        continue
      }
      const value = tokens[i + 1]
      if (value !== undefined && !isKeyword(value) && !workspaceHint) {
        workspaceHint = value
        i += 2
        continue
      }
      leftover.push(raw)
      i += 1
      continue
    }

    if (token === 'every') {
      const result = readEvery(tokens, i + 1)
      if (!result) return { ok: false, error: `"every ${tokens[i + 1] ?? ''}" is not a schedule.` }
      schedule = { kind: 'recurring', cron: result.cron }
      i = result.next
      continue
    }

    if (token === 'daily') {
      schedule = { kind: 'recurring', cron: dailyCron(9, 0) }
      i += 1
      continue
    }

    if (token === 'hourly') {
      schedule = { kind: 'recurring', cron: '0 * * * *' }
      i += 1
      continue
    }

    if (token === 'weekly') {
      schedule = { kind: 'recurring', cron: '0 9 * * 1' }
      i += 1
      continue
    }

    if (token === 'on' && DOW[(tokens[i + 1] ?? '').toLowerCase()] !== undefined) {
      schedule = { kind: 'recurring', cron: `0 9 * * ${DOW[tokens[i + 1]!.toLowerCase()]}` }
      i += 2
      continue
    }

    leftover.push(raw)
    i += 1
  }

  const { prompt, openPr } = readPromptAndPrIntent(leftover)
  if (!prompt) {
    return {
      ok: false,
      error: 'No prompt found. Put the work in quotes, e.g. "fix the flaky checkout test".',
    }
  }

  return {
    ok: true,
    intent: {
      prompt,
      schedule: explicitNow ? { kind: 'now' } : (schedule ?? { kind: 'now' }),
      runtimeHint,
      modelHint,
      workspaceHint,
      openPr,
      name,
    },
  }
}

/** Replace the minute and hour fields of an existing cron expression. */
function withClock(cron: string, hour: number, minute: number): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return cron
  return `${minute} ${hour} ${parts[2]} ${parts[3]} ${parts[4]}`
}

/**
 * Read what follows `every`: `day`, `weekday`, a weekday name, `hour`, or a
 * `N minutes` step. A following `at <time>` is handled by the main loop, which
 * overwrites the placeholder hour and minute this leaves behind.
 */
function readEvery(
  tokens: readonly string[],
  index: number,
): { cron: string; next: number } | null {
  const first = (tokens[index] ?? '').toLowerCase()
  if (!first) return null

  if (first === 'day') return { cron: dailyCron(9, 0), next: index + 1 }
  if (first === 'hour') return { cron: '0 * * * *', next: index + 1 }
  if (first === 'week') return { cron: '0 9 * * 1', next: index + 1 }
  if (first === 'weekday' || first === 'weekdays') return { cron: '0 9 * * 1-5', next: index + 1 }
  if (first === 'morning') return { cron: dailyCron(9, 0), next: index + 1 }
  if (first === 'night' || first === 'evening') return { cron: dailyCron(20, 0), next: index + 1 }

  const dow = DOW[first]
  if (dow !== undefined) return { cron: `0 9 * * ${dow}`, next: index + 1 }

  const interval = intervalCron(first, tokens[index + 1])
  if (interval) return { cron: interval, next: index + 2 }

  return null
}

/**
 * Split the unconsumed words into a prompt and a "land the work" flag.
 *
 * A token containing a space was quoted on the command line, which makes it
 * the most reliable prompt signal there is — when any exist, they *are* the
 * prompt and the bare words around them are instructions about it. With none,
 * the bare words are the prompt, minus the phrases read off them here.
 */
export function readPromptAndPrIntent(leftover: readonly string[]): {
  prompt: string
  openPr: boolean
} {
  const quoted = leftover.filter((t) => /\s/.test(t))
  const bare = leftover.filter((t) => !/\s/.test(t))

  let openPr = false
  const kept: string[] = []

  for (let i = 0; i < bare.length; i++) {
    const word = bare[i]!.toLowerCase().replace(/[.,!]+$/, '')
    const next = (bare[i + 1] ?? '').toLowerCase().replace(/[.,!]+$/, '')

    if (word === 'pull' && next === 'request') {
      openPr = true
      i += 1
      continue
    }
    if (word === 'pr' || word === 'prs' || word === 'push' || word === 'pull-request') {
      openPr = true
      continue
    }
    kept.push(bare[i]!)
  }

  // `open`, `create`, `when done` are only noise once a PR phrase claimed the
  // sentence they belonged to; on their own they can be the actual work
  // ("create new homepage"), so they survive when nothing set the flag.
  const words = openPr
    ? kept.filter((w) => {
        const lower = w.toLowerCase().replace(/[.,!]+$/, '')
        return !PR_FILLER.has(lower) && lower !== 'open' && lower !== 'create' && lower !== 'opens'
      })
    : kept

  if (quoted.length > 0) {
    // A quoted prompt may itself ask for a pull request; the flag still has to
    // be set, since it is what puts the `gh` preflight on the automation.
    const joined = quoted.join(' ')
    if (/\bpull request\b|\bpr\b/i.test(joined)) openPr = true
    return { prompt: joined.trim(), openPr }
  }

  const meaningful = words.filter((w) => !NOISE.has(w.toLowerCase()))
  return { prompt: meaningful.join(' ').trim(), openPr }
}

/**
 * A short automation name derived from the prompt.
 *
 * The list view shows names, so "create new homepage with contactform" reads
 * better truncated on a word boundary than hard-cut mid-word.
 */
export function deriveTaskName(prompt: string, limit = 48): string {
  const flat = prompt.replace(/\s+/g, ' ').trim()
  if (flat.length <= limit) return flat
  const cut = flat.slice(0, limit)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/** The instruction appended to a prompt when the line asked for a pull request. */
export const CLI_PR_INSTRUCTION =
  'When the work is done, create a branch, commit it, push it, and open a pull request.'

/** The prompt as the agent should receive it. */
export function promptWithPrIntent(prompt: string, openPr: boolean): string {
  if (!openPr) return prompt
  if (/\bpull request\b|\bpr\b/i.test(prompt)) return prompt
  return `${prompt.trimEnd()}\n\n${CLI_PR_INSTRUCTION}`
}
