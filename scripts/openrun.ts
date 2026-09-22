#!/usr/bin/env -S node --experimental-strip-types
/** CLI over the shared contract: local IPC by default, HTTP only with --url. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { commandCorrection, readCliArgs, requestsUnattended, type GlobalFlags } from './cli/args.ts'
import { cliHelp } from './cli/help.ts'
import { accent, Cancelled, CliUi, commandMenu, interactiveTerminal } from './cli/ui.ts'
import { guideRun, manageRuntimes, registerProject } from './cli/guided.ts'
import {
  ensureLocalRuntime,
  localStatus,
  stopLocalRuntime,
  unavailable,
  type CliClient,
} from './cli/local.ts'
import { integrations, authorize } from './cli/integrations.ts'
import { openrunHome } from '../src/server/paths.ts'
import { OPERATIONS } from '../src/contract/operations.ts'
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
import { isLoopbackHost } from '../src/lib/serverAccess.ts'
import { openrunEnv } from '../src/lib/openrunEnv.ts'

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
function storedToken(url: string): string | undefined {
  const fromEnv = openrunEnv('ACCESS_TOKEN')
  if (fromEnv) return fromEnv
  // A remote server must not receive this machine's token implicitly.
  if (!isLoopbackHost(new URL(url).hostname)) return undefined

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
  const raw = override || openrunEnv('URL') || ''
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:') return raw.replace(/\/$/, '')
  } catch {
    // Show an example rather than the URL parser's internal error.
  }
  throw new Error('--url needs an HTTP or HTTPS URL, such as http://localhost:3000.')
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
  client: CliClient
  flags: GlobalFlags
  url: string
  ui: CliUi
}

async function listOf<T>(client: CliClient, id: string, input?: unknown): Promise<T[]> {
  const rows = await client.call(id, input)
  return Array.isArray(rows) ? (rows as T[]) : []
}

/** Resolve the words on the command line into everything a write needs. */
async function plan(ctx: Context, intent: CliIntent) {
  const [runtimes, workspaces] = await Promise.all([
    listOf<RuntimeChoice>(ctx.client, 'runtimes.list'),
    listOf<WorkspaceChoice>(ctx.client, 'workspaces.list', {}),
  ])

  const runtime = resolveRuntime(intent.runtimeHint, runtimes)
  if (!runtime.ok) return { ok: false as const, error: runtime.error }

  const workspace = resolveWorkspace(intent.workspaceHint, ctx.url ? '' : process.cwd(), workspaces)
  if (!workspace.ok) return { ok: false as const, error: workspace.error }

  return {
    ok: true as const,
    runtime: runtime.value,
    workspace: workspace.value,
    prompt: promptWithPrIntent(intent.prompt, intent.openPr),
    name: intent.name || deriveTaskName(intent.prompt),
  }
}

async function cmdSchedule(ctx: Context, intent: CliIntent): Promise<number> {
  if (intent.schedule.kind === 'now')
    throw new Error(
      'Add a time such as "at 16:40" or "every day at 9", or use "openrun run" to start now.',
    )
  const planned = await plan(ctx, intent)
  if (!planned.ok) throw new Error(planned.error)
  const { runtime, workspace, prompt, name } = planned

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
    if (ctx.ui.interactive) {
      ctx.ui.done('Preview complete. No automation created.')
      return 0
    }
    printIntent('Would schedule', name, intent, runtime, workspace, prompt)
    console.log(`\n${BULLET}No automation created. Drop --dry-run to schedule it.\n`)
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
  ctx.ui.rememberRuntime(runtime.id)

  if (ctx.flags.json) {
    console.log(JSON.stringify(saved, null, 2))
    return 0
  }

  if (ctx.ui.interactive) {
    ctx.ui.done(
      `Scheduled · ${saved?.name ?? name}\n\nNext: openrun automations\nPause: openrun disable ${saved?.id ?? ''}`,
    )
    return 0
  }
  printIntent('Scheduled', saved?.name ?? name, intent, runtime, workspace, prompt)
  console.log(
    `\n${BULLET}${ctx.url ? `${ctx.url}/tasks/${saved?.id ?? ''}` : `Automation: ${saved?.id ?? ''}`}\n`,
  )
  if (saved) console.log(`Next: openrun automations list\nPause: openrun disable ${saved.id}\n`)
  return 0
}

