#!/usr/bin/env -S node --experimental-strip-types
/**
 * The local CLI: schedule and run coding agents without opening the browser.
 *
 *     openrun schedule task for claude at 16:40 "create new homepage" push and open a PR
 *
 * This is a *client*, not a second copy of the app. Every capability it uses is
 * already described in `src/contract/operations.ts` and reached over
 * `/api/v1/**` with the typed client that contract generates — so the CLI
 * cannot drift from the web UI, and a new automation shows up on the
 * Automations page the moment this exits.
 *
 * Talking HTTP to the running server is also the only thing that *works*. The
 * scheduler is an in-process singleton (`server/scheduler.ts`): a CLI that
 * wrote the `tasks` row straight into SQLite would save an automation that the
 * live server never arms, and the fire would be missed until the next restart.
 *
 * All the judgement lives in `lib/cliSchedule.ts` (what the words mean) and
 * `lib/cliResolve.ts` (which runtime and workspace they name), both pure and
 * unit-tested. This file is argv, HTTP and printing.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OpenRunClient, OpenRunError } from '../src/contract/generated/client.ts'
import {
  deriveTaskName,
  parseCliSchedule,
  promptWithPrIntent,
  type CliIntent,
} from '../src/lib/cliSchedule.ts'
import {
  prCapabilityWarning,
  resolveRuntime,
  resolveTask,
  resolveWorkspace,
  workspaceScheduleWarning,
  type RuntimeChoice,
  type TaskChoice,
  type WorkspaceChoice,
} from '../src/lib/cliResolve.ts'
import { formatNextRunLabel, formatScheduledRunLabel } from '../src/lib/schedule.ts'
import { DEFAULT_HOST } from '../src/lib/serverAccess.ts'
import { openrunEnv } from '../src/lib/openrunEnv.ts'

const USAGE = `openrun — schedule local coding agents from the terminal

Usage
  openrun schedule <what to do> [when] [for <runtime>]   create an automation and arm it
  openrun run <what to do> [for <runtime>]               start a run now, no schedule
  openrun ls                                             automations and when they next fire
  openrun runs [--limit N]                               recent runs
  openrun now <automation>                               fire an automation immediately
  openrun enable <automation>                            arm a paused automation
  openrun disable <automation>                           pause one
  openrun rm <automation>                                delete one
  openrun where                                          server, workspace and runtimes in scope

When
  at 16:40 · at 4:40pm · in 20 minutes · tomorrow at 9    fires once, then pauses
  every day at 9 · every weekday at 8:30 · every monday   recurring
  every 15 minutes · hourly · cron "0 9 * * 1-5"

Options
  --dry-run            show what would be created, write nothing
  --json               machine-readable output
  --for, --runtime X   runtime to use, same as "for X"
  --model X            model slug
  --in X               workspace: a path, project name or branch (default: $PWD's)
  --name X             automation name (default: derived from the prompt)
  --cron X             raw cron expression
  --limit N            rows for "runs"
  --url X              server origin (default http://${DEFAULT_HOST}:3000, $OPENRUN_URL)
  --token X            access token ($OPENRUN_ACCESS_TOKEN, else ~/.openrun/access-token)

Anything the parser does not recognise becomes the prompt, so quote the work:
"fix the flaky checkout test". Add "push", "open a PR" or "open a pull request"
and the agent is asked to branch, commit, push and open one — which also makes
the automation refuse to arm unless \`gh\` is authenticated.`

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * The access token, if this install has one.
 *
 * A loopback-only server needs none, which is the common case and why this is
 * best-effort. `server/accessToken.ts` owns writing the file; reading it here
 * saves the user from pasting a token that is already on their own disk.
 */
function storedToken(): string | undefined {
  const fromEnv = openrunEnv('ACCESS_TOKEN')
  if (fromEnv) return fromEnv

  const configured = openrunEnv('HOME')
  const userHome = process.env.HOME ?? process.env.USERPROFILE ?? '.'
  const homes = configured
    ? [configured]
    : [join(userHome, '.openrun'), join(userHome, '.agentops')]
  for (const home of homes) {
    try {
      const stored = readFileSync(join(home, 'access-token'), 'utf8').trim()
      if (stored) return stored
    } catch {
      // No token file is the normal loopback case, not an error.
    }
  }
  return undefined
}

function serverUrl(override: string): string {
  if (override) return override.replace(/\/$/, '')
  const fromEnv = openrunEnv('URL')
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  const host = openrunEnv('HOST') || DEFAULT_HOST
  return `http://${host}:${Number(process.env.PORT || 3000)}`
}

/**
 * Turn a transport failure into the one sentence that actually helps.
 *
 * A refused connection is not a bug report, it is "the app is not running" —
 * and an unauthorised answer on a token-protected install is "tell me the
 * token", which `pnpm token:print` prints.
 */
function explain(err: unknown, url: string): string {
  if (err instanceof OpenRunError) {
    // 401 is the token check; 403 is the host / remote-address refusal, which no
    // token can satisfy — offering one there would send the user the wrong way.
    if (err.status === 401) {
      return `${err.message}\n\nPass --token, or set OPENRUN_ACCESS_TOKEN. Print it with: pnpm token:print`
    }
    return err.message
  }
  const message = err instanceof Error ? err.message : String(err)
  if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(message)) {
    return `Open Run is not answering at ${url}.\n\nStart it with "pnpm start" (or "pnpm dev"), or point the CLI elsewhere with --url.`
  }
  return message
}

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

/** Flags the CLI consumes itself; everything else is left for the parser. */
type GlobalFlags = {
  url: string
  token: string
  dryRun: boolean
  json: boolean
  limit: number
  rest: string[]
}

const VALUE_FLAGS = new Set(['--url', '--token', '--limit'])

function readGlobalFlags(argv: readonly string[]): GlobalFlags {
  const flags: GlobalFlags = { url: '', token: '', dryRun: false, json: false, limit: 0, rest: [] }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const [name, inlineValue] = arg.includes('=')
      ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
      : [arg, undefined]

    if (name === '--dry-run') {
      flags.dryRun = true
      continue
    }
    if (name === '--json') {
      flags.json = true
      continue
    }
    // `--for` is an alias so the prose form has a flag twin; the parser knows
    // `--runtime`, so rewrite rather than duplicate the handling.
    if (name === '--for') {
      flags.rest.push('--runtime', inlineValue ?? argv[++i] ?? '')
      continue
    }
    if (VALUE_FLAGS.has(name)) {
      const value = inlineValue ?? argv[++i] ?? ''
      if (name === '--url') flags.url = value
      else if (name === '--token') flags.token = value
      else flags.limit = Number(value) || 0
      continue
    }
    flags.rest.push(arg)
  }

  return flags
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

const BULLET = '  '

function field(name: string, value: string): string {
  return `${BULLET}${name.padEnd(11)}${value}`
}

function workspaceLabel(workspace: WorkspaceChoice): string {
  const project = workspace.projectName ? `${workspace.projectName} · ` : ''
  return `${project}${workspace.branch || workspace.name}`
}

function runtimeLabel(runtime: RuntimeChoice): string {
  return runtime.label && runtime.label !== runtime.bin
    ? `${runtime.bin} (${runtime.label})`
    : runtime.bin || runtime.label
}

/** `Scheduled Wed, Jan 21, 4:40 PM GMT+1 · then pauses`, reusing the UI's words. */
function scheduleLabel(intent: CliIntent): string {
  const { schedule } = intent
  if (schedule.kind === 'now') return 'immediately, nothing armed'
  if (schedule.kind === 'once') {
    const when = formatScheduledRunLabel(schedule.at) ?? `at ${new Date(schedule.at).toISOString()}`
    return `${when} · then pauses`
  }
  return `${formatNextRunLabel(schedule.cron) ?? 'next run unknown'} · cron "${schedule.cron}"`
}

function printIntent(
  heading: string,
  name: string,
  intent: CliIntent,
  runtime: RuntimeChoice,
  workspace: WorkspaceChoice,
  prompt: string,
): void {
  console.log(`\n${heading}  ${name}\n`)
  console.log(field('Runtime', runtimeLabel(runtime)))
  console.log(field('Workspace', `${workspaceLabel(workspace)}   ${workspace.path}`))
  console.log(field('Fires', scheduleLabel(intent)))
  if (intent.modelHint) console.log(field('Model', intent.modelHint))
  if (intent.openPr) console.log(field('Ships', 'branch, commit, push, open a pull request'))
  console.log(field('Prompt', prompt.split('\n')[0] ?? ''))
  for (const line of prompt.split('\n').slice(1)) {
    if (line.trim()) console.log(`${BULLET}${' '.repeat(11)}${line}`)
  }
}