async function cmdRun(ctx: Context, intent: CliIntent): Promise<number> {
  if (intent.schedule.kind !== 'now')
    throw new Error(
      '"openrun run" starts now. Use "openrun schedule" for a time, or --prompt for literal text.',
    )
  const planned = await plan(ctx, intent)
  if (!planned.ok) throw new Error(planned.error)
  const { runtime, workspace, prompt } = planned
  // A run is attended: the user is watching the terminal and can act on a `gh`
  // failure, so the capability note is a schedule-time concern only.
  warn(prCapabilityWarning(runtime, intent.openPr, true))

  if (ctx.flags.dryRun) {
    if (ctx.flags.json) {
      console.log(
        JSON.stringify(
          { prompt, runtimeId: runtime.id, workspaceId: workspace.id, model: intent.modelHint },
          null,
          2,
        ),
      )
      return 0
    }
    if (ctx.ui.interactive) {
      ctx.ui.done('Preview complete. No run created.')
      return 0
    }
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
  ctx.ui.rememberRuntime(runtime.id)

  if (ctx.flags.json) {
    console.log(JSON.stringify(started, null, 2))
    return 0
  }
  if (ctx.ui.interactive) {
    ctx.ui.done(
      `Running with ${runtime.label || runtime.bin} · ${workspaceLabel(workspace)}\n\nRead the conversation: openrun show ${started?.runId ?? ''}`,
    )
    return 0
  }
  console.log(`\nStarted in ${workspaceLabel(workspace)} on ${runtimeLabel(runtime)}`)
  console.log(
    `${BULLET}${ctx.url ? `${ctx.url}/runs/${started?.runId ?? ''}` : `openrun show ${started?.runId ?? ''}`}\n`,
  )
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
    if (ctx.ui.interactive) {
      ctx.ui.info('No automations yet. Let’s give your agent something to come back to.')
      if (await ctx.ui.confirm('Create your first schedule?'))
        return main('schedule', { ...ctx, flags: { ...ctx.flags, rest: [] } })
    } else console.log('No automations yet. Create one: openrun schedule every day at 9 "…"')
    return 0
  }

  if (ctx.ui.interactive) {
    const id = await ctx.ui.select('Your automations', [
      ...tasks.map((task) => ({
        value: task.id,
        label: task.name,
        hint: task.enabled ? 'enabled' : 'paused',
      })),
      { value: ':new', label: 'Create a schedule' },
      { value: ':exit', label: 'Done' },
    ])
    if (id === ':exit') return 0
    if (id === ':new') return main('schedule', { ...ctx, flags: { ...ctx.flags, rest: [] } })
    const task = tasks.find((row) => row.id === id)!
    ctx.ui.note(
      `${task.name}\n${task.id}\n${task.enabled ? (task.fireOnce ? formatScheduledRunLabel(task.scheduledAt ?? 0) : formatNextRunLabel(task.cron ?? '')) : 'Paused'}`,
      'Automation',
    )
    const action = await ctx.ui.select('Manage this automation', [
      { value: ':exit', label: 'Done' },
      { value: 'now', label: 'Run now' },
      {
        value: task.enabled ? 'disable' : 'enable',
        label: task.enabled ? 'Pause schedule' : 'Enable schedule',
      },
      { value: 'rm', label: 'Delete automation' },
    ])
    return action === ':exit' ? 0 : main(action, { ...ctx, flags: { ...ctx.flags, rest: [id] } })
  }

  console.log('')
  for (const task of tasks) {
    const state = task.enabled ? 'on ' : 'off'
    const when = !task.enabled
      ? 'paused'
      : task.fireOnce
        ? (formatScheduledRunLabel(task.scheduledAt ?? 0) ?? '')
        : (formatNextRunLabel(task.cron ?? '') ?? 'manual only')
    console.log(`${BULLET}${task.id}  ${state}  ${task.name.padEnd(40)} ${when}`)
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
  cwd?: string
  error?: string
}

type ConversationView = {
  messages: { role: string; content: string; stdout?: string; stderr?: string }[]
  runtime?: { label: string } | null
}

function printConversation(run: RunRowView, conversation: ConversationView | null): void {
  console.log(`\n${run.taskName ?? run.id}\n`)
  console.log(field('Run', run.id))
  console.log(field('Status', run.status ?? 'unknown'))
  if (conversation?.runtime) console.log(field('Runtime', conversation.runtime.label))
  if (run.cwd) console.log(field('Directory', run.cwd))
  if (run.error) console.log(field('Error', run.error))
  for (const message of conversation?.messages ?? []) {
    const text = message.content || message.stdout || ''
    if (text.trim()) console.log(`\n${message.role === 'user' ? 'You' : 'Agent'}\n${text.trim()}`)
    if (message.stderr?.trim()) console.log(`\nDiagnostics\n${message.stderr.trim()}`)
  }
  if (run.status === 'running')
    console.log(`\nStill running. Refresh: openrun show ${run.id}\nStop: openrun cancel ${run.id}`)
  console.log('')
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
    if (ctx.ui.interactive) {
      ctx.ui.info('No runs yet.')
      if (await ctx.ui.confirm('Start your first task?'))
        return main('run', { ...ctx, flags: { ...ctx.flags, rest: [] } })
    } else console.log('No runs yet.')
    return 0
  }

  if (ctx.ui.interactive) {
    const id = await ctx.ui.select('Recent runs · choose one to read', [
      ...runs.map((run) => ({
        value: run.id,
        label: run.taskName || run.id,
        hint: `${run.status ?? ''} · ${run.id}`,
      })),
      { value: ':exit', label: 'Done' },
    ])
    return id === ':exit' ? 0 : main('show', { ...ctx, flags: { ...ctx.flags, rest: [id] } })
  }

  console.log('')
  for (const run of runs) {
    const at = run.startedAt || run.createdAt || 0
    const when = at ? new Date(at).toLocaleString() : ''
    console.log(
      `${BULLET}${run.id}  ${(run.status ?? '').padEnd(10)} ${(run.taskName ?? run.id).padEnd(40)} ${when}`,
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
  act: (task: TaskChoice) => Promise<unknown>,
): Promise<number> {
  const hint = words.join(' ').trim()
  const tasks = await listOf<TaskChoice>(ctx.client, 'tasks.list')
  const found = resolveTask(hint, tasks)
  let task = found.ok ? found.value : undefined
  if (!task && ctx.ui.interactive && tasks.length) {
    if (hint && !found.ok) ctx.ui.info(found.error)
    const id = await ctx.ui.select(
      'Choose an automation',
      tasks.map((row) => ({
        value: row.id,
        label: row.name,
        hint: `${row.enabled ? 'enabled' : 'paused'} · ${row.id}`,
      })),
    )
    task = tasks.find((row) => row.id === id)!
  }
  if (!task) {
    if (ctx.ui.interactive && !tasks.length) {
      ctx.ui.info('No automations yet.')
      if (await ctx.ui.confirm('Create your first schedule?'))
        return main('schedule', { ...ctx, flags: { ...ctx.flags, rest: [] } })
      return 0
    }
    throw new Error(found.ok ? 'Choose an automation.' : found.error)
  }
  if (
    ctx.ui.interactive &&
    !(await ctx.ui.confirm(
      `${verb === 'Started' ? 'Run' : verb === 'Deleted' ? 'Delete' : verb === 'Enabled' ? 'Enable' : 'Pause'} “${task.name}”?`,
      verb !== 'Deleted',
    ))
  )
    throw new Cancelled('Automation unchanged.')
  const result = (await act(task)) as { runId?: string } | undefined
  const runId = result?.runId
  console.log(
    ctx.flags.json
      ? JSON.stringify({
          id: task.id,
          name: task.name,
          action: verb.toLowerCase(),
          ...(runId ? { runId } : {}),
        })
      : `${accent(verb)}  ${task.name}`,
  )
  if (runId && !ctx.flags.json) console.log(`Next: openrun show ${runId}`)
  return 0
}

async function cmdWhere(ctx: Context): Promise<number> {
  const [runtimes, workspaces] = await Promise.all([
    listOf<RuntimeChoice>(ctx.client, 'runtimes.list'),
    listOf<WorkspaceChoice>(ctx.client, 'workspaces.list', {}),
  ])
  const here = resolveWorkspace('', ctx.url ? '' : process.cwd(), workspaces)

  if (ctx.flags.json) {
    console.log(
      JSON.stringify(
        {
          mode: ctx.url ? 'remote' : 'local',
          url: ctx.url || null,
          home: ctx.url ? null : openrunHome(),
          cwd: process.cwd(),
          workspace: here.ok ? here.value : null,
          runtimes,
        },
        null,
        2,
      ),
    )
    return 0
  }

  console.log('')
  console.log(field('Runtime', ctx.url || `local · ${openrunHome()}`))
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
    case 'worker':
      return cmdWorker(ctx)
    case 'init': {
      const args = [...ctx.flags.rest]
      const pathArg = args.find((arg) => !arg.startsWith('--'))
      if (pathArg) args.splice(args.indexOf(pathArg), 1)
      const checks: { id: string; name: string; command: string }[] = []
      for (const arg of args) {
        const command = arg.slice('--check='.length).trim()
        if (!command) throw new Error('--check needs a verification command, such as "pnpm test".')
        checks.push({ id: `cli-check-${checks.length + 1}`, name: command.slice(0, 60), command })
      }
      let directory = pathArg ?? (ctx.url ? '' : process.cwd())
      if (ctx.ui.interactive && !pathArg)
        directory = await ctx.ui.text(
          ctx.url ? 'Repository path on the server' : 'Repository path',
          directory,
        )
      const project = await registerProject(ctx.client, directory, Boolean(ctx.url), ctx.ui)
      const path = project.path
      if (checks.length) await ctx.client.call('projects.update', { id: project.id, checks })
      console.log(
        ctx.flags.json
          ? JSON.stringify(
              { ...project, ...(checks.length ? { checks: JSON.stringify(checks) } : {}) },
              null,
              2,
            )
          : `Ready: ${path}\nNext: openrun run "your task"`,
      )
      if (!checks.length && project.checks === '[]')
        console.error(
          'To schedule unattended work, add a verification command: openrun init --check "your test command"',
        )
      if (ctx.ui.interactive) {
        const next = await ctx.ui.select('Project ready. What next?', [
          { value: 'done', label: 'Done for now' },
          { value: 'run', label: 'Run a task' },
          { value: 'schedule', label: 'Schedule work' },
        ])
        if (next !== 'done')
          return main(next, { ...ctx, flags: { ...ctx.flags, rest: [`--in=${project.path}`] } })
      }
      return 0
    }
    case 'integrations':
      await integrations(ctx.client, ctx.flags.rest, ctx.flags.json, ctx.ui, Boolean(ctx.url))
      return 0
    case 'login':
      await authorize(ctx.client)
      console.log(
        ctx.flags.json ? '{"signedIn":true}' : 'Signed in. Run: openrun integrations connect',
      )
      return 0
    case 'runtimes':
    case 'projects': {
      if (ctx.ui.interactive && command === 'runtimes') {
        const runtime = await manageRuntimes(ctx.client, ctx.ui)
        if (runtime) {
          ctx.ui.rememberRuntime(runtime.id)
          ctx.ui.done(`${runtime.label} will be preselected next time.`)
        }
        return 0
      }
      const rows = await listOf<Record<string, unknown>>(ctx.client, `${command}.list`)
      if (ctx.ui.interactive && command === 'projects') {
        const id = await ctx.ui.select('Your projects', [
          ...rows.map((row) => ({
            value: String(row.id),
            label: String(row.name),
            hint: String(row.path),
          })),
          { value: ':add', label: 'Register a repository' },
          { value: ':exit', label: 'Done' },
        ])
        if (id === ':exit') return 0
        if (id === ':add') return main('init', { ...ctx, flags: { ...ctx.flags, rest: [] } })
        const project = rows.find((row) => row.id === id)!
        const action = await ctx.ui.select(String(project.name), [
          { value: 'run', label: 'Run a task here' },
          { value: 'schedule', label: 'Schedule work here' },
          { value: ':exit', label: 'Done' },
        ])
        return action === ':exit'
          ? 0
          : main(action, { ...ctx, flags: { ...ctx.flags, rest: [`--in=${project.path}`] } })
      }
      if (ctx.flags.json) console.log(JSON.stringify(rows, null, 2))
      else if (!rows.length)
        console.log(
          command === 'projects'
            ? 'No projects yet. Run "openrun init" in your repository.'
            : 'No runtimes configured. Run "openrun api runtimes.save --help" for API usage.',
        )
      else
        for (const row of rows)
          console.log(
            `${row.id}  ${row.label ?? row.name}  ${row.bin ?? row.path ?? ''}${command === 'runtimes' ? (!row.enabled ? ' (disabled)' : row.installed ? ' (available)' : ' (not installed)') : ''}`,
          )
      return 0
    }
    case 'show':
    case 'cancel': {
      let id = ctx.flags.rest[0]
      let run = id ? ((await ctx.client.call('runs.get', { id })) as RunRowView | null) : null
      if (!run && ctx.ui.interactive) {
        if (id) ctx.ui.info(`Run not found: ${id}`)
        const runs = (await listOf<RunRowView>(ctx.client, 'runs.list', { limit: 50 })).filter(
          (row) => command === 'show' || ['running', 'queued'].includes(row.status ?? ''),
        )
        if (!runs.length) {
          ctx.ui.done(
            command === 'cancel'
              ? 'No active runs to cancel.'
              : 'No recent runs. Start one with openrun run.',
          )
          return 0
        }
        id = await ctx.ui.select(
          command === 'show' ? 'Which run would you like to read?' : 'Which run should stop?',
          runs.map((row) => ({
            value: row.id,
            label: row.taskName || row.id,
            hint: `${row.status} · ${row.id}`,
          })),
        )
        run = (await ctx.client.call('runs.get', { id })) as RunRowView | null
      }
      if (!id || !run)
        throw new Error(id ? `Run not found: ${id}` : `Usage: openrun ${command} <run-id>`)
      if (command === 'cancel') {
        if (ctx.ui.interactive && !(await ctx.ui.confirm(`Stop “${run.taskName || id}”?`, false)))
          throw new Cancelled('Run left running.')
        const result = await ctx.client.call('runs.cancel', { id })
        console.log(
          ctx.flags.json
            ? JSON.stringify(result, null, 2)
            : `Run ${id}: ${(result as RunRowView).status}`,
        )
        return 0
      }
      const conversation = await ctx.client.call('runs.getConversation', { runId: id })
      if (ctx.flags.json) console.log(JSON.stringify({ run, conversation }, null, 2))
      else printConversation(run, conversation as ConversationView | null)
      return 0
    }
    case 'api': {
      let [id, payload] = ctx.flags.rest
      const operations = OPERATIONS.filter((op) => op.clients.includes('desktop'))
      if (ctx.ui.interactive && (!id || !operations.some((op) => op.id === id))) {
        if (id) ctx.ui.info(`Unknown operation: ${id}`)
        id = await ctx.ui.select(
          'Choose an operation',
          operations.map((op) => ({ value: op.id, label: op.id, hint: op.method })),
        )
      }
      if (!id) {
        console.log(
          ctx.flags.json
            ? JSON.stringify(operations, null, 2)
            : operations.map((op) => `${op.id}  ${JSON.stringify(op.input ?? {})}`).join('\n'),
        )
        return 0
      }
      const operation = OPERATIONS.find((op) => op.id === id)
      if (!operation) throw new Error(`Unknown operation: ${id}`)
      let input: unknown
      if (ctx.ui.interactive && (payload || operation.input)) {
        ctx.ui.note(
          JSON.stringify(operation.input ?? {}, null, 2),
          `${operation.id} · input fields`,
        )
        payload = await ctx.ui.text('JSON input', payload || '{}', (value) => {
          try {
            JSON.parse(value)
          } catch {
            return 'Enter valid JSON, such as {"id":"run_123"}.'
          }
        })
      }
      try {
        input = payload ? JSON.parse(payload) : undefined
      } catch {
        throw new Error(
          'Invalid JSON input. Wrap the JSON object in single quotes, e.g. \'{"id":"run_123"}\'.',
        )
      }
      if (
        ctx.ui.interactive &&
        !ctx.flags.dryRun &&
        !(await ctx.ui.confirm(`Call ${operation.id}?`, operation.method === 'GET'))
      )
        throw new Cancelled('Operation not sent.')
      if (ctx.flags.dryRun) console.log(JSON.stringify({ operation: id, input }, null, 2))
      else console.log(JSON.stringify(await ctx.client.call(id, input), null, 2))
      return 0
    }
    case 'schedule':
    case 'run': {
      let intent: CliIntent
      if (ctx.ui.interactive) {
        intent = await guideRun(ctx.client, ctx.flags.rest, command, ctx.ui, {
          remote: Boolean(ctx.url),
          dryRun: ctx.flags.dryRun,
        })
      } else {
        const parsed = parseCliSchedule(ctx.flags.rest)
        if (!parsed.ok) throw new Error(parsed.error)
        intent = parsed.intent
        if (command === 'run' && intent.schedule.kind !== 'now')
          throw new Error('Use "openrun schedule" for a time, or --prompt for literal text.')
        if (command === 'schedule' && intent.schedule.kind === 'now')
          throw new Error('Add a time, such as "at 16:40" or "every day at 9".')
      }
      return intent.schedule.kind === 'now' ? cmdRun(ctx, intent) : cmdSchedule(ctx, intent)
    }
    case 'ls':
    case 'list':
      return cmdList(ctx)
    case 'runs':
      return cmdRuns(ctx)
    case 'now':
      return withTask(ctx, ctx.flags.rest, 'Started', async (task) => {
        return ctx.client.call('tasks.runNow', { id: task.id })
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
      console.log(cliHelp())
      return 1
  }
}

async function cmdWorker(ctx: Context): Promise<number> {
  const { flags, url, ui } = ctx
  if (url) throw new Error('Worker controls are local. Remove --url / OPENRUN_URL.')
  const action =
    flags.rest[0] ??
    (ui.interactive
      ? await ui.select('Background worker', [
          { value: 'status', label: 'Show status' },
          { value: 'start', label: 'Start worker' },
          { value: 'logs', label: 'Read logs' },
          { value: 'stop', label: 'Stop worker', hint: 'also cancels active runs' },
        ])
      : 'status')
  if (
    action === 'stop' &&
    ui.interactive &&
    !(await ui.confirm('Stop the worker and cancel its active runs?', false))
  )
    throw new Cancelled('Worker unchanged.')
  if (action === 'logs') {
    try {
      const logs = readFileSync(join(openrunHome(), 'worker.log'), 'utf8')
      console.log(flags.json ? JSON.stringify({ logs }) : logs)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      console.log(flags.json ? '{"logs":""}' : 'No worker log yet.')
    }
    return 0
  }
  if (action === 'start') await ensureLocalRuntime(() => ui.info('Starting the local worker…'))
  try {
    if (action === 'stop') {
      const result = await stopLocalRuntime()
      console.log(
        flags.json
          ? JSON.stringify(result, null, 2)
          : 'Worker stopped. Schedules will resume when you start it again.',
      )
      return 0
    }
    const status = await localStatus()
    if (flags.json) console.log(JSON.stringify(status, null, 2))
    else {
      console.log(
        `${status.kind === 'web' ? 'Web app' : 'Worker'} ${status.stopping ? 'is stopping' : 'is running'} (PID ${status.pid}).`,
      )
      console.log(field('Data', status.home))
      console.log(
        status.kind === 'web'
          ? 'CLI commands use this web app automatically.'
          : 'Next: openrun runs · openrun worker logs · openrun worker stop',
      )
    }
  } catch (error) {
    if (!unavailable(error)) throw error
    console.log(
      flags.json
        ? '{"running":false}'
        : 'Local runtime is stopped. Start it with: openrun worker start',
    )
  }
  return 0
}

async function entry(): Promise<void> {
  let url = ''
  const ui = new CliUi(interactiveTerminal() && !requestsUnattended(process.argv.slice(2)))
  try {
    let argv = process.argv.slice(2)
    let parsed: ReturnType<typeof readCliArgs>
    for (;;) {
      try {
        parsed = readCliArgs(argv, ui.interactive)
        break
      } catch (error) {
        if (!ui.interactive) throw error
        ui.intro()
        ui.info(explain(error, url))
        const choice = await ui.select('Let’s fix that', [
          { value: 'edit', label: 'Edit the command', hint: 'your arguments are kept' },
          { value: 'help', label: 'Show command reference' },
          { value: 'exit', label: 'Exit' },
        ])
        if (choice === 'exit') throw new Cancelled('Nothing started.')
        if (choice === 'help') {
          console.log(cliHelp())
          continue
        }
        const correction = commandCorrection(argv)
        const line = await ui.text(
          'Command arguments (without openrun; authentication kept)',
          correction.line,
          (value) => {
            try {
              readCliArgs(correction.parse(value), true)
            } catch (err) {
              return err instanceof Error ? err.message : String(err)
            }
          },
        )
        argv = correction.parse(line)
        ui.interactive = interactiveTerminal() && !requestsUnattended(argv)
      }
    }
    let { command } = parsed
    const { flags, help } = parsed
    if (help) {
      console.log(cliHelp(command))
      return
    }
    if (flags.url || openrunEnv('URL')) {
      for (;;) {
        try {
          url = serverUrl(flags.url)
          break
        } catch (error) {
          if (!ui.interactive) throw error
          ui.info(explain(error, url))
          flags.url = await ui.text('Server URL', flags.url || openrunEnv('URL') || '', (value) => {
            try {
              serverUrl(value)
            } catch (err) {
              return (err as Error).message
            }
          })
        }
      }
    }
    ui.intro()
    if (url && ui.interactive) ui.info(`Connected target: ${url}`)
    if (!command) command = await commandMenu(ui)
    // Resolve transport lazily: help, operation discovery and worker status do not start a worker.
    let local: Promise<CliClient> | undefined
    const client: CliClient = url
      ? new OpenRunClient({ baseUrl: url, token: flags.token || storedToken(url) })
      : {
          call: async (operation, input) => {
            local ??= ensureLocalRuntime(() => ui.info('Starting the local worker…')).catch(
              (error) => {
                local = undefined
                throw error
              },
            )
            return (await local).call(operation, input)
          },
        }
    const ctx: Context = { client, flags, url, ui }
    for (;;) {
      if (command === 'exit') {
        ui.done('See you next run.')
        return
      }
      if (command === 'help') {
        console.log(cliHelp())
        return
      }
      try {
        process.exitCode = await main(command, ctx)
        return
      } catch (error) {
        if (error instanceof Cancelled || !ui.interactive) throw error
        ui.note(explain(error, url), 'Let’s get you unstuck')
        // Do not replay writes: a dropped response can still mean the run was started.
        command = await ui.select('What would you like to do next?', [
          {
            value: 'runs',
            label: 'Inspect recent runs',
            hint: 'check whether work already started',
          },
          { value: 'init', label: 'Set up a project' },
          { value: 'runtimes', label: 'Configure agents' },
          ...(!url ? [{ value: 'worker', label: 'Worker status and logs' }] : []),
          { value: 'menu', label: 'Choose another command' },
          { value: 'exit', label: 'Exit' },
        ])
        if (command === 'menu') command = await commandMenu(ui)
        ctx.flags = {
          ...ctx.flags,
          rest: [],
          dryRun: ctx.flags.dryRun && ['run', 'schedule', 'api'].includes(command),
        }
      }
    }
  } catch (error) {
    if (error instanceof Cancelled) {
      ui.done(error.message || 'Cancelled.')
      process.exitCode = 130
    } else {
      console.error(`Error: ${explain(error, url)}`)
      process.exitCode = 1
    }
  }
}

await entry()