function warn(message: string | null): void {
  if (message) console.error(`\n! ${message}`)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

type Context = {
  client: OpenRunClient
  flags: GlobalFlags
  url: string
}

async function listOf<T>(client: OpenRunClient, id: string, input?: unknown): Promise<T[]> {
  const rows = await client.call(id, input)
  return Array.isArray(rows) ? (rows as T[]) : []
}

/** Resolve the words on the command line into everything a write needs. */
async function plan(ctx: Context, words: string[]) {
  const parsed = parseCliSchedule(words)
  if (!parsed.ok) return { ok: false as const, error: parsed.error }
  const intent = parsed.intent

  const [runtimes, workspaces] = await Promise.all([
    listOf<RuntimeChoice>(ctx.client, 'runtimes.list'),
    listOf<WorkspaceChoice>(ctx.client, 'workspaces.list', {}),
  ])

  const runtime = resolveRuntime(intent.runtimeHint, runtimes)
  if (!runtime.ok) return { ok: false as const, error: runtime.error }

  const workspace = resolveWorkspace(intent.workspaceHint, process.cwd(), workspaces)
  if (!workspace.ok) return { ok: false as const, error: workspace.error }

  return {
    ok: true as const,
    intent,
    runtime: runtime.value,
    workspace: workspace.value,
    prompt: promptWithPrIntent(intent.prompt, intent.openPr),
    name: intent.name || deriveTaskName(intent.prompt),
  }
}

async function cmdSchedule(ctx: Context, words: string[]): Promise<number> {
  const planned = await plan(ctx, words)
  if (!planned.ok) {
    console.error(planned.error)
    return 1
  }
  const { intent, runtime, workspace, prompt, name } = planned

  if (intent.schedule.kind === 'now') {
    console.error(
      'No time given, so there is nothing to schedule.\n\nAdd one — "at 16:40", "in 20 minutes", "every day at 9" — or use "openrun run" to start it now.',
    )
    return 1
  }

  warn(workspaceScheduleWarning(workspace))
  warn(prCapabilityWarning(runtime, intent.openPr))

  if (ctx.flags.dryRun) {
    if (ctx.flags.json) {
      console.log(
        JSON.stringify(
          { name, prompt, runtimeId: runtime.id, workspaceId: workspace.id, ...intent.schedule },
          null,
          2,
        ),
      )
      return 0
    }
    printIntent('Would schedule', name, intent, runtime, workspace, prompt)
    console.log(`\n${BULLET}Nothing written — drop --dry-run to arm it.\n`)
    return 0
  }

  const saved = (await ctx.client.call('tasks.save', {
    name,
    description: 'Scheduled from the command line.',
    runtimeId: runtime.id,
    prompt,
    cwd: workspace.path,
    workspaceId: workspace.id,
    cron: intent.schedule.cron,
    enabled: true,
    model: intent.modelHint,
    fireOnce: intent.schedule.kind === 'once',
    scheduledAt: intent.schedule.kind === 'once' ? intent.schedule.at : 0,
    // Asking an unattended agent to push means `gh` has to work when it fires,
    // not when it finishes. This is the existing preflight, not a new rule.
    requireGhAuth: intent.openPr,
  })) as { id: string; name: string } | null

  if (ctx.flags.json) {
    console.log(JSON.stringify(saved, null, 2))
    return 0
  }

  printIntent('Scheduled', saved?.name ?? name, intent, runtime, workspace, prompt)
  console.log(`\n${BULLET}${ctx.url}/tasks/${saved?.id ?? ''}\n`)
  return 0
}

async function cmdRun(ctx: Context, words: string[]): Promise<number> {
  const planned = await plan(ctx, words)
  if (!planned.ok) {
    console.error(planned.error)
    return 1
  }
  const { intent, runtime, workspace, prompt } = planned

  if (intent.schedule.kind !== 'now') {
    console.error('"openrun run" starts a run now. Use "openrun schedule" for a time.')
    return 1
  }
  // A run is attended: the user is watching the terminal and can act on a `gh`
  // failure, so the capability note is a schedule-time concern only.
  warn(prCapabilityWarning(runtime, intent.openPr, true))

  if (ctx.flags.dryRun) {
    printIntent('Would run', deriveTaskName(intent.prompt), intent, runtime, workspace, prompt)
    console.log('')
    return 0
  }

  const started = (await ctx.client.call('runs.startChat', {
    workspaceId: workspace.id,
    runtimeId: runtime.id,
    prompt,
    model: intent.modelHint,
  })) as { runId: string } | null

  if (ctx.flags.json) {
    console.log(JSON.stringify(started, null, 2))
    return 0
  }
  console.log(`\nStarted in ${workspaceLabel(workspace)} on ${runtimeLabel(runtime)}`)
  console.log(`${BULLET}${ctx.url}/runs/${started?.runId ?? ''}\n`)
  return 0
}

type TaskRowView = TaskChoice & {
  cron?: string
  fireOnce?: number
  scheduledAt?: number
  runtimeId?: string
  nextRunAt?: number | null
}

async function cmdList(ctx: Context): Promise<number> {
  const tasks = await listOf<TaskRowView>(ctx.client, 'tasks.list')
  if (ctx.flags.json) {
    console.log(JSON.stringify(tasks, null, 2))
    return 0
  }
  if (tasks.length === 0) {
    console.log('No automations yet. Create one: openrun schedule every day at 9 "…"')
    return 0
  }

  console.log('')
  for (const task of tasks) {
    const state = task.enabled ? 'on ' : 'off'
    const when = task.fireOnce
      ? (formatScheduledRunLabel(task.scheduledAt ?? 0) ?? '')
      : (formatNextRunLabel(task.cron ?? '') ?? 'manual only')
    console.log(`${BULLET}${state}  ${task.name.padEnd(40)} ${when}`)
  }
  console.log('')
  return 0
}

type RunRowView = {
  id: string
  taskName?: string
  status?: string
  startedAt?: number
  createdAt?: number
}

async function cmdRuns(ctx: Context): Promise<number> {
  const runs = await listOf<RunRowView>(ctx.client, 'runs.list', {
    limit: ctx.flags.limit || 15,
  })
  if (ctx.flags.json) {
    console.log(JSON.stringify(runs, null, 2))
    return 0
  }
  if (runs.length === 0) {
    console.log('No runs yet.')
    return 0
  }

  console.log('')
  for (const run of runs) {
    const at = run.startedAt || run.createdAt || 0
    const when = at ? new Date(at).toLocaleString() : ''
    console.log(
      `${BULLET}${(run.status ?? '').padEnd(10)} ${(run.taskName ?? run.id).padEnd(40)} ${when}`,
    )
  }
  console.log('')
  return 0
}

/** Look up the automation a one-word argument names, then act on it. */
async function withTask(
  ctx: Context,
  words: string[],
  verb: string,
  act: (task: TaskChoice) => Promise<void>,
): Promise<number> {
  const hint = words.join(' ').trim()
  const tasks = await listOf<TaskChoice>(ctx.client, 'tasks.list')
  const found = resolveTask(hint, tasks)
  if (!found.ok) {
    console.error(found.error)
    return 1
  }
  await act(found.value)
  console.log(`${verb}  ${found.value.name}`)
  return 0
}

async function cmdWhere(ctx: Context): Promise<number> {
  const [runtimes, workspaces] = await Promise.all([
    listOf<RuntimeChoice>(ctx.client, 'runtimes.list'),
    listOf<WorkspaceChoice>(ctx.client, 'workspaces.list', {}),
  ])
  const here = resolveWorkspace('', process.cwd(), workspaces)

  if (ctx.flags.json) {
    console.log(
      JSON.stringify(
        { url: ctx.url, cwd: process.cwd(), workspace: here.ok ? here.value : null, runtimes },
        null,
        2,
      ),
    )
    return 0
  }

  console.log('')
  console.log(field('Server', ctx.url))
  console.log(field('Directory', process.cwd()))
  console.log(
    field('Workspace', here.ok ? `${workspaceLabel(here.value)}   ${here.value.path}` : '—'),
  )
  console.log(field('Runtimes', runtimes.map(runtimeLabel).join(', ') || 'none enabled'))
  if (!here.ok) console.error(`\n${here.error}`)
  console.log('')
  return 0
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main(command: string, ctx: Context): Promise<number> {
  switch (command) {
    case 'schedule':
      return cmdSchedule(ctx, ctx.flags.rest)
    case 'run':
      return cmdRun(ctx, ctx.flags.rest)
    case 'ls':
    case 'list':
      return cmdList(ctx)
    case 'runs':
      return cmdRuns(ctx)
    case 'now':
      return withTask(ctx, ctx.flags.rest, 'Started', async (task) => {
        await ctx.client.call('tasks.runNow', { id: task.id })
      })
    case 'enable':
      return withTask(ctx, ctx.flags.rest, 'Enabled', async (task) => {
        await ctx.client.call('tasks.toggle', { id: task.id, enabled: true })
      })
    case 'disable':
      return withTask(ctx, ctx.flags.rest, 'Disabled', async (task) => {
        await ctx.client.call('tasks.toggle', { id: task.id, enabled: false })
      })
    case 'rm':
    case 'remove':
      return withTask(ctx, ctx.flags.rest, 'Deleted', async (task) => {
        await ctx.client.call('tasks.remove', { id: task.id })
      })
    case 'where':
    case 'whoami':
      return cmdWhere(ctx)
    default:
      console.error(`Unknown command "${command}".\n`)
      console.log(USAGE)
      return 1
  }
}

const argv = process.argv.slice(2)
const command = (argv[0] ?? '').toLowerCase()

if (!command || command === 'help' || command === '--help' || command === '-h') {
  console.log(USAGE)
  // No command at all is a usage error; asking for help is not.
  process.exitCode = command ? 0 : 1
} else {
  const flags = readGlobalFlags(argv.slice(1))
  const url = serverUrl(flags.url)
  const ctx: Context = {
    client: new OpenRunClient({ baseUrl: url, token: flags.token || storedToken() }),
    flags,
    url,
  }

  try {
    process.exitCode = await main(command, ctx)
  } catch (err) {
    console.error(explain(err, url))
    process.exitCode = 1
  }
}
